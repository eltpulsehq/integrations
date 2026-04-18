/**
 * ECS executor — runs one Fargate task per pipeline run via the ECS RunTask API.
 * Uses AWS Signature V4 signing — no AWS SDK dependency, just fetch + crypto.
 *
 * ELTPULSE_EXECUTOR=ecs
 *
 * Required env:
 *   ELTPULSE_WORKER_IMAGE         Worker image URI (e.g. ghcr.io/eltpulsehq/gateway-worker:latest
 *                                 or an ECR URI: 123456789.dkr.ecr.us-east-1.amazonaws.com/gateway-worker:latest)
 *   ELTPULSE_ECS_CLUSTER          ECS cluster ARN or name
 *   ELTPULSE_ECS_TASK_DEFINITION  Task definition ARN or family:revision to use as base
 *   ELTPULSE_ECS_SUBNETS          Comma-separated subnet IDs for awsvpc networking
 *   AWS_REGION                    AWS region (or AWS_DEFAULT_REGION)
 *
 * Optional env:
 *   ELTPULSE_ECS_SECURITY_GROUPS  Comma-separated security group IDs
 *   ELTPULSE_ECS_ASSIGN_PUBLIC_IP ENABLED | DISABLED (default: DISABLED)
 *   ELTPULSE_WORKER_CPU           CPU units (default: 512)
 *   ELTPULSE_WORKER_MEMORY        Memory MiB (default: 1024)
 *
 * AWS credentials are read from the standard chain:
 *   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN  — explicit
 *   ECS task role / EC2 instance profile                           — automatic when running on AWS
 */

import { createHmac, createHash } from "node:crypto";

const CLUSTER         = process.env.ELTPULSE_ECS_CLUSTER          || "";
const TASK_DEF        = process.env.ELTPULSE_ECS_TASK_DEFINITION   || "";
const SUBNETS         = (process.env.ELTPULSE_ECS_SUBNETS || "").split(",").map((s) => s.trim()).filter(Boolean);
const SECURITY_GROUPS = (process.env.ELTPULSE_ECS_SECURITY_GROUPS || "").split(",").map((s) => s.trim()).filter(Boolean);
const PUBLIC_IP       = process.env.ELTPULSE_ECS_ASSIGN_PUBLIC_IP || "DISABLED";
const WORKER_CPU      = process.env.ELTPULSE_WORKER_CPU    || "512";
const WORKER_MEMORY   = process.env.ELTPULSE_WORKER_MEMORY || "1024";
const REGION          = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";

// ── AWS SigV4 signing (no SDK) ─────────────────────────────────────────────────

function hmac(key, data) {
  return createHmac("sha256", key).update(data).digest();
}
function sha256hex(data) {
  return createHash("sha256").update(data).digest("hex");
}
function toHex(buf) {
  return buf.toString("hex");
}

async function getAwsCredentials() {
  if (process.env.AWS_ACCESS_KEY_ID) {
    return {
      accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
      sessionToken:    process.env.AWS_SESSION_TOKEN,
    };
  }
  // IMDSv2: ECS task role or EC2 instance profile
  try {
    // ECS task role
    const credsUrl = process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;
    if (credsUrl) {
      const res = await fetch(`http://169.254.170.2${credsUrl}`);
      const d   = await res.json();
      return { accessKeyId: d.AccessKeyId, secretAccessKey: d.SecretAccessKey, sessionToken: d.Token };
    }
    // EC2 instance profile via IMDSv2
    const tokenRes = await fetch("http://169.254.169.254/latest/api/token", {
      method: "PUT", headers: { "X-aws-ec2-metadata-token-ttl-seconds": "21600" },
    });
    const imdsToken = await tokenRes.text();
    const roleRes   = await fetch("http://169.254.169.254/latest/meta-data/iam/security-credentials/", {
      headers: { "X-aws-ec2-metadata-token": imdsToken },
    });
    const role    = (await roleRes.text()).trim();
    const credRes = await fetch(`http://169.254.169.254/latest/meta-data/iam/security-credentials/${role}`, {
      headers: { "X-aws-ec2-metadata-token": imdsToken },
    });
    const d = await credRes.json();
    return { accessKeyId: d.AccessKeyId, secretAccessKey: d.SecretAccessKey, sessionToken: d.Token };
  } catch (e) {
    throw new Error(`Could not retrieve AWS credentials: ${e.message}`);
  }
}

