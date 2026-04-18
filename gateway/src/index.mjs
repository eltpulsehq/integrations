/**
 * eltPulse gateway (Node 20+). No npm dependencies — uses global fetch + Node builtins.
 *
 * Env (required):
 *   ELTPULSE_AGENT_TOKEN          Bearer secret from the app Gateway page.
 *   ELTPULSE_CONTROL_PLANE_URL    e.g. https://app.eltpulse.dev
 *
 * Env (optional):
 *   ELTPULSE_EXECUTE_RUNS=1       Enable actual run execution (default off so connecting to
 *                                 prod never mutates runs by accident).
 *   ELTPULSE_WORK_DIR             Directory for temp pipeline files (default: /tmp/eltpulse).
 *   ELTPULSE_LOG_BATCH_LINES=20   How many log lines to buffer before flushing a PATCH (default 20).
 *   ELTPULSE_LOG_BATCH_MS=3000    Max ms to hold a log batch before flushing (default 3000).
 *
 * Cancel protocol:
 *   The control plane sets status="cancelled" when a user clicks Cancel in the UI.
 *   The gateway checks for cancellation at two points:
 *     1. GET /api/agent/runs/:id before claiming — skips runs already cancelled while pending.
 *     2. PATCH /api/agent/runs/:id returns { cancel: true } mid-run — subprocess is killed.
 *
 * Runtime requirements (in container or host):
 *   dlt pipelines  → python3 + pip install dlt[<destination>]
 *   sling pipelines → sling binary on PATH (https://slingdata.io)
 */

import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const baseUrl = (process.env.ELTPULSE_CONTROL_PLANE_URL || "").replace(/\/$/, "");
const token = process.env.ELTPULSE_AGENT_TOKEN || "";
const executeRuns = ["1", "true", "yes"].includes(
  String(process.env.ELTPULSE_EXECUTE_RUNS || "").toLowerCase()
);
const workDir = process.env.ELTPULSE_WORK_DIR || join(tmpdir(), "eltpulse");
const LOG_BATCH_LINES = Math.max(1, Number(process.env.ELTPULSE_LOG_BATCH_LINES ?? 20) || 20);
const LOG_BATCH_MS = Math.max(500, Number(process.env.ELTPULSE_LOG_BATCH_MS ?? 3000) || 3000);
// Max concurrent runs this replica will execute simultaneously.
// Scale OUT by adding replicas rather than raising this too high.
const MAX_CONCURRENT_RUNS = Math.max(1, Number(process.env.ELTPULSE_MAX_CONCURRENT_RUNS ?? 4) || 4);

if (!baseUrl || !token) {
  console.error("Missing ELTPULSE_CONTROL_PLANE_URL or ELTPULSE_AGENT_TOKEN");
  process.exit(1);
}

/** @type {{ runsPoll: number, heartbeat: number } | null} */
let intervals = null;

// ── HTTP helper ────────────────────────────────────────────────────────────────

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

// ── Control-plane loop ─────────────────────────────────────────────────────────

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
      version: "eltpulse-gateway/0.2.0",
      labels: { runtime: "node", package: "integrations/gateway" },
    },
  });
}

// ── Connection secrets ─────────────────────────────────────────────────────────

