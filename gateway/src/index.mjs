/**
 * Minimal eltPulse gateway (Node 20+). No npm dependencies — uses global fetch.
 *
 * Env (required):
 *   ELTPULSE_AGENT_TOKEN          Bearer secret from the app Gateway page (name kept for compatibility with docs / compose).
 *   ELTPULSE_CONTROL_PLANE_URL    e.g. https://app.eltpulse.dev
 *
 * Env (optional):
 *   ELTPULSE_EXECUTE_RUNS=1       When set, claims pending runs and PATCHes them to succeeded (STUB — no real ELT).
 *                                 Default off so connecting to prod never mutates runs by accident.
 *
 * Cancel protocol:
 *   The control plane sets a run's status to "cancelled" when a user clicks Cancel in the UI.
 *   The gateway checks for cancellation at two points:
 *     1. GET /api/agent/runs/:id before claiming — skips runs already cancelled while pending.
 *     2. PATCH /api/agent/runs/:id returns { cancel: true } if the run was cancelled server-side
 *        while the gateway was executing. Real workload implementations should abort their
 *        subprocess/process when they receive cancel: true from any PATCH response.
 */

const baseUrl = (process.env.ELTPULSE_CONTROL_PLANE_URL || "").replace(/\/$/, "");
const token = process.env.ELTPULSE_AGENT_TOKEN || "";
const executeRuns = ["1", "true", "yes"].includes(
  String(process.env.ELTPULSE_EXECUTE_RUNS || "").toLowerCase()
);

if (!baseUrl || !token) {
  console.error("Missing ELTPULSE_CONTROL_PLANE_URL or ELTPULSE_AGENT_TOKEN");
  process.exit(1);
}

/** @type {{ runsPoll: number, heartbeat: number } | null} */
let intervals = null;

async function api(path, { method = "GET", json } = {}) {
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(url, {
    method,
    headers,
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
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

async function refreshManifest() {
  const m = await api("/api/agent/manifest");
  const billing = m.billing || {};
  const runsPoll = Math.max(3, Math.min(120, Number(billing.runsPollIntervalSeconds) || 5));
  const heartbeat = Math.max(5, Math.min(300, Number(billing.heartbeatIntervalSeconds) || 30));
  intervals = { runsPoll, heartbeat };
  console.log(
    `[eltpulse-gateway] manifest v${m.version} runsPoll=${runsPoll}s heartbeat=${heartbeat}s executeRuns=${executeRuns}`
  );
  return m;
}

async function sendHeartbeat() {
  await api("/api/agent/heartbeat", {
    method: "POST",
    json: {
      version: "eltpulse-gateway/0.1.0",
      labels: { runtime: "node", package: "integrations/gateway" },
    },
  });
}

async function pollRunsOnce() {
  const data = await api("/api/agent/runs?status=pending&limit=5");
  const runs = Array.isArray(data.runs) ? data.runs : [];
  if (runs.length === 0) return;
  console.log(`[eltpulse-gateway] pending runs: ${runs.length}`);
  if (!executeRuns) return;

  for (const run of runs) {
    const id = run.id;
    if (!id) continue;

    // Check for cancellation before claiming — the user may have cancelled while
    // the run was sitting in the pending queue.
    const check = await api(`/api/agent/runs/${id}`);
    if (check.cancel) {
      console.log(`[eltpulse-gateway] run ${id} cancelled before execution — skipping`);
      continue;
    }

    // Claim the run. The PATCH response includes { cancel: true } if the run was
    // cancelled server-side between our check and now. Real workload implementations
    // should also check this flag after every mid-run progress PATCH and abort their
    // subprocess if it's set.
    const claimed = await api(`/api/agent/runs/${id}`, {
      method: "PATCH",
      json: {
        status: "running",
        appendLog: {
          level: "info",
          message:
            "eltpulse-gateway (integrations stub): marking running — no workload executed unless you replace this gateway process.",
        },
      },
    });
    if (claimed.cancel) {
      console.log(`[eltpulse-gateway] run ${id} cancelled during claim — aborting`);
      continue;
    }

    // ── Real workload goes here ──────────────────────────────────────────────
    // Replace this stub with your actual subprocess execution. After each
    // progress PATCH, check the response for { cancel: true } and terminate
    // your subprocess if set, e.g.:
    //
    //   const progress = await api(`/api/agent/runs/${id}`, { method: "PATCH", json: { ... } });
    //   if (progress.cancel) { proc.kill(); return; }
    // ────────────────────────────────────────────────────────────────────────

    await api(`/api/agent/runs/${id}`, {
      method: "PATCH",
      json: {
        status: "succeeded",
        appendLog: {
          level: "info",
          message: "eltpulse-gateway (integrations stub): completed as succeeded for demo only.",
        },
      },
    });
    console.log(`[eltpulse-gateway] stub-completed run ${id}`);
  }
}

function scheduleLoop() {
  let hbTimer = null;
  let runTimer = null;
  let manifestTimer = null;

  const arm = () => {
    if (hbTimer) clearInterval(hbTimer);
    if (runTimer) clearInterval(runTimer);
    if (!intervals) return;
    hbTimer = setInterval(() => {
      sendHeartbeat().catch((e) => console.error("[heartbeat]", e.message || e));
    }, intervals.heartbeat * 1000);
    runTimer = setInterval(() => {
      pollRunsOnce().catch((e) => console.error("[runs]", e.message || e));
    }, intervals.runsPoll * 1000);
  };

  manifestTimer = setInterval(() => {
    refreshManifest()
      .then(arm)
      .catch((e) => console.error("[manifest]", e.message || e));
  }, 5 * 60 * 1000);

  return refreshManifest()
    .then(arm)
    .then(() => sendHeartbeat())
    .then(() => pollRunsOnce());
}

scheduleLoop().catch((e) => {
  console.error(e);
  process.exit(1);
});
