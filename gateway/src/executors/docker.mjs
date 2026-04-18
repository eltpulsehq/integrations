/**
 * Docker executor — launches one `docker run` container per pipeline run via
 * the Docker socket HTTP API. No Docker CLI required on PATH.
 *
 * ELTPULSE_EXECUTOR=docker
 *
 * Required env:
 *   ELTPULSE_WORKER_IMAGE   Worker image to run (default: ghcr.io/eltpulsehq/gateway-worker:latest)
 *
 * Optional env:
 *   ELTPULSE_DOCKER_SOCKET  Path to Docker socket (default: /var/run/docker.sock)
 *   ELTPULSE_WORKER_CPU     CPU shares (default: 1024)
 *   ELTPULSE_WORKER_MEMORY  Memory limit in bytes (default: 512 MiB)
 *   ELTPULSE_WORKER_NETWORK Docker network to attach (default: bridge)
 */

import { createConnection } from "node:net";

const WORKER_IMAGE   = process.env.ELTPULSE_WORKER_IMAGE   || "ghcr.io/eltpulsehq/gateway-worker:latest";
const DOCKER_SOCKET  = process.env.ELTPULSE_DOCKER_SOCKET  || "/var/run/docker.sock";
const WORKER_CPU     = Number(process.env.ELTPULSE_WORKER_CPU)    || 1024;
const WORKER_MEMORY  = Number(process.env.ELTPULSE_WORKER_MEMORY) || 512 * 1024 * 1024;
const WORKER_NETWORK = process.env.ELTPULSE_WORKER_NETWORK || "bridge";

// ── Docker socket HTTP ────────────────────────────────────────────────────────

function dockerRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = [
      `${method} ${path} HTTP/1.1`,
      `Host: localhost`,
      `Accept: application/json`,
      ...(payload ? [`Content-Type: application/json`, `Content-Length: ${Buffer.byteLength(payload)}`] : []),
      `Connection: close`,
      ``,
      ...(payload ? [payload] : [``]),
    ].join("\r\n");

    const sock = createConnection(DOCKER_SOCKET);
    let raw = "";
    sock.on("data",  (c) => { raw += c.toString(); });
    sock.on("error", reject);
    sock.on("end", () => {
      const [head, ...rest] = raw.split("\r\n\r\n");
      const statusLine = head.split("\r\n")[0];
      const status = parseInt(statusLine.split(" ")[1], 10);
      const bodyStr = rest.join("\r\n\r\n");
      let parsed;
      try { parsed = JSON.parse(bodyStr); } catch { parsed = { _raw: bodyStr }; }
      if (status >= 400) {
        const err = new Error(`Docker API ${method} ${path} -> ${status}`);
        err.detail = parsed;
        return reject(err);
      }
      resolve(parsed);
    });
    sock.write(req);
  });
}

// ── Executor ──────────────────────────────────────────────────────────────────

export async function executeRun(run, connEnv, api) {
  const id       = run.id;
  const pipeline = run.pipeline;

  // Build env array for the container
  const env = buildWorkerEnv(run, connEnv);

  console.log(`[docker] launching worker for run=${id} image=${WORKER_IMAGE}`);

  // Create container
  const container = await dockerRequest("POST", "/containers/create", {
    Image: WORKER_IMAGE,
    Env: env,
    HostConfig: {
      CpuShares: WORKER_CPU,
      Memory: WORKER_MEMORY,
      NetworkMode: WORKER_NETWORK,
      AutoRemove: true, // clean up automatically when the container exits
    },
    Labels: {
      "eltpulse.run-id":      id,
      "eltpulse.pipeline-id": pipeline.id,
      "eltpulse.managed":     "true",
    },
  });

  const containerId = container.Id;
  console.log(`[docker] started container=${containerId.slice(0, 12)} run=${id}`);

  // Start container
  await dockerRequest("POST", `/containers/${containerId}/start`, null).catch((e) => {
    // 304 = already started, not an error
    if (!String(e.message).includes("304")) throw e;
  });

  // Poll container status until it exits, checking for cancel
  await waitForContainer(containerId, id, api);
}

async function waitForContainer(containerId, runId, api) {
  while (true) {
    await new Promise((r) => setTimeout(r, 3000));

    // Check cancel from control plane
    const check = await api(`/api/agent/runs/${runId}`).catch(() => null);
    if (check?.cancel) {
      console.log(`[docker] cancel signal — stopping container=${containerId.slice(0, 12)}`);
      await dockerRequest("POST", `/containers/${containerId}/stop`, null).catch(() => {});
      return;
    }

    // Check container state
    const info = await dockerRequest("GET", `/containers/${containerId}/json`, null).catch(() => null);
    if (!info) return; // container gone (AutoRemove kicked in)
    if (!info.State?.Running) {
      console.log(`[docker] container=${containerId.slice(0, 12)} exited status=${info.State?.ExitCode}`);
      return;
    }
  }
}

// ── Shared env builder ────────────────────────────────────────────────────────

function buildWorkerEnv(run, connEnv) {
  const pipeline = run.pipeline;
  const env = {
    ELTPULSE_CONTROL_PLANE_URL:  process.env.ELTPULSE_CONTROL_PLANE_URL || "",
    ELTPULSE_AGENT_TOKEN:        process.env.ELTPULSE_AGENT_TOKEN || "",
    ELTPULSE_RUN_ID:             run.id,
    ELTPULSE_PIPELINE_TOOL:      pipeline.tool || "dlt",
    ELTPULSE_PARTITION_VALUE:    run.partitionValue  ?? "",
    ELTPULSE_PARTITION_COLUMN:   run.partitionColumn ?? "",
    // Pass pipeline code as base64 so it survives env var encoding
    ...(pipeline.pipelineCode ? { ELTPULSE_PIPELINE_CODE: Buffer.from(pipeline.pipelineCode).toString("base64") } : {}),
    ...(pipeline.configYaml   ? { ELTPULSE_PIPELINE_YAML: Buffer.from(pipeline.configYaml).toString("base64")   } : {}),
    // Connection secrets
    ...connEnv,
    // Uppercase keys from sourceConfiguration
    ...Object.fromEntries(
      Object.entries(pipeline.sourceConfiguration ?? {})
        .filter(([k, v]) => typeof v === "string" && /^[A-Z][A-Z0-9_]+$/.test(k))
    ),
  };
  return Object.entries(env).map(([k, v]) => `${k}=${v}`);
}
