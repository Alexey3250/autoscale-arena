export interface PodInfo {
  name: string;
  status: string;
  ready: boolean;
  startTime: string | null;
  nodeName: string | null;
}

export interface HpaStatus {
  /** Current observed CPU utilisation across worker pods, as percent (0-100+). */
  currentCpuPercent: number | null;
  /** Configured target utilisation from the HPA spec (e.g. 50). */
  targetCpuPercent: number | null;
  /** Replicas the controller has decided to run. */
  desiredReplicas: number | null;
  /** Replicas the controller currently observes. */
  currentReplicas: number | null;
  minReplicas: number | null;
  maxReplicas: number | null;
  /** ISO timestamp of the last scale event, if reported. */
  lastScaleTime: string | null;
  /** Set when we couldn't read the HPA (RBAC, missing object, sandbox). */
  error: string | null;
}

export interface PodsSnapshot {
  pods: PodInfo[];
  count: number;
  source: "cluster" | "mock";
  hpaStatus: HpaStatus | null;
}

export interface PodsStreamMessage {
  pods: PodInfo[];
  count: number;
  source: "cluster" | "mock";
  hpaStatus: HpaStatus | null;
}

export interface WorkResponse {
  podName: string;
  durationMs: number;
  timestamp: number;
  iterations: number;
}

export interface WorkSample {
  timestamp: number;
  durationMs: number;
}
