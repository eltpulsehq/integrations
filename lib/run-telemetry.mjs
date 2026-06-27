/**
 * Wire system metrics + log-line telemetry into run PATCH calls.
 */

import { startSystemMetricsSampler } from "./system-metrics.mjs";
import { mergeTelemetryIntoPayload, parseLogLineForTelemetry } from "./telemetry-log-parser.mjs";

/**
 * @param {string} runId
 * @param {(path: string, opts?: object) => Promise<object>} api
 */
export function createRunTelemetry(runId, api) {
  let pendingTelemetry = null;

  const metricsSampler = startSystemMetricsSampler(async (body) => {
    await api(`/api/agent/runs/${runId}`, { method: "PATCH", json: body });
  });

  return {
    /** Call for each log line before buffering. */
    onLogLine(line) {
      const parsed = parseLogLineForTelemetry(line);
      if (parsed) {
        pendingTelemetry = parsed;
        // PATCH telemetry immediately — do not wait for log batch flush.
        void api(`/api/agent/runs/${runId}`, {
          method: "PATCH",
          json: { status: "running", ...mergeTelemetryIntoPayload({}, parsed) },
        }).catch(() => {});
      }
    },

    /** Merge pending telemetry into a log/status PATCH. */
    enrichPayload(payload) {
      const merged = mergeTelemetryIntoPayload(payload, pendingTelemetry);
      pendingTelemetry = null;
      return merged;
    },

    stop() {
      metricsSampler.stop();
    },
  };
}