/** Fetches all connections and returns a flat { envKey: value } map. */
async function fetchConnectionEnv() {
  try {
    const data = await api("/api/agent/connections");
    const env = {};
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

// ── Run execution ──────────────────────────────────────────────────────────────

/**
 * Execute a single run — write pipeline files, spawn the process, stream logs
 * back as PATCH requests, handle cancel, clean up temp files.
 *
 * @param {object} run   Full run object from GET /api/agent/runs
 * @param {object} connEnv  Flat { envKey: value } map from /api/agent/connections
 * @returns {Promise<void>}
 */
async function executeRun(run, connEnv) {
  const id = run.id;
  const pipeline = run.pipeline;
  const tool = pipeline.tool; // "dlt" or "sling"

  // ── Write temp files ───────────────────────────────────────────────────────
  let tmpDir;
  try {
    tmpDir = await mkdtemp(join(workDir, `run-${id}-`));
  } catch {
    // workDir may not exist yet — fall back to OS tmpdir
    tmpDir = await mkdtemp(join(tmpdir(), `eltpulse-run-${id}-`));
  }

  const cleanup = async () => {
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  };

  try {
    // Build the subprocess command and write necessary files.
    let cmd, args, cwd;

    if (tool === "sling") {
      // Write replication YAML
      const yamlPath = join(tmpDir, "replication.yaml");
      await writeFile(yamlPath, pipeline.configYaml ?? "", "utf8");
      cmd = "sling";
      args = ["run", "--replication", yamlPath];
      // Inject partition value as sling --select flag if present
      if (run.partitionValue) {
        args.push("--select", run.partitionValue);
      }
      cwd = tmpDir;
    } else {
      // dlt — write the Python pipeline script
      const scriptPath = join(tmpDir, "pipeline.py");
      await writeFile(scriptPath, pipeline.pipelineCode ?? "", "utf8");
      // Write workspace YAML if present (dlt project config)
      if (pipeline.workspaceYaml) {
        await writeFile(join(tmpDir, ".dlt", "config.toml"), pipeline.workspaceYaml, "utf8");
      }
      cmd = "python3";
      args = [scriptPath];
      cwd = tmpDir;
    }

    // ── Build environment ────────────────────────────────────────────────────
    // Start from the gateway process env, layer in connection secrets, then
    // add partition values so the pipeline script can read them.
    const env = {
      ...process.env,
      ...connEnv,
      // Partition / slice values available to both dlt and sling scripts
      ELT_PARTITION_VALUE: run.partitionValue ?? "",
      ELT_PARTITION_COLUMN: run.partitionColumn ?? "",
      // dbt var names if set on the pipeline transform node
      ...(run.partitionValue ? { elt_partition_value: run.partitionValue } : {}),
      ...(run.partitionColumn ? { elt_partition_column: run.partitionColumn } : {}),
    };

    // Also inject any per-field env vars from sourceConfiguration
    // (e.g. GITHUB_TOKEN, SNOWFLAKE_ACCOUNT, etc.)
    const sc = pipeline.sourceConfiguration ?? {};
    for (const [k, v] of Object.entries(sc)) {
      if (typeof v === "string" && /^[A-Z][A-Z0-9_]+$/.test(k)) {
        env[k] = v;
      }
    }

    console.log(`[eltpulse-gateway] executing run ${id} tool=${tool} cmd=${cmd} ${args.join(" ")}`);

    // ── Spawn ────────────────────────────────────────────────────────────────
    const proc = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });

    let cancelled = false;

    /**
     * Log batching — collect stdout/stderr lines and flush to the control plane
     * every LOG_BATCH_LINES lines or every LOG_BATCH_MS ms, whichever comes first.
     */
    let logBuffer = [];
    let flushTimer = null;

    const flushLogs = async (finalStatus) => {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      if (logBuffer.length === 0 && !finalStatus) return;
      const lines = logBuffer.splice(0);
      try {
        const payload = {};
        if (lines.length > 0) {
          payload.appendLog = { level: "info", message: lines.join("\n") };
        }
        if (finalStatus) payload.status = finalStatus;
        const resp = await api(`/api/agent/runs/${id}`, { method: "PATCH", json: payload });
        if (resp.cancel && !cancelled) {
          cancelled = true;
          console.log(`[eltpulse-gateway] run ${id} cancel signal received — killing process`);
          proc.kill("SIGTERM");
          setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /**/ } }, 5000);
        }
      } catch (e) {
        console.error(`[eltpulse-gateway] log flush failed for run ${id}:`, e.message || e);
      }
    };

    const scheduledFlush = () => {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = setTimeout(() => { flushLogs().catch(() => {}); }, LOG_BATCH_MS);
    };

    const onLine = (line) => {
      process.stdout.write(`[run:${id}] ${line}\n`);
      logBuffer.push(line);
      if (logBuffer.length >= LOG_BATCH_LINES) {
        flushLogs().catch(() => {});
      } else {
        scheduledFlush();
      }
    };

    // Stream stdout and stderr line by line
    let stdoutBuf = "";
    proc.stdout.on("data", (chunk) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop(); // keep incomplete line in buffer
      for (const line of lines) if (line) onLine(line);
    });

    let stderrBuf = "";
    proc.stderr.on("data", (chunk) => {
      stderrBuf += chunk.toString();
      const lines = stderrBuf.split("\n");
      stderrBuf = lines.pop();
      for (const line of lines) if (line) onLine(`[stderr] ${line}`);
    });

    // ── Wait for process exit ────────────────────────────────────────────────
    const exitCode = await new Promise((resolve) => {
      proc.on("close", (code) => resolve(code ?? 1));
      proc.on("error", (err) => {
        onLine(`[error] failed to spawn: ${err.message}`);
        resolve(1);
      });
    });

    // Flush any remaining buffered lines before final status PATCH
    if (stdoutBuf) onLine(stdoutBuf);
    if (stderrBuf) onLine(`[stderr] ${stderrBuf}`);

    const finalStatus = cancelled ? "cancelled" : exitCode === 0 ? "succeeded" : "failed";
    await flushLogs(finalStatus);

    if (exitCode !== 0 && !cancelled) {
      // Also set errorSummary so the UI shows what went wrong
      await api(`/api/agent/runs/${id}`, {
        method: "PATCH",
        json: { errorSummary: `Process exited with code ${exitCode}` },
      }).catch(() => {});
    }

    console.log(`[eltpulse-gateway] run ${id} finished status=${finalStatus} exitCode=${exitCode}`);
  } finally {
    await cleanup();
  }
}

