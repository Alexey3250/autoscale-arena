import type { WorkSample } from "./types";

const MAX_SAMPLES = 300;

class RingBuffer {
  private samples: WorkSample[] = [];

  push(sample: WorkSample): void {
    this.samples.push(sample);
    if (this.samples.length > MAX_SAMPLES) {
      this.samples.splice(0, this.samples.length - MAX_SAMPLES);
    }
  }

  snapshot(): WorkSample[] {
    return this.samples.slice();
  }

  windowed(sinceMs: number): WorkSample[] {
    const cutoff = Date.now() - sinceMs;
    return this.samples.filter((s) => s.timestamp >= cutoff);
  }
}

// Intentionally process-wide singleton; worker pods are independent so each
// pod's buffer only describes its own load. State is lost on restart.
export const workSamples = new RingBuffer();

export function recordWork(sample: WorkSample): void {
  workSamples.push(sample);
}
