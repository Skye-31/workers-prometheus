import { Registry } from 'workers-prometheus/client';
import { getPrometheusExporter } from 'workers-prometheus/server';
import type { PrometheusServer } from 'workers-prometheus/server';

// Export a Durable Object that powers your prometheus server
export const PROMETHEUS = getPrometheusExporter();

export default {
	async fetch(request, env, ctx): Promise<Response> {
		if (!URL.canParse(request.url)) return new Response('invalid req url', { status: 400 });
		const url = new URL(request.url);

		const REGISTRY = new Registry(env.PROMETHEUS, ctx);

		switch (url.pathname) {
			case '/favicon.ico':
				return new Response(null, { status: 404 });
			case '/metrics':
				return new Response(await REGISTRY.metrics());
			case '/flush':
				return new Response(await REGISTRY.clear());

			default:
				const counter = REGISTRY.counter('http_requests', 'Number of HTTP requests received');
				counter.inc({ method: request.method });

				const gauge = REGISTRY.gauge('my-gauge', 'an increasing and decreasing gauge');
				gauge.inc();

				const histogram = REGISTRY.histogram(
					'examplecom_latency',
					'Counts latency for getting data from example.com',
					[50, 100, 250, 500, 1000],
				);
				const time = Date.now();
				const resp = await fetch('https://example.com');
				const latency = Date.now() - time;
				histogram.observe(latency, { status: resp.status });

				return new Response('ok');
		}
	},
} satisfies ExportedHandler<{ PROMETHEUS: DurableObjectNamespace<PrometheusServer> }>;
