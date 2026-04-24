# Autoscale Arena

A single-page Next.js app that demos Kubernetes Horizontal Pod Autoscaling on Red Hat OpenShift in real time. Open it on your phone, hold a button, and watch worker pods scale from 1 to N as the CPU load climbs. Let go, and watch them wind back down.

The app is both the load generator _and_ the visualisation — one codebase, deployed twice (frontend + worker), same container image.

> Screenshot placeholder — add after first deploy.

## Architecture

```
Phone browser
    │ HTTPS
    ▼
Frontend Deployment (Next.js, WORKER_MODE=false)
    ├── /               → UI (app/page.tsx)
    ├── /api/pods/stream → SSE: watches pods via ServiceAccount
    ├── /api/pods/status → snapshot for initial render
    └── /api/work        → forwards POST to worker Service
                             │ http://autoscale-arena-worker:3000
                             ▼
Worker Deployment (Next.js, WORKER_MODE=true, 1..N pods)
    ├── /api/work        → 200 ms sha256 hash loop
    └── /api/health      → probe target
            ▲
            │ scaleTargetRef
HorizontalPodAutoscaler (autoscaling/v2)
    target: 50% CPU utilisation, 1..10 replicas
```

Key design decisions, in case you skim:

- **One image, two modes.** `WORKER_MODE=true|false` gates which routes are live, via `proxy.ts` (Next.js 16's replacement for `middleware.ts`).
- **SSE, not WebSockets.** The stream uses a 15-second heartbeat so the OpenShift router's default 30s timeout doesn't drop the connection, and we explicitly annotate the Route with `haproxy.router.openshift.io/timeout: 4h` as a belt + braces.
- **No persistence.** All state lives in pod memory or browser memory. Losing a pod loses its metrics; the UI's rolling window survives via the SSE snapshot.
- **In-cluster auth.** The frontend's ServiceAccount has a namespace-scoped Role granting `get/list/watch` on pods. Local dev (no ServiceAccount mount) falls back to a single mock pod so `npm run dev` just works.

## Local development

```bash
npm install
npm run dev
# http://localhost:3000
```

You'll see one mock pod (`local-worker-0`). Tapping the button runs the sha256 loop in-process: the frontend route detects the missing ServiceAccount mount and skips the upstream forward. Once deployed, the frontend proxies taps to the worker Service instead.

### Environment variables

| Variable            | Default                                   | Purpose                                       |
| ------------------- | ----------------------------------------- | --------------------------------------------- |
| `WORKER_MODE`       | unset (= frontend)                        | `true` on worker pods, `false`/unset on frontend |
| `WORKER_SERVICE_URL`| `http://autoscale-arena-worker:3000`      | Where the frontend forwards `/api/work`       |
| `WORKER_LABEL_SELECTOR` | `app=autoscale-arena-worker`          | Label selector the SSE watch uses             |
| `HOSTNAME`          | set by Kubernetes                         | Reported as `podName` in `/api/work` response |

## Deploy to OpenShift

See [`openshift/README.md`](openshift/README.md) for the full oc commands.

Quick version:

```bash
cd openshift
oc apply -f rbac.yaml
oc new-app nodejs~<your-git-url> --name=autoscale-arena-frontend
oc apply -f frontend.yaml -f worker.yaml -f hpa.yaml
oc get route autoscale-arena-frontend -o jsonpath='https://{.spec.host}{"\n"}'
```

Then in a separate terminal:

```bash
oc get pods -w -l app=autoscale-arena-worker
oc get hpa autoscale-arena-worker -w
```

## Project layout

```
app/
├── page.tsx                  UI (client component)
├── layout.tsx                Dark theme, viewport, fonts
├── globals.css               Tailwind v4 entry + keyframes
└── api/
    ├── work/route.ts         Worker: CPU loop · Frontend: proxy to worker
    ├── health/route.ts       Probe endpoint
    └── pods/
        ├── status/route.ts   Snapshot
        └── stream/route.ts   SSE watch
components/
├── TapButton.tsx             Press-and-hold loader
├── PodGrid.tsx               Live pod cards
├── StatsBar.tsx              RPS / p95 / count
└── RpsChart.tsx              Recharts line chart (client-only)
lib/
├── k8s.ts                    KubeConfig + Watch helpers, mock fallback
├── cpuWork.ts                sha256 hash loop
├── metrics.ts                Ring buffer for per-pod samples
└── types.ts                  Shared interfaces
proxy.ts                      Mode gating (worker vs frontend)
openshift/
├── rbac.yaml                 ServiceAccount + Role + RoleBinding
├── frontend.yaml             Deployment + Service + Route
├── worker.yaml               Deployment + Service
├── hpa.yaml                  HorizontalPodAutoscaler
└── README.md                 Deploy runbook
.s2i/environment              OpenShift Node.js S2I hints
```

## Notes for Next.js 16

- `middleware.ts` is deprecated in 16; we use `proxy.ts` with an exported `proxy` function.
- Tailwind v4 is CSS-first. There is no `tailwind.config.ts`; theme tokens live in `app/globals.css` under `@theme`.
- Route handlers that touch the filesystem or need stable CPU behaviour explicitly set `runtime = "nodejs"`.
