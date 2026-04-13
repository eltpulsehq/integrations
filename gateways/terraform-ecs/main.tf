terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

locals {
  container_name = "gateway"
}

resource "aws_ecs_task_definition" "gateway" {
  family                   = var.name_prefix
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn

  container_definitions = jsonencode([
    {
      name      = local.container_name
      image     = var.gateway_image
      essential = true
      environment = [
        { name = "ELTPULSE_CONTROL_PLANE_URL", value = var.control_plane_url }
      ]
      secrets = [
        {
          name      = "ELTPULSE_AGENT_TOKEN"
          valueFrom = var.agent_token_secret_arn
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = var.log_group_name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = local.container_name
        }
      }
    }
  ])
}

resource "aws_ecs_service" "gateway" {
  name            = var.name_prefix
  cluster         = var.ecs_cluster_arn
  task_definition = aws_ecs_task_definition.gateway.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = var.security_group_ids
    assign_public_ip = false
  }

  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 100
}
