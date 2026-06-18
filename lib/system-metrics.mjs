/**
 * Optional worker CPU/RAM sampling for run telemetry.
 * Mirror of web/lib/elt/agent-system-metrics.ts — keep in sync.
 */

export function systemMetricsEnabled() {
  const raw = String(process.env.ELTPULSE_SYSTEM_METRICS ?? "").trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return true;
}

function intervalMs() {
  const n = Number(process.env.ELTPULSE_SYSTEM_METRICS_INTERVAL_MS ?? "");
  if (Number.isFinite(n) && n >= 5000) return Math.min(n, 120_000);
  return 20_000;
}

let lastCpuUsage = null;
let lastCpuAt = 0;

export function readProcessSystemMetrics() {
  const mem = process.memoryUsage();
  const memoryMb = Math.round((mem.rss / (1024 * 1024)) * 10) / 10;
  const now = Date.now();
  let cpuPercent;
  const usage = process.cpuUsage();
  if (lastCpuUsage && lastCpuAt > 0) {
    const elapsedMs = now - lastCpuAt;
    if (elapsedMs > 0) {
      const cpuMs = (usage.user - lastCpuUsage.user + usage.system - lastCpuUsage.system) / 1000;
      cpuPercent = Math.min(100, Math.round((cpuMs / elapsedMs) * 1000) / 10);
    }
  }
  lastCpuUsage = usage;
  lastCpuAt = now;
  return { memoryMb, ...(cpuPercent !== undefined ? { cpuPercent } : {}) };
}

export function telemetryPatchWithSystem(metrics) {
  if (!metrics) return {};
  return {
    telemetrySummary: { system: metrics },
    appendTelemetrySample: { system: metrics },
  };
}

/** @param {(body: object) => Promise<void>} patch */
export function startSystemMetricsSampler(patch) {
  if (!systemMetricsEnabled()) return { stop: () => undefined };
  let stopped = false;
  const ms = intervalMs();
  const tick = async () => {
    if (stopped) return;
    const system = readProcessSystemMetrics();
    if (!system) return;
    try {
      await patch({ status: "running", ...telemetryPatchWithSystem(system) });
    } catch {
      /* ignore */
    }
  };
  void tick();
  const handle = setInterval(() => void tick(), ms);
  return { stop: () => {
    stopped = true;
    clearInterval(handle);
  } };
}
