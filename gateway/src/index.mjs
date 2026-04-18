/**
 * eltPulse gateway (Node 20+). No npm dependencies — uses global fetch + Node builtins.
 *
 * Polls the control plane for pending runs and dispatches them to the
 * configured executor. The gateway itself stays lightweight — it never runs
 * pipeline code directly (except for the "local" executor used in dev).
 *
 * Env (required):
 *   ELTPULSE_AGENT_TOKEN          Bearer secret from the app Gateway page.
 *   ELTPULSE_CONTROL_PLANE_URL    e.g. https://app.eltpulse.dev
 *
 * Env (optional):
 *   ELTPULSE_EXECUTOR             local | docker | kubernetes | ecs  (default: local)
 *   ELTPULSE_EXECUTE_RUNS         Set to "1" to enable run execution. Default off so
 *                                 connecting to prod never mutates runs by accident.
 *   ELTPULSE_MAX_CONCURRENT_RUNS  Max runs in-flight per replica (default: 4).
 *                                 For docker/kubernetes/ecs executors this is just the
 *                                 number of jobs the gateway will launch concurrently —
 *                                 the actual compute scales independently.
 *   ELTPULSE_DRAIN_TIMEOUT_MS     Grace period after SIGTERM (default: 30000).
 *
 * Executor-specific env is documented in gateway/src/executors/*.mjs and in
 * the README scaling section.
 *
 * Cancel protocol:
 *   The control plane sets status="cancelled" when a user clicks Cancel.
 *   The gateway checks before claiming (GET /api/agent/runs/:id → cancel:true)
 *   and on every PATCH response (cancel:true). Each executor handles the
 *   signal in its own way (kill subprocess / stop container / delete Job / stop task).
 */

const baseUrl     = (process.env.ELTPULSE_CONTROL_PLANE_URL || "").replace(/\/$/, "");
const token       = process.env.ELTPULSE_AGENT_TOKEN || "";
const executorKey = (process.env.ELTPULSE_EXECUTOR || "local").toLowerCase();
const executeRuns = ["1", "true", "yes"].includes(String(process.env.ELTPULSE_EXECUTE_RUNS || "").toLowerCase());
const MAX_CONCURRENT_RUNS = Math.max(1, Number(process.env.ELTPULSE_MAX_CONCURRENT_RUNS ?? 4) || 4);
const DRAIN_TIMEOUT_MS    = Math.max(5000, Number(process.env.ELTPULSE_DRAIN_TIMEOUT_MS ?? 30000) || 30000);

if (!baseUrl || !token) {
  console.error("Missing ELTPULSE_CONTROL_PLANE_URL or ELTPULSE_AGENT_TOKEN");
  process.exit(1);
}

// ── Load executor ──────────────────────────────────────────────────────────────

const EXECUTORS = { local: true, docker: true, kubernetes: true, ecs: true };
if (!EXECUTORS[executorKey]) {
  console.error(`Unknown ELTPULSE_EXECUTOR="${executorKey}". Valid values: local, docker, kubernetes, ecs`);
  process.exit(1);
}

// Dynamic import so unused executors don't need their deps available at startup
const { executeRun } = await import(`./executors/${executorKey}.mjs`);
console.log(`[eltpulse-gateway] executor=${executorKey}`);

// ── HTTP helper ────────────────────────────────────────────────────────────────

/** @type {{ runsPoll: number, heartbeat: number } | null} */
let intervals = null;

