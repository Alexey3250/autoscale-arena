<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Autoscale Arena — project notes

One Next.js 16 codebase, two deployments, one HorizontalPodAutoscaler. The app demos Kubernetes autoscaling on OpenShift from a phone.

## Mode gating

`WORKER_MODE` decides who answers which route. `proxy.ts` enforces it (this is Next.js 16's renamed `middleware.ts`):

- `WORKER_MODE=true` (worker pods): `/api/work` + `/api/health` are live. `/api/pods/*` returns 404. `/` returns a plaintext message.
- `WORKER_MODE=false` (frontend, default): UI + `/api/pods/*` + `/api/health` are live. `/api/work` is handled by the route handler but forwards the POST to `WORKER_SERVICE_URL` instead of running the CPU loop locally.

The reason the frontend forwards to the worker is to keep the HPA CPU signal clean: only worker pods burn CPU on taps, so their utilisation directly reflects load.

## Key files

| File                           | Purpose                                                    |
| ------------------------------ | ---------------------------------------------------------- |
| `app/page.tsx`                 | Client UI: tap button, pod grid, stats, RPS chart, SSE sub |
| `app/api/work/route.ts`        | Worker: CPU loop. Frontend: proxy to worker Service.       |
| `app/api/health/route.ts`      | Liveness/readiness                                         |
| `app/api/pods/status/route.ts` | One-shot pod snapshot (initial render + fallback)          |
| `app/api/pods/stream/route.ts` | SSE: watches pods via `@kubernetes/client-node`            |
| `lib/k8s.ts`                   | KubeConfig discovery, `Watch`, mock fallback               |
| `lib/cpuWork.ts`               | Calibrated sha256 loop                                     |
| `proxy.ts`                     | Mode gating                                                |
| `openshift/*.yaml`             | rbac, frontend, worker, hpa                                |

## Deploy commands (quick)

```bash
cd openshift
oc apply -f rbac.yaml
oc new-app nodejs~<git-url> --name=autoscale-arena-frontend
oc apply -f frontend.yaml -f worker.yaml -f hpa.yaml
oc get route autoscale-arena-frontend -o jsonpath='https://{.spec.host}{"\n"}'
```

Full runbook: `openshift/README.md`.

## Rebuild after code changes

```bash
git push
oc start-build autoscale-arena-frontend --wait
# Deployments roll automatically via ImageChange triggers
```

## Gotchas that ate time

- **Next.js 16 renamed `middleware.ts` to `proxy.ts`.** The old filename still compiles in some edge cases but triggers deprecation warnings. Use `proxy.ts` with an exported `proxy` function.
- **Tailwind v4 has no config file.** Theme tokens live under `@theme` in `app/globals.css`. Don't create `tailwind.config.ts`.
- **Recharts warns during SSR prerender.** The RPS chart is loaded via `next/dynamic(..., { ssr: false })` to avoid noisy build output.
- **HPA needs `resources.requests.cpu`.** If `oc get hpa` shows `<unknown>/50%`, the worker Deployment is missing the resource request.
- **Pods must carry the `app=autoscale-arena-worker` label.** The SSE watch filters by this label. `oc new-app --image-stream` sometimes creates a pod template without it; verify with `oc get pods --show-labels`.
- **Sandbox idles pods after ~12h.** `oc rollout restart deploy/autoscale-arena-frontend deploy/autoscale-arena-worker` before a demo.

## What's explicitly out of scope

No auth, no DB, no Redis, no cross-pod state, no telemetry, no theme toggle, no i18n. If a future agent is tempted to add any of those, read `SPEC.md` first.

## Local dev sanity check

```bash
npm run dev
# http://localhost:3000 should render one mock pod named local-worker-0
```

Tapping the button runs the CPU loop in-process locally. The frontend route only forwards to the worker Service when it detects a ServiceAccount token mount (i.e. it's running inside a cluster). This keeps `npm run dev` self-contained without needing a live worker.
