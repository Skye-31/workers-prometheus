# Cloudflare Workers Prometheus Exporter

1. Install

`$ npm i workers-prometheus` / `$ pnpm add workers-prometheus`

2. Set up a prometheus registry

```js
import { Registry } from 'workers-prometheus/client';
import { getPrometheusExporter } from 'workers-prometheus/server';
import type { PrometheusServer } from 'workers-prometheus/server';

export const PROMETHEUS = getPrometheusExporter();
```

Add a Durable object to your wrangler.toml (requires workers paid plan)

```toml
[[durable_objects.bindings]]
name = "PROMETHEUS"
class_name = "PROMETHEUS"

[[migrations]]
new_classes=["PROMETHEUS"]
tag = "v1"
```

3. Write your worker!

```js
export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);

		const REGISTRY = new Registry(env.PROMETHEUS, ctx);

		switch (url.pathname) {
			case '/metrics':
				return new Response(await REGISTRY.metrics());
			case '/flush':
				return new Response(await REGISTRY.clear());

			default:
				const counter = REGISTRY.counter('http_requests', 'Number of HTTP requests received');
				counter.inc({ method: request.method });

				const gauge = REGISTRY.gauge('my-gauge', 'an increasing and decreasing gauge');
				gauge.inc();

				const histogram = REGISTRY.histogram('examplecom_latency', 'Counts latency for getting data from example.com', [50, 100, 250, 500, 1000]);
				const time = Date.now();
				const resp = await fetch('https://example.com');
				const latency = Date.now() - time;
				histogram.observe(latency, { status: resp.status });

				return new Response('ok');
		}
	},
} satisfies ExportedHandler<{ PROMETHEUS: DurableObjectNamespace<PrometheusServer> }>;
```

4. Deploy your worker

```
$ wrangler deploy
```

5. Set up a prometheus scraper

```yml
scrape_configs:
  - job_name: prometheus
    static_configs:
      - targets: ['<worker_name>.<account>.workers.dev/metrics']
```

For a full example, see the `example` directory.

Planned features:

- Automatically flushing data periodically (important when using histograms)