async function ecsRequest(action, body) {
  const creds    = await getAwsCredentials();
  const endpoint = `https://ecs.${REGION}.amazonaws.com/`;
  const now      = new Date();
  const amzDate  = now.toISOString().replace(/[:\-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);
  const payload  = JSON.stringify(body);
  const payloadHash = sha256hex(payload);

  const headers = {
    "content-type":        "application/x-amz-json-1.1",
    "host":                `ecs.${REGION}.amazonaws.com`,
    "x-amz-date":          amzDate,
    "x-amz-target":        `AmazonEC2ContainerServiceV20141113.${action}`,
    ...(creds.sessionToken ? { "x-amz-security-token": creds.sessionToken } : {}),
  };

  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers).sort().map((k) => `${k}:${headers[k]}\n`).join("");
  const canonicalReq = [
    "POST", "/", "",
    canonicalHeaders, signedHeaders, payloadHash,
  ].join("\n");

  const credScope  = `${dateStamp}/${REGION}/ecs/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credScope, sha256hex(canonicalReq)].join("\n");

  const sigKey  = hmac(hmac(hmac(hmac(`AWS4${creds.secretAccessKey}`, dateStamp), REGION), "ecs"), "aws4_request");
  const sig     = toHex(hmac(sigKey, stringToSign));
  const authHeader = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${sig}`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { ...headers, Authorization: authHeader },
    body: payload,
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { _raw: text }; }
  if (!res.ok) {
    const err = new Error(`ECS ${action} -> ${res.status}`);
    err.detail = parsed;
    throw err;
  }
  return parsed;
}

// ── Executor ──────────────────────────────────────────────────────────────────

export async function executeRun(run, connEnv, api) {
  const id       = run.id;
  const pipeline = run.pipeline;

  if (!CLUSTER || !TASK_DEF || SUBNETS.length === 0) {
    throw new Error("ECS executor requires ELTPULSE_ECS_CLUSTER, ELTPULSE_ECS_TASK_DEFINITION, and ELTPULSE_ECS_SUBNETS");
  }

  const envOverrides = buildWorkerEnv(run, connEnv);

  console.log(`[ecs] launching Fargate task for run=${id} cluster=${CLUSTER}`);

  const result = await ecsRequest("RunTask", {
    cluster:        CLUSTER,
    taskDefinition: TASK_DEF,
    launchType:     "FARGATE",
    count:          1,
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets:        SUBNETS,
        securityGroups: SECURITY_GROUPS,
        assignPublicIp: PUBLIC_IP,
      },
    },
    overrides: {
      cpu:    WORKER_CPU,
      memory: WORKER_MEMORY,
      containerOverrides: [{
        name:        "worker",
        environment: envOverrides,
      }],
    },
    tags: [
      { key: "eltpulse:run-id",      value: id },
      { key: "eltpulse:pipeline-id", value: pipeline.id },
    ],
    startedBy: `eltpulse-gateway:${id.slice(0, 36)}`,
  });

  const task = result.tasks?.[0];
  if (!task) {
    const failure = result.failures?.[0];
    throw new Error(`ECS RunTask failed: ${failure?.reason ?? JSON.stringify(result)}`);
  }

  const taskArn = task.taskArn;
  console.log(`[ecs] task launched taskArn=${taskArn} run=${id}`);

  // Poll task status, checking for cancel signal from control plane
  await waitForTask(taskArn, id, api);
}

async function waitForTask(taskArn, runId, api) {
  while (true) {
    await new Promise((r) => setTimeout(r, 8000));

    // Check cancel from control plane
    const check = await api(`/api/agent/runs/${runId}`).catch(() => null);
    if (check?.cancel) {
      console.log(`[ecs] cancel signal — stopping task ${taskArn.split("/").pop()}`);
      await ecsRequest("StopTask", {
        cluster: CLUSTER,
        task:    taskArn,
        reason:  "eltpulse-gateway: cancelled by user",
      }).catch(() => {});
      return;
    }

    // Check task status
    const desc = await ecsRequest("DescribeTasks", {
      cluster: CLUSTER,
      tasks:   [taskArn],
    }).catch(() => null);

    const task = desc?.tasks?.[0];
    if (!task) return; // task gone

    const lastStatus = task.lastStatus;
    if (lastStatus === "STOPPED") {
      const exitCode = task.containers?.[0]?.exitCode;
      console.log(`[ecs] task ${taskArn.split("/").pop()} STOPPED exitCode=${exitCode}`);
      return;
    }
  }
}

// ── Env builder ───────────────────────────────────────────────────────────────

function buildWorkerEnv(run, connEnv) {
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
