/**
 * Kubernetes executor — creates a batch/v1 Job per pipeline run using the
 * in-cluster service account. The Job runs the worker image, patches back
 * logs/status itself, then exits and is cleaned up automatically (TTL).
 *
 * ELTPULSE_RUNNER=kubernetes
 *
 * Required env (usually from Downward API or pod spec):
 *   ELTPULSE_WORKER_IMAGE        Worker image (default: ghcr.io/eltpulsehq/gateway-worker:latest)
 *   ELTPULSE_K8S_NAMESPACE       Namespace for Jobs (default: same as gateway pod — read from serviceaccount)
 *
 * Optional env:
 *   ELTPULSE_WORKER_CPU_REQUEST  CPU request (default: 250m)
 *   ELTPULSE_WORKER_CPU_LIMIT    CPU limit (default: 2)
 *   ELTPULSE_WORKER_MEM_REQUEST  Memory request (default: 256Mi)
 *   ELTPULSE_WORKER_MEM_LIMIT    Memory limit (default: 1Gi)
 *   ELTPULSE_JOB_TTL_SECONDS     TTL after job finishes before auto-delete (default: 3600)
 *
 * The gateway pod's ServiceAccount needs:
 *   - create/get/delete on batch/v1 Jobs in the target namespace
 *   - create on v1 Secrets (for pipeline env — optional; can pass via Job env directly)
 */

import { readFile } from "node:fs/promises";

const WORKER_IMAGE      = process.env.ELTPULSE_WORKER_IMAGE       || "ghcr.io/eltpulsehq/gateway-worker:latest";
const CPU_REQUEST       = process.env.ELTPULSE_WORKER_CPU_REQUEST  || "250m";
const CPU_LIMIT         = process.env.ELTPULSE_WORKER_CPU_LIMIT    || "2";
const MEM_REQUEST       = process.env.ELTPULSE_WORKER_MEM_REQUEST  || "256Mi";
const MEM_LIMIT         = process.env.ELTPULSE_WORKER_MEM_LIMIT    || "1Gi";
const JOB_TTL           = Number(process.env.ELTPULSE_JOB_TTL_SECONDS ?? 3600) || 3600;

const SA_TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token";
const SA_CA_PATH    = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";
const SA_NS_PATH    = "/var/run/secrets/kubernetes.io/serviceaccount/namespace";
const K8S_API       = "https://kubernetes.default.svc";

async function k8sToken() {
  return (await readFile(SA_TOKEN_PATH, "utf8")).trim();
}
async function k8sNamespace() {
  if (process.env.ELTPULSE_K8S_NAMESPACE) return process.env.ELTPULSE_K8S_NAMESPACE;
  return (await readFile(SA_NS_PATH, "utf8")).trim();
}

async function k8sRequest(method, path, body) {
  const token = await k8sToken();
  const res = await fetch(`${K8S_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { _raw: text }; }
  if (!res.ok) {
    const err = new Error(`k8s ${method} ${path} -> ${res.status}`);
    err.detail = parsed;
    throw err;
  }
  return parsed;
}

// ── Executor ──────────────────────────────────────────────────────────────────

export async function executeRun(run, connEnv, api) {
  const id        = run.id;
  const pipeline  = run.pipeline;
  const namespace = await k8sNamespace();

  const jobName = `eltpulse-run-${id.replace(/[^a-z0-9]/gi, "-").toLowerCase().slice(0, 52)}`;

  const envVars = buildWorkerEnvVars(run, connEnv);

  const job = {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name: jobName,
      namespace,
      labels: {
        "app.kubernetes.io/managed-by": "eltpulse-gateway",
        "eltpulse.io/run-id":           id,
        "eltpulse.io/pipeline-id":      pipeline.id,
      },
    },
    spec: {
      ttlSecondsAfterFinished: JOB_TTL,
      backoffLimit: 0, // don't retry — eltPulse controls retries at the run level
      template: {
        metadata: {
          labels: {
            "app.kubernetes.io/name":       "eltpulse-worker",
            "eltpulse.io/run-id":           id,
          },
        },
        spec: {
          restartPolicy: "Never",
          containers: [{
            name:  "worker",
            image: WORKER_IMAGE,
            env:   envVars,
            resources: {
              requests: { cpu: CPU_REQUEST, memory: MEM_REQUEST },
              limits:   { cpu: CPU_LIMIT,   memory: MEM_LIMIT   },
            },
          }],
        },
      },
    },
  };

  console.log(`[kubernetes] creating Job ${jobName} namespace=${namespace} run=${id}`);
  await k8sRequest("POST", `/apis/batch/v1/namespaces/${namespace}/jobs`, job);
  console.log(`[kubernetes] Job ${jobName} created`);

  // Poll Job status, checking for cancel signal from control plane
  await waitForJob(jobName, namespace, id, api);

  // Clean up the Job (TTL will also handle this, but clean up early on cancel)
  await k8sRequest("DELETE", `/apis/batch/v1/namespaces/${namespace}/jobs/${jobName}`, {
    propagationPolicy: "Foreground",
  }).catch(() => {});
}

async function waitForJob(jobName, namespace, runId, api) {
  while (true) {
    await new Promise((r) => setTimeout(r, 5000));

    // Check cancel from control plane
    const check = await api(`/api/agent/runs/${runId}`).catch(() => null);
    if (check?.cancel) {
      console.log(`[kubernetes] cancel signal — deleting Job ${jobName}`);
      await k8sRequest("DELETE", `/apis/batch/v1/namespaces/${namespace}/jobs/${jobName}`, {
        propagationPolicy: "Foreground",
      }).catch(() => {});
      return;
    }

    // Check Job conditions
    const jobStatus = await k8sRequest("GET", `/apis/batch/v1/namespaces/${namespace}/jobs/${jobName}`)
      .catch(() => null);
    if (!jobStatus) return; // Job gone

    const conditions = jobStatus.status?.conditions ?? [];
    const complete = conditions.find((c) => c.type === "Complete"  && c.status === "True");
    const failed   = conditions.find((c) => c.type === "Failed"    && c.status === "True");
    if (complete || failed) {
      console.log(`[kubernetes] Job ${jobName} finished complete=${!!complete} failed=${!!failed}`);
      return;
    }
  }
}

// ── Env var builder ───────────────────────────────────────────────────────────

function buildWorkerEnvVars(run, connEnv) {
  const pipeline = run.pipeline;
  const flat = {
    ELTPULSE_CONTROL_PLANE_URL: process.env.ELTPULSE_CONTROL_PLANE_URL || "",
    ELTPULSE_AGENT_TOKEN:       process.env.ELTPULSE_AGENT_TOKEN || "",
    ELTPULSE_RUN_ID:            run.id,
    ELTPULSE_PIPELINE_TOOL:     pipeline.tool || "dlt",
    ELTPULSE_PARTITION_VALUE:   run.partitionValue  ?? "",
    ELTPULSE_PARTITION_COLUMN:  run.partitionColumn ?? "",
    ...(pipeline.pipelineCode ? { ELTPULSE_PIPELINE_CODE: Buffer.from(pipeline.pipelineCode).toString("base64") } : {}),
    ...(pipeline.configYaml   ? { ELTPULSE_PIPELINE_YAML: Buffer.from(pipeline.configYaml).toString("base64")   } : {}),
    ...connEnv,
    ...Object.fromEntries(
      Object.entries(pipeline.sourceConfiguration ?? {})
        .filter(([k, v]) => typeof v === "string" && /^[A-Z][A-Z0-9_]+$/.test(k))
    ),
  };
  return Object.entries(flat).map(([name, value]) => ({ name, value: String(value) }));
}