async function api(path, { method = "GET", json } = {}) {
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  if (json !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(url, {
    method,
    headers,
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = { _raw: text }; }
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> ${res.status}`);
    err.detail = body;
    throw err;
  }
  return body;
}

// ── Control-plane loop ─────────────────────────────────────────────────────────

async function refreshManifest() {
  const m = await api("/api/agent/manifest");
  const billing  = m.billing || {};
  const runsPoll = Math.max(3,  Math.min(120, Number(billing.runsPollIntervalSeconds) || 5));
  const heartbeat = Math.max(5, Math.min(300, Number(billing.heartbeatIntervalSeconds) || 30));
  intervals = { runsPoll, heartbeat };
  console.log(`[eltpulse-gateway] manifest v${m.version} runsPoll=${runsPoll}s heartbeat=${heartbeat}s executor=${executorKey} executeRuns=${executeRuns}`);
  return m;
}

async function sendHeartbeat() {
  await api("/api/agent/heartbeat", {
    method: "POST",
    json: {
      version: "eltpulse-gateway/0.3.0",
      labels: { runtime: "node", executor: executorKey, package: "integrations/gateway" },
    },
  });
}

// ── Connection secrets ─────────────────────────────────────────────────────────

async function fetchConnectionEnv() {
  try {
    const data = await api("/api/agent/connections");
    const env  = {};
    for (const conn of data.connections ?? []) {
      for (const [k, v] of Object.entries(conn.secrets ?? {})) {
        if (typeof v === "string") env[k] = v;
      }
    }
    return env;
  } catch (e) {
    console.warn("[eltpulse-gateway] could not fetch connections:", e.message || e);
    return {};
  }
}

// ── Poll loop ──────────────────────────────────────────────────────────────────

const activeRunIds = new Set();
let draining = false;

async function pollRunsOnce() {
  if (draining) return;

  const available = MAX_CONCURRENT_RUNS - activeRunIds.size;
  if (available <= 0) {
    console.log(`[eltpulse-gateway] at capacity (${activeRunIds.size}/${MAX_CONCURRENT_RUNS}) — skipping poll`);
    return;
  }

  const data = await api(`/api/agent/runs?status=pending&limit=${available}`);
  const runs = Array.isArray(data.runs) ? data.runs : [];
  if (runs.length === 0) return;
  console.log(`[eltpulse-gateway] pending runs: ${runs.length} (capacity ${available}/${MAX_CONCURRENT_RUNS})`);
  if (!executeRuns) return;

  const connEnv = await fetchConnectionEnv();

  for (const run of runs) {
    const id = run.id;
    if (!id || activeRunIds.has(id)) continue;

    // Pre-claim cancel check
    const check = await api(`/api/agent/runs/${id}`);
    if (check.cancel) {
      console.log(`[eltpulse-gateway] run ${id} cancelled before execution — skipping`);
      continue;
    }

    // Atomic claim — 409 means another replica got it first
    let claimed;
    try {
      claimed = await api(`/api/agent/runs/${id}`, {
        method: "PATCH",
        json: {
          status: "running",
          appendLog: { level: "info", message: `eltpulse-gateway: claimed by executor=${executorKey}` },
        },
      });
    } catch (err) {
      if (err.detail?.error?.includes("Already claimed")) {
        console.log(`[eltpulse-gateway] run ${id} claimed by another replica — skipping`);
      } else {
        console.error(`[eltpulse-gateway] failed to claim run ${id}:`, err.message || err);
      }
      continue;
    }

    if (claimed.cancel) {
      console.log(`[eltpulse-gateway] run ${id} cancelled during claim — aborting`);
      continue;
    }

    // Fire and forget — executor handles its own logging and final status PATCH
    activeRunIds.add(id);
    executeRun(run, connEnv, api)
      .catch(async (err) => {
        console.error(`[eltpulse-gateway] executor error run=${id}:`, err.message || err);
        await api(`/api/agent/runs/${id}`, {
          method: "PATCH",
          json: {
            status: "failed",
            appendLog: { level: "error", message: `Gateway executor error: ${err.message || err}` },
            errorSummary: err.message || String(err),
          },
        }).catch(() => {});
      })
      .finally(() => activeRunIds.delete(id));
  }
}

// ── Scheduler ──────────────────────────────────────────────────────────────────

function scheduleLoop() {
  let hbTimer       = null;
  let runTimer      = null;

  const arm = () => {
    if (hbTimer)  clearInterval(hbTimer);
    if (runTimer) clearInterval(runTimer);
    if (!intervals) return;
    hbTimer  = setInterval(() => {
      sendHeartbeat().catch((e) => console.error("[heartbeat]", e.message || e));
    }, intervals.heartbeat * 1000);
    runTimer = setInterval(() => {
      pollRunsOnce().catch((e) => console.error("[runs]", e.message || e));
    }, intervals.runsPoll * 1000);
  };

  setInterval(() => {
    refreshManifest().then(arm).catch((e) => console.error("[manifest]", e.message || e));
  }, 5 * 60 * 1000);

  return refreshManifest()
    .then(arm)
    .then(() => sendHeartbeat())
    .then(() => pollRunsOnce());
}

scheduleLoop().catch((e) => { console.error(e); process.exit(1); });

// ── Graceful drain ─────────────────────────────────────────────────────────────

async function gracefulShutdown(signal) {
  if (draining) return;
  draining = true;
  console.log(`[eltpulse-gateway] ${signal} — draining (${activeRunIds.size} active, timeout ${DRAIN_TIMEOUT_MS}ms)`);
  const deadline = Date.now() + DRAIN_TIMEOUT_MS;
  while (activeRunIds.size > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
  }
  if (activeRunIds.size > 0) {
    console.warn(`[eltpulse-gateway] drain timeout — ${activeRunIds.size} run(s) still tracked, exiting`);
  } else {
    console.log("[eltpulse-gateway] drained cleanly");
  }
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM").catch(() => process.exit(1)));
process.on("SIGINT",  () => gracefulShutdown("SIGINT").catch(() => process.exit(1)));
