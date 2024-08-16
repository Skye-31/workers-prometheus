import { DurableObject } from 'cloudflare:workers';
import prom from 'promjs';

export type PrometheusServer = {
	[Rpc.__DURABLE_OBJECT_BRAND]: never;

	metrics(): string;
	clear(): Promise<null>;
	counter(name: string, help: string): Counter;
	gauge(name: string, help: string): Gauge;
	histogram(name: string, help: string, histogramBuckets: number[]): Histogram;
};

type RawDump = ({
	name: string;
	help: string;
} & (
	| {
			data: { value: number; labels?: Labels }[];
			type: 'counter' | 'gauge';
			buckets: undefined;
	  }
	| {
			data: { value: { raw: number[] }; labels?: Labels }[];
			type: 'histogram';
			buckets: number[];
	  }
))[];

const STATE_STORAGE_KEY = 'PROM_SERVER_STATE';
const DUMP_TIMEOUT = 7500;

// todo: flush interval configuration
export function getPrometheusExporter(): new (ctx: DurableObjectState, env: unknown) => PrometheusServer {
	return class WorkersPrometheusDO extends DurableObject implements PrometheusServer {
		#registry = (prom.default ?? prom)();
		#writeTimer: number | null = null;

		constructor(ctx: DurableObjectState, env: unknown) {
			super(ctx, env);

			this.ctx.blockConcurrencyWhile(async () => {
				const state = (await this.ctx.storage.get<RawDump>(STATE_STORAGE_KEY)) ?? [];

				for (const i in state) {
					const { type, name, help, data } = state[i];
					switch (type) {
						case 'counter':
						case 'gauge': {
							const counter = this.#registry.get(type as 'counter', name) ?? this.#registry.create(type as 'counter', name, help);
							for (const { value, labels } of data) {
								counter.set(value, labels);
							}
							break;
						}
						case 'histogram': {
							const histogram = this.#registry.get('histogram', name) ?? this.#registry.create('histogram', name, help, state[i].buckets);
							for (const { value, labels } of data) {
								// todo: optimise this?
								for (const num of value.raw) {
									histogram.observe(num, labels);
								}
							}
							break;
						}
						default:
							console.warn(`[PROM-SERVER] Unexpected event of type ${type} with data ${JSON.stringify(data, null, 2)}`);
					}
				}
			});
		}

		#resetTimer() {
			if (this.#writeTimer) clearInterval(this.#writeTimer);
			const DO = this;
			this.#writeTimer = setTimeout(async () => {
				console.log('[PROM-SERVER] Writing to disk');
				await this.ctx.storage.put(STATE_STORAGE_KEY, DO.#raw());
			}, DUMP_TIMEOUT);
		}

		counter(name: string, help: string): Counter {
			const counter = this.#registry.get('counter', name) ?? this.#registry.create('counter', name, help);
			const resetTimer = this.#resetTimer.bind(this);
			return {
				inc(labels: Labels) {
					resetTimer();
					counter.inc(labels);
					return this;
				},
				add(amount: number, labels: Labels) {
					resetTimer();
					counter.add(amount, labels);
					return this;
				},
				reset(labels: Labels) {
					resetTimer();
					counter.reset(labels);
					return this;
				},
				resetAll() {
					resetTimer();
					counter.resetAll();
					return this;
				},
			};
		}

		gauge(name: string, help: string): Gauge {
			const gauge = this.#registry.get('gauge', name) ?? this.#registry.create('gauge', name, help);
			const resetTimer = this.#resetTimer.bind(this);
			return {
				inc(labels: Labels) {
					resetTimer();
					gauge.inc(labels);
					return this;
				},
				dec(labels: Labels) {
					resetTimer();
					gauge.dec(labels);
					return this;
				},
				add(amount: number, labels: Labels) {
					resetTimer();
					gauge.add(amount, labels);
					return this;
				},
				sub(amount: number, labels: Labels) {
					resetTimer();
					gauge.sub(amount, labels);
					return this;
				},
				reset(labels: Labels) {
					resetTimer();
					gauge.reset(labels);
					return this;
				},
				resetAll() {
					resetTimer();
					gauge.resetAll();
					return this;
				},
			};
		}

		histogram(name: string, help: string, histogramBuckets: number[]): Histogram {
			const histogram = this.#registry.get('histogram', name) ?? this.#registry.create('histogram', name, help, histogramBuckets);
			const resetTimer = this.#resetTimer.bind(this);
			return {
				observe(value: number, labels: Labels) {
					resetTimer();
					histogram.observe(value, labels);
					return this;
				},
				reset(labels: Labels) {
					resetTimer();
					histogram.reset(labels);
					return this;
				},
				resetAll() {
					resetTimer();
					histogram.resetAll();
					return this;
				},
			};
		}

		metrics() {
			return this.#registry.metrics();
		}

		async clear() {
			this.#registry.clear();
			await this.ctx.storage.delete(STATE_STORAGE_KEY);

			return null;
		}

		#raw(): RawDump {
			// @ts-expect-error private
			const data = this.#registry.data as Record<
				string,
				Record<
					string,
					{ help: string } & (
						| {
								type: 'counter' | 'gauge';
								instance: {
									data: {
										value: number;
										labels?: Labels;
									}[];
									buckets: undefined;
								};
						  }
						| {
								type: 'histogram';
								instance: {
									data: {
										value: {
											raw: number[];
										};
										labels?: Labels;
									}[];
									buckets: number[];
								};
						  }
					)
				>
			>;

			// @ts-expect-error todo: ts seems to hate this generic
			return Object.values(data).flatMap((item) =>
				Object.entries(item).map(([name, details]) => ({
					name,
					help: details.help,
					data: details.instance.data,
					buckets: details.instance.buckets,
					type: details.type,
				})),
			);
		}
	};
}
