type CollectorBase = {
	reset(labels?: Labels): this;
	resetAll(): this;
};

type Counter = CollectorBase & {
	inc(labels?: Labels): this;
	add(amount: number, labels?: Labels): this;
};

type Gauge = Counter & {
	dec(labels?: Labels): this;
	sub(amount: number, labels?: Labels): this;
};

type Histogram = CollectorBase & {
	observe(value: number, labels?: Labels): this;
};

type Labels = Record<string, string | number>;

type CollectorType = 'gauge' | 'counter' | 'histogram';

type CollectorForType<T extends CollectorType> = T extends 'histogram'
	? Histogram
	: T extends 'gauge'
		? Gauge
		: T extends 'counter'
			? Counter
			: never;
