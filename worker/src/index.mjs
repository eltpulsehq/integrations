/**
 * eltPulse pipeline worker (Node 20+).
 *
 * Runs as a short-lived container/task — one per pipeline run. Receives the
 * full run context via environment variables, executes the pipeline (dlt or
 * sling), streams logs back to the control plane, then exits.
 *
 * Required env:
 *   ELTPULSE_CONTROL_PLANE_URL   e.g. https://app.eltpulse.dev
 *   ELTPULSE_AGENT_TOKEN         Bearer token for the control plane API
 *   ELTPULSE_RUN_ID              The run ID to execute
 *
 * Optional env (injected by the gateway executor):
 *   ELTPULSE_PIPELINE_TOOL       "dlt" | "sling" (default: read from run payload)
 *   ELTPULSE_PIPELINE_CODE       dlt Python script (base64-encoded)
 *   ELTPULSE_PIPELINE_YAML       sling replication YAML (base64-encoded)
 *   ELTPULSE_PARTITION_VALUE     slice value for this run
 *   ELTPULSE_PARTITION_COLUMN    slice column name
 *   ELTPULSE_WORK_DIR            temp file directory (default: /tmp/eltpulse)
 *   ELTPULSE_LOG_BATCH_LINES     lines to buffer before flushing (default: 20)
 *   ELTPULSE_LOG_BATCH_MS        max ms before flushing (default: 3000)
 *
 * All connection secret env vars (GITHUB_TOKEN, SNOWFLAKE_ACCOUNT, etc.) are
 * passed through directly — the gateway executor layers them in from
 * GET /api/agent/connections before launching this container.
 */

import { spawn } from "node:child_process";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const baseUrl = (process.env.ELTPULSE_CONTROL_PLANE_URL || "").replace(/\/$/, "");
const token   = process.env.ELTPULSE_AGENT_TOKEN || "";
const runId   = process.env.ELTPULSE_RUN_ID || "";

if (!baseUrl || !token || !runId) {
  console.error("[eltpulse-worker] Missing ELTPULSE_CONTROL_PLANE_URL, ELTPULSE_AGENT_TOKEN, or ELTPULSE_RUN_ID");
  process.exit(1);
}

const workDir        = process.env.ELTPULSE_WORK_DIR || join(tmpdir(), "eltpulse");
const LOG_BATCH_LINES = Math.max(1,   Number(process.env.ELTPULSE_LOG_BATCH_LINES ?? 20)   || 20);
const LOG_BATCH_MS    = Math.max(500, Number(process.env.ELTPULSE_LOG_BATCH_MS    ?? 3000)  || 3000);

