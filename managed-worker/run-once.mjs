/**
 * One-shot managed-worker (Node 18+): pull pending managed runs and **stub-complete** them.
 *
 * For **real** dlt/Sling execution on a machine with Python/Sling installed, use instead:
 *   cd web && pnpm managed-worker:local
 * with `ELTPULSE_MANAGED_EXECUTOR=local` in `.env.local` (see README.md in this folder).
 *
 * Env:
 *   ELTPULSE_CONTROL_PLANE_URL  — e.g. https://app.example.com or http://localhost:3000
 *   ELTPULSE_INTERNAL_API_SECRET — Bearer for /api/internal/managed-runs*
 *   ELTPULSE_MANAGED_LIMIT      — optional, default 5
 */
const base = (process.env.ELTPULSE_CONTROL_PLANE_URL || "").replace(/\/$/, "");
const secret = process.env.ELTPULSE_INTERNAL_API_SECRET || "";
const limit = Math.min(20, Math.max(1, Number(process.env.ELTPULSE_MANAGED_LIMIT ?? 5) || 5));

if (!base || !secret) {
  console.error("Set ELTPULSE_CONTROL_PLANE_URL and ELTPULSE_INTERNAL_API_SECRET");
  process.exit(1);
}

async function api(path, { method = "GET", json } = {}) {
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = { Authorization: `Bearer ${secret}`, Accept: "application/json" };
  if (json !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(url, { method, headers, body: json !== undefined ? JSON.stringify(json) : undefined });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { _raw: text };
  }
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> ${res.status}`);
    err.detail = body;
    throw err;
  }
  return body;
}

async function stubCompleteManagedRun(runId) {
  await api(`/api/internal/managed-runs/${runId}`, {
    method: "PATCH",
    json: { status: "running" },
  });
  await api(`/api/internal/managed-runs/${runId}`, {
    method: "PATCH",
    json: {
      status: "running",
      appendLog: {
        level: "info",
        message:
          "eltpulse-managed-worker: stub progress — replace with real executor (see integrations/managed-worker/README.md).",
      },
      telemetrySummary: { currentPhase: "stub", progress: 10, rowsLoaded: 0, bytesLoaded: 0 },
      appendTelemetrySample: { progress: 10, rows: 0, bytes: 0, phase: "stub" },
    },
  });
  await api(`/api/internal/managed-runs/${runId}`, {
    method: "PATCH",
    json: {
      status: "running",
      telemetrySummary: { currentPhase: "stub", progress: 80, rowsLoaded: 100, bytesLoaded: 50_000 },
      appendTelemetrySample: { progress: 80, rows: 100, bytes: 50_000, phase: "stub" },
    },
  });
  await api(`/api/internal/managed-runs/${runId}`, {
    method: "PATCH",
    json: {
      status: "succeeded",
      appendLog: {
        level: "info",
        message: "eltpulse-managed-worker: stub completed (run-once.mjs).",
      },
      telemetrySummary: { currentPhase: "done", progress: 100, rowsLoaded: 100, bytesLoaded: 50_000 },
      appendTelemetrySample: { progress: 100, rows: 100, bytes: 50_000, phase: "done" },
    },
  });
}

const data = await api(`/api/internal/managed-runs?limit=${limit}`);
const runs = Array.isArray(data.runs) ? data.runs : [];
if (runs.length === 0) {
  console.log("[managed-worker] no pending managed runs");
  process.exit(0);
}

let ok = 0;
const errors = [];
for (const r of runs) {
  try {
    await stubCompleteManagedRun(r.id);
    ok += 1;
    console.log(`[managed-worker] stub-completed ${r.id}`);
  } catch (e) {
    errors.push(`${r.id}: ${e.message}`);
    console.error(`[managed-worker] ${r.id}`, e.detail ?? e);
  }
}
console.log(`[managed-worker] done: ${ok}/${runs.length} ok, ${errors.length} errors`);
if (errors.length) process.exit(1);
