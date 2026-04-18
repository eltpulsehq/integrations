/**
 * Local executor — runs the pipeline as a subprocess inside the gateway process.
 * Used for laptop/dev deployments where spinning up new compute isn't needed.
 *
 * ELTPULSE_RUNNER=local (or unset — this is the default)
 */

import { spawn }                    from "node:child_process";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join }                     from "node:path";
import { tmpdir }                   from "node:os";

const workDir        = process.env.ELTPULSE_WORK_DIR     || join(tmpdir(), "eltpulse");
const LOG_BATCH_LINES = Math.max(1,   Number(process.env.ELTPULSE_LOG_BATCH_LINES ?? 20)  || 20);
const LOG_BATCH_MS    = Math.max(500, Number(process.env.ELTPULSE_LOG_BATCH_MS    ?? 3000) || 3000);

/**
 * @param {object} run       Full run object from control plane
 * @param {object} connEnv   Flat { envKey: value } map from /api/agent/connections
 * @param {function} api     Authenticated API helper from gateway
 */
export async function executeRun(run, connEnv, api) {
  const id       = run.id;
  const pipeline = run.pipeline;
  const tool     = pipeline.tool;

  let tmpDir;
  try {
    await mkdir(workDir, { recursive: true });
    tmpDir = await mkdtemp(join(workDir, `run-${id}-`));
  } catch {
    tmpDir = await mkdtemp(join(tmpdir(), `eltpulse-run-${id}-`));
  }

  const cleanup = async () => {
    try { await rm(tmpDir, { recursive: true, force: true }); } catch { /**/ }
  };

  try {
    let cmd, args;

    if (tool === "sling") {
      const yamlPath = join(tmpDir, "replication.yaml");
      await writeFile(yamlPath, pipeline.configYaml ?? "", "utf8");
      cmd  = "sling";
      args = ["run", "--replication", yamlPath];
      if (run.partitionValue) args.push("--select", run.partitionValue);
    } else {
      const scriptPath = join(tmpDir, "pipeline.py");
      await writeFile(scriptPath, pipeline.pipelineCode ?? "", "utf8");
      if (pipeline.workspaceYaml) {
        await mkdir(join(tmpDir, ".dlt"), { recursive: true });
        await writeFile(join(tmpDir, ".dlt", "config.toml"), pipeline.workspaceYaml, "utf8");
      }
      cmd  = "python3";
      args = [scriptPath];
    }

    const env = {
      ...process.env,
      ...connEnv,
      ELT_PARTITION_VALUE:  run.partitionValue  ?? "",
      ELT_PARTITION_COLUMN: run.partitionColumn ?? "",
      ...(run.partitionValue  ? { elt_partition_value:  run.partitionValue  } : {}),
      ...(run.partitionColumn ? { elt_partition_column: run.partitionColumn } : {}),
    };
    const sc = pipeline.sourceConfiguration ?? {};
    for (const [k, v] of Object.entries(sc)) {
      if (typeof v === "string" && /^[A-Z][A-Z0-9_]+$/.test(k)) env[k] = v;
    }

    console.log(`[local] run=${id} tool=${tool} cmd=${cmd} ${args.join(" ")}`);
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
        if (lines.length)  payload.appendLog = { level: "info", message: lines.join("\n") };
        if (finalStatus)   payload.status    = finalStatus;
        const resp = await api(`/api/agent/runs/${id}`, { method: "PATCH", json: payload });
        if (resp.cancel && !cancelled) {
          cancelled = true;
          proc.kill("SIGTERM");
          setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /**/ } }, 5000);
        }
      } catch (e) {
        console.error(`[local] log flush error run=${id}:`, e.message || e);
      }
    };

    const scheduledFlush = () => {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = setTimeout(() => flushLogs().catch(() => {}), LOG_BATCH_MS);
    };

    const onLine = (line) => {
      process.stdout.write(`[run:${id}] ${line}\n`);
      logBuffer.push(line);
      if (logBuffer.length >= LOG_BATCH_LINES) flushLogs().catch(() => {});
      else scheduledFlush();
    };

    let stdoutBuf = "";
    proc.stdout.on("data", (c) => {
      stdoutBuf += c.toString();
      const lines = stdoutBuf.split("\n"); stdoutBuf = lines.pop();
      for (const l of lines) if (l) onLine(l);
    });

    let stderrBuf = "";
    proc.stderr.on("data", (c) => {
      stderrBuf += c.toString();
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
      await api(`/api/agent/runs/${id}`, {
        method: "PATCH",
        json: { errorSummary: `Process exited with code ${exitCode}` },
      }).catch(() => {});
    }
    console.log(`[local] run=${id} status=${finalStatus} exitCode=${exitCode}`);
  } finally {
    await cleanup();
  }
}
