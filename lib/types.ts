export interface PodInfo {
  name: string;
  status: string;
  ready: boolean;
  startTime: string | null;
  nodeName: string | null;
}

export interface PodsSnapshot {
  pods: PodInfo[];
  count: number;
  source: "cluster" | "mock";
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
