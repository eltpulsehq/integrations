variable "name_prefix" {
  type        = string
  description = "Prefix for ECS resources"
  default     = "eltpulse-gateway"
}

variable "agent_image" {
  type        = string
  description = "Gateway container image (pin digest in production)"
  default     = "ghcr.io/eltpulsehq/agent:latest"
}

variable "control_plane_url" {
  type        = string
  description = "eltPulse app origin, e.g. https://app.eltpulse.dev"
}

variable "agent_token_secret_arn" {
  type        = string
  description = "Secrets Manager ARN for ELTPULSE_AGENT_TOKEN (full secret ARN)"
}

variable "ecs_cluster_arn" {
  type        = string
  description = "Existing ECS cluster ARN"
}

variable "subnet_ids" {
  type        = list(string)
  description = "Private subnets for awsvpc tasks (egress to eltPulse + data plane)"
}

variable "security_group_ids" {
  type        = list(string)
  description = "Security groups attached to the task ENI (allow outbound HTTPS)"
}

variable "execution_role_arn" {
  type        = string
  description = "ECS task execution role ARN"
}

variable "task_role_arn" {
  type        = string
  description = "ECS task role ARN (can equal execution_role_arn for minimal setups)"
}

variable "desired_count" {
  type        = number
  default     = 1
}

variable "aws_region" {
  type        = string
  description = "Region for CloudWatch logs resource name in task definition"
}

variable "log_group_name" {
  type        = string
  default     = "/ecs/eltpulse-gateway"
}