// ── Poll loop ──────────────────────────────────────────────────────────────────

// Track runs currently being executed so we don't double-claim on the next poll.
const activeRunIds = new Set();

// Set to true when a SIGTERM is received — stops claiming new runs so the
// replica drains gracefully before the container is replaced.
let draining = false;

async function pollRunsOnce() {
  if (draining) return; // don't pick up new work while draining

  const available = MAX_CONCURRENT_RUNS - activeRunIds.size;
  if (available <= 0) {
    console.log(`[eltpulse-gateway] at capacity (${activeRunIds.size}/${MAX_CONCURRENT_RUNS}) — skipping poll`);
    return;
  }

  const data = await api(`/api/agent/runs?status=pending&limit=${available}`);
  const runs = Array.isArray(data.runs) ? data.runs : [];
  if (runs.length === 0) return;
  console.log(`[eltpulse-gateway] pending runs: ${runs.length} (capacity: ${available}/${MAX_CONCURRENT_RUNS})`);
  if (!executeRuns) return;

  // Fetch connection secrets once per poll cycle (shared across all runs this batch)
  const connEnv = await fetchConnectionEnv();

  for (const run of runs) {
    const id = run.id;
    if (!id) continue;

    // Skip runs already being executed by this gateway process
    if (activeRunIds.has(id)) continue;

    // Check for cancellation before claiming — the user may have cancelled while
    // the run was sitting in the pending queue.
    const check = await api(`/api/agent/runs/${id}`);
    if (check.cancel) {
      console.log(`[eltpulse-gateway] run ${id} cancelled before execution — skipping`);
      continue;
    }

    // Claim the run atomically. The server uses an updateMany with status=pending
    // guard — if another replica claimed it first, we get a 409 and skip it.
    // The PATCH response also includes { cancel: true } if cancelled between our
    // pre-check and the claim.
    let claimed;
    try {
      claimed = await api(`/api/agent/runs/${id}`, {
        method: "PATCH",
        json: {
          status: "running",
          appendLog: { level: "info", message: "eltpulse-gateway: run claimed, starting execution" },
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

    // Execute the run asynchronously so the poll loop isn't blocked.
    activeRunIds.add(id);
    executeRun(run, connEnv)
      .catch(async (err) => {
        console.error(`[eltpulse-gateway] run ${id} execution error:`, err.message || err);
        await api(`/api/agent/runs/${id}`, {
          method: "PATCH",
          json: {
            status: "failed",
            appendLog: { level: "error", message: `Gateway execution error: ${err.message || err}` },
            errorSummary: err.message || String(err),
          },
        }).catch(() => {});
      })
      .finally(() => {
        activeRunIds.delete(id);
      });
  }
}

// ── Scheduler ──────────────────────────────────────────────────────────────────

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

// ── Graceful drain on SIGTERM / SIGINT ─────────────────────────────────────────
// Kubernetes sends SIGTERM before killing a pod. We stop claiming new runs and
// wait for any in-flight executions to finish (up to DRAIN_TIMEOUT_MS) before
// exiting, so runs aren't left stuck in "running" status when a replica is replaced.
const DRAIN_TIMEOUT_MS = Math.max(5000, Number(process.env.ELTPULSE_DRAIN_TIMEOUT_MS ?? 30000) || 30000);

async function gracefulShutdown(signal) {
  if (draining) return;
  draining = true;
  console.log(`[eltpulse-gateway] ${signal} received — draining (${activeRunIds.size} active runs, timeout ${DRAIN_TIMEOUT_MS}ms)`);

  const deadline = Date.now() + DRAIN_TIMEOUT_MS;
  while (activeRunIds.size > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
  }

  if (activeRunIds.size > 0) {
    console.warn(`[eltpulse-gateway] drain timeout — ${activeRunIds.size} run(s) still active, exiting anyway`);
  } else {
    console.log("[eltpulse-gateway] all runs drained, exiting cleanly");
  }
  process.exit(0);
}

process.on("SIGTERM", () => { gracefulShutdown("SIGTERM").catch(() => process.exit(1)); });
process.on("SIGINT",  () => { gracefulShutdown("SIGINT").catch(() => process.exit(1)); });
