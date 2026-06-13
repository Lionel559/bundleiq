# BundleIQ Yellowstone Worker

Persistent Node worker for SolInfra Yellowstone gRPC slot streaming. This runs outside the Vercel dashboard so the Yellowstone stream can stay open in a long-lived process.

## Behavior

- Connects to SolInfra Yellowstone gRPC with `SOLINFRA_GRPC_ENDPOINT` and `SOLINFRA_API_KEY`.
- Subscribes to slot updates with `filterByCommitment: false` and `interslotUpdates: true`.
- Tracks latest slot state in memory.
- Keeps the stream alive with gRPC keepalive settings and subscribe pings.
- Reconnects with bounded exponential backoff.
- Protects stream event processing with a bounded in-memory queue.
- Exposes JSON endpoints for the dashboard or operational checks.

## Endpoints

- `GET /` returns worker health.
- `GET /stream-status` returns the latest Yellowstone slot status.

## Environment Variables

Required:

- `SOLINFRA_GRPC_ENDPOINT` - SolInfra Yellowstone gRPC endpoint. Include protocol when available, for example `https://...`.
- `SOLINFRA_API_KEY` - SolInfra API key. The worker sends it as the Yellowstone `x-token`.

Render sets this automatically:

- `PORT` - HTTP port used by the worker.

Recommended:

- `CORS_ORIGIN` - Vercel dashboard origin allowed to call the worker, for example `https://your-app.vercel.app`. Multiple origins can be comma-separated.

Optional:

- `SOLINFRA_ENDPOINT_REGION` - Region label returned in JSON. Defaults to `FRA`.
- `YELLOWSTONE_COMMITMENT` - `processed`, `confirmed`, or `finalized`. Defaults to `processed`.
- `YELLOWSTONE_GRPC_PING_INTERVAL_MS` - Subscribe ping and gRPC keepalive interval. Defaults to `30000`.
- `YELLOWSTONE_GRPC_CONNECT_TIMEOUT_MS` - Timeout for connection steps. Defaults to `15000`.
- `YELLOWSTONE_GRPC_STALE_TIMEOUT_MS` - Reconnect if no slot or pong activity occurs within this window. Defaults to at least `90000`.

## Local Run

```bash
cd worker
npm install
npm run build
npm run start
```

Then open:

```bash
curl http://localhost:3001/
curl http://localhost:3001/stream-status
```

## Render Deployment

Create a new Render Web Service from this repository.

- Root Directory: `worker`
- Build Command: `npm install && npm run build`
- Start Command: `npm run start`
- Runtime: Node

Add the required environment variables in Render:

```txt
SOLINFRA_GRPC_ENDPOINT=...
SOLINFRA_API_KEY=...
CORS_ORIGIN=https://your-vercel-dashboard.vercel.app
```

After deployment, verify:

```bash
curl https://your-render-service.onrender.com/
curl https://your-render-service.onrender.com/stream-status
```

This worker is independently deployable and is not imported by the Next.js app.
