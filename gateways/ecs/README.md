# AWS ECS (Fargate)

[`task-definition.json`](task-definition.json) is a **template**: replace `REPLACE_ME` placeholders, IAM role ARNs, subnet/security group IDs, and **Secrets Manager** ARNs for `ELTPULSE_AGENT_TOKEN`.

## Wiring secrets

Recommended pattern:

1. Store `ELTPULSE_AGENT_TOKEN` in **AWS Secrets Manager** (e.g. secret string).
2. In the task definition `secrets` array, set `valueFrom` to the ARN with `:key::` suffix as required by ECS.
3. Pass `ELTPULSE_CONTROL_PLANE_URL` as plain `environment` (not secret) or also from Secrets Manager if you prefer.

## Register + run

Use the AWS CLI or Terraform (see [`../terraform-ecs`](../terraform-ecs)) to register the task definition and create/update a service in your cluster.

**Execution role** must allow `secretsmanager:GetSecretValue` (and `kms:Decrypt` if CMK) for the token secret. **Task role** is for optional AWS data-plane access from your pipelines, not required for the agent to talk to eltPulse.