// ── HTTP helper ────────────────────────────────────────────────────────────────

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

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  // Fetch the run to get pipeline details (in case env vars aren't fully
  // populated — the gateway may pass everything via env but we always verify).
  const { run, cancel } = await api(`/api/agent/runs/${runId}`);
  if (cancel) {
    console.log(`[eltpulse-worker] run ${runId} is already cancelled — exiting`);
    process.exit(0);
  }

  const pipeline = run.pipeline;
  const tool = process.env.ELTPULSE_PIPELINE_TOOL || pipeline.tool || "dlt";

  // Decode pipeline content from env (base64) or fall back to API payload
  const pipelineCode = process.env.ELTPULSE_PIPELINE_CODE
    ? Buffer.from(process.env.ELTPULSE_PIPELINE_CODE, "base64").toString("utf8")
    : (pipeline.pipelineCode ?? "");
  const pipelineYaml = process.env.ELTPULSE_PIPELINE_YAML
    ? Buffer.from(process.env.ELTPULSE_PIPELINE_YAML, "base64").toString("utf8")
    : (pipeline.configYaml ?? "");

  const partitionValue  = process.env.ELTPULSE_PARTITION_VALUE  ?? run.partitionValue  ?? "";
  const partitionColumn = process.env.ELTPULSE_PARTITION_COLUMN ?? run.partitionColumn ?? "";

  // ── Write temp files ─────────────────────────────────────────────────────────
  let tmpDir;
  try {
    await mkdir(workDir, { recursive: true });
    tmpDir = await mkdtemp(join(workDir, `run-${runId}-`));
  } catch {
    tmpDir = await mkdtemp(join(tmpdir(), `eltpulse-run-${runId}-`));
  }

  const cleanup = async () => {
    try { await rm(tmpDir, { recursive: true, force: true }); } catch { /**/ }
  };

  let cmd, args;

  if (tool === "sling") {
    const yamlPath = join(tmpDir, "replication.yaml");
    await writeFile(yamlPath, pipelineYaml, "utf8");
    cmd  = "sling";
    args = ["run", "--replication", yamlPath];
    if (partitionValue) args.push("--select", partitionValue);
  } else {
    const scriptPath = join(tmpDir, "pipeline.py");
    await writeFile(scriptPath, pipelineCode, "utf8");
    if (pipeline.workspaceYaml) {
      await mkdir(join(tmpDir, ".dlt"), { recursive: true });
      await writeFile(join(tmpDir, ".dlt", "config.toml"), pipeline.workspaceYaml, "utf8");
    }
    cmd  = "python3";
    args = [scriptPath];
  }

  // ── Build env ────────────────────────────────────────────────────────────────
  // Process env already has connection secrets injected by the gateway executor.
  const env = {
    ...process.env,
    ELT_PARTITION_VALUE:  partitionValue,
    ELT_PARTITION_COLUMN: partitionColumn,
    ...(partitionValue  ? { elt_partition_value:  partitionValue  } : {}),
    ...(partitionColumn ? { elt_partition_column: partitionColumn } : {}),
  };

  // Inject any uppercase env-var-style keys from sourceConfiguration directly
  const sc = pipeline.sourceConfiguration ?? {};
  for (const [k, v] of Object.entries(sc)) {
    if (typeof v === "string" && /^[A-Z][A-Z0-9_]+$/.test(k)) env[k] = v;
  }

  console.log(`[eltpulse-worker] run=${runId} tool=${tool} cmd=${cmd} ${args.join(" ")}`);

  // ── Spawn ────────────────────────────────────────────────────────────────────
  const proc = spawn(cmd, args, { cwd: tmpDir, env, stdio: ["ignore", "pipe", "pipe"] });

  let cancelled  = false;
  let logBuffer  = [];
  let flushTimer = null;

  const flushLogs = async (finalStatus) => {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (logBuffer.length === 0 && !finalStatus) return;
    const lines = logBuffer.splice(0);
    try {
      const payload = {};
      if (lines.length > 0) payload.appendLog = { level: "info", message: lines.join("\n") };
      if (finalStatus)       payload.status    = finalStatus;
      const resp = await api(`/api/agent/runs/${runId}`, { method: "PATCH", json: payload });
      if (resp.cancel && !cancelled) {
        cancelled = true;
        console.log(`[eltpulse-worker] cancel signal — killing process`);
        proc.kill("SIGTERM");
        setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /**/ } }, 5000);
      }
    } catch (e) {
      console.error(`[eltpulse-worker] log flush error:`, e.message || e);
    }
  };

  const scheduledFlush = () => {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => { flushLogs().catch(() => {}); }, LOG_BATCH_MS);
  };

  const onLine = (line) => {
    process.stdout.write(`${line}\n`);
    logBuffer.push(line);
    if (logBuffer.length >= LOG_BATCH_LINES) flushLogs().catch(() => {});
    else scheduledFlush();
  };

  let stdoutBuf = "";
  proc.stdout.on("data", (chunk) => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split("\n"); stdoutBuf = lines.pop();
    for (const l of lines) if (l) onLine(l);
  });

  let stderrBuf = "";
  proc.stderr.on("data", (chunk) => {
    stderrBuf += chunk.toString();
    const lines = stderrBuf.split("\n"); stderrBuf = lines.pop();
    for (const l of lines) if (l) onLine(`[stderr] ${l}`);
  });

  const exitCode = await new Promise((resolve) => {
    proc.on("close", (code) => resolve(code ?? 1));
    proc.on("error", (err)  => { onLine(`[error] spawn failed: ${err.message}`); resolve(1); });
  });

  if (stdoutBuf) onLine(stdoutBuf);
  if (stderrBuf) onLine(`[stderr] ${stderrBuf}`);

  const finalStatus = cancelled ? "cancelled" : exitCode === 0 ? "succeeded" : "failed";
  await flushLogs(finalStatus);

  if (exitCode !== 0 && !cancelled) {
    await api(`/api/agent/runs/${runId}`, {
      method: "PATCH",
      json: { errorSummary: `Process exited with code ${exitCode}` },
    }).catch(() => {});
  }

  console.log(`[eltpulse-worker] finished status=${finalStatus} exitCode=${exitCode}`);
  await cleanup();
  process.exit(exitCode === 0 || cancelled ? 0 : 1);
}

main().catch((err) => {
  console.error("[eltpulse-worker] fatal:", err.message || err);
  // Best-effort: mark the run failed before exiting
  fetch(`${baseUrl}/api/agent/runs/${runId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      status: "failed",
      appendLog: { level: "error", message: `Worker fatal error: ${err.message || err}` },
      errorSummary: err.message || String(err),
    }),
  }).catch(() => {}).finally(() => process.exit(1));
});
