import type { PrometheusServer } from '../server/index.js';

type DONamespace = DurableObjectNamespace<PrometheusServer>;

export class Registry {
	#namespace: DONamespace;
	#ctx: ExecutionContext;
	#name: string;

	constructor(namespace: DONamespace, ctx: ExecutionContext, name: string = 'default') {
		this.#namespace = namespace;
		this.#ctx = ctx;
		this.#name = name;
	}

	counter(name: string, help: string) {
		return new CounterImpl(name, help, this.#namespace, this.#ctx, this.#name);
	}

	gauge(name: string, help: string) {
		return new GaugeImpl(name, help, this.#namespace, this.#ctx, this.#name);
	}

	histogram(name: string, help: string, histogramBuckets: number[]) {
		return new HistogramImpl(name, help, histogramBuckets, this.#namespace, this.#ctx, this.#name);
	}

	metrics() {
		const id = this.#namespace.idFromName(this.#name);
		const stub = this.#namespace.get(id);

		return stub.metrics();
	}

	clear() {
		const id = this.#namespace.idFromName(this.#name);
		const stub = this.#namespace.get(id);

		return stub.clear();
	}
}

class BaseCollector {
	#name: string;
	#help: string;
	#namespace;
	#ctx;
	#registryName;

	constructor(name: string, help: string, namespace: DONamespace, ctx: ExecutionContext, registryName: string) {
		this.#name = name;
		this.#help = help;
		this.#namespace = namespace;
		this.#ctx = ctx;
		this.#registryName = registryName;
	}

	protected getSelf<T extends 'histogram'>(type: T, histogramBuckets: number[]): Rpc.Result<Histogram>;
	protected getSelf<T extends 'gauge' | 'counter'>(type: T): Rpc.Result<CollectorForType<T>>;
	protected getSelf<T extends CollectorType>(type: T, histogramBuckets?: number[]) {
		const id = this.#namespace.idFromName(this.#registryName);
		const stub = this.#namespace.get(id);

		if (type === 'histogram') {
			if (typeof histogramBuckets === 'undefined') throw new Error('Histogram buckets should not be undefined');
			return stub[type](this.#name, this.#help, histogramBuckets) as Rpc.Result<Histogram>;
		} else {
			return stub[type as 'gauge' | 'histogram'](this.#name, this.#help, []) as Rpc.Result<CollectorForType<T>>;
		}
	}

	protected waitUntil(fn: Promise<unknown>) {
		return this.#ctx.waitUntil(fn);
	}
}

class CounterImpl extends BaseCollector implements Counter {
	type: 'counter' | 'gauge' = 'counter' as const;

	reset(labels?: Labels): this {
		const counter = this.getSelf(this.type);
		this.waitUntil(counter.reset(labels));

		return this;
	}
	resetAll(): this {
		const counter = this.getSelf(this.type);
		this.waitUntil(counter.resetAll());

		return this;
	}
	inc(labels?: Labels): this {
		const counter = this.getSelf(this.type);
		this.waitUntil(counter.inc(labels));

		return this;
	}
	add(amount: number, labels?: Labels): this {
		const counter = this.getSelf(this.type);
		this.waitUntil(counter.add(amount, labels));

		return this;
	}
}

class GaugeImpl extends CounterImpl implements Gauge {
	type = 'gauge' as const;

	dec(labels?: Labels) {
		const gauge = this.getSelf('gauge');
		this.waitUntil(gauge.dec(labels));

		return this;
	}
	sub(amount: number, labels?: Labels) {
		throw new Error('Method not implemented.');
	}
}

class HistogramImpl extends BaseCollector implements Histogram {
	type = 'histogram' as const;
	#histogramBuckets: number[];

	constructor(name: string, help: string, histogramBuckets: number[], namespace: DONamespace, ctx: ExecutionContext, registryName: string) {
		super(name, help, namespace, ctx, registryName);
		this.#histogramBuckets = histogramBuckets;
	}

	reset(labels?: Labels): this {
		const histogram = this.getSelf(this.type, this.#histogramBuckets);
		this.waitUntil(histogram.reset(labels));

		return this;
	}
	resetAll(): this {
		const histogram = this.getSelf(this.type, this.#histogramBuckets);
		this.waitUntil(histogram.resetAll());

		return this;
	}
	observe(value: number, labels?: Labels): this {
		const histogram = this.getSelf(this.type, this.#histogramBuckets);
		this.waitUntil(histogram.observe(value, labels));

		return this;
	}
}
