# Terraform — ECS Fargate gateway

Minimal **task definition + service** for one gateway container. You supply VPC, subnets, security groups, and IAM roles.

## Prerequisites

- ECS cluster (existing)
- **Execution role** with `AmazonECSTaskExecutionRolePolicy` + `secretsmanager:GetSecretValue` on your token secret
- **Task role** (can be same as execution for a minimal PoC; tighten for production)
- Secret in **Secrets Manager** holding the raw token string (plain text secret value)
- **CloudWatch log group** `/ecs/eltpulse-gateway` (or change `log_group_name`)

## Usage

```bash
cd gateways/terraform-ecs
terraform init
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars
terraform plan
terraform apply
```

## Variables

See [`variables.tf`](variables.tf). Image defaults to `ghcr.io/eltpulsehq/agent:latest`; override with a digest-pinned URI in production.
