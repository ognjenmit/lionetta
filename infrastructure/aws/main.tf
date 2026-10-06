# Future sandbox scaffold. Initialization and validation do not deploy resources.
# A future plan reads the caller identity to scope trust and runtime permissions.
data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  account_id       = data.aws_caller_identity.current.account_id
  arn_prefix       = "arn:${data.aws_partition.current.partition}"
  runtime_arn      = "${local.arn_prefix}:bedrock-agentcore:${var.aws_region}:${local.account_id}:runtime/*"
  runtime_log_arn  = "${local.arn_prefix}:logs:${var.aws_region}:${local.account_id}:log-group:/aws/bedrock-agentcore/runtimes/${var.agent_runtime_name}-*"
  account_logs_arn = "${local.arn_prefix}:logs:${var.aws_region}:${local.account_id}:log-group:*"
}

resource "aws_iam_role" "runtime" {
  name_prefix = "lionetta-agentcore-"
  description = "Execution role for the future Lionetta sandbox runtime."

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "bedrock-agentcore.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = { "aws:SourceAccount" = local.account_id }
        ArnLike      = { "aws:SourceArn" = local.runtime_arn }
      }
    }]
  })
}

resource "aws_iam_role_policy" "runtime" {
  name = "lionetta-runtime-image-and-telemetry"
  role = aws_iam_role.runtime.id

  # AWS's documented runtime telemetry baseline, narrowed to this runtime's logs.
  # This permits telemetry transport; application instrumentation is separate.
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "EcrAuthentication"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Sid    = "ReadPublishedImage"
        Effect = "Allow"
        Action = [
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchCheckLayerAvailability",
        ]
        Resource = var.ecr_repository_arn
      },
      {
        Sid      = "RuntimeLogGroups"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:DescribeLogStreams"]
        Resource = local.runtime_log_arn
      },
      {
        Sid      = "DiscoverLogGroups"
        Effect   = "Allow"
        Action   = ["logs:DescribeLogGroups"]
        Resource = local.account_logs_arn
      },
      {
        Sid      = "WriteRuntimeLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${local.runtime_log_arn}:log-stream:*"
      },
      {
        Sid    = "RuntimeTracing"
        Effect = "Allow"
        Action = [
          "xray:PutTraceSegments",
          "xray:PutTelemetryRecords",
          "xray:GetSamplingRules",
          "xray:GetSamplingTargets",
        ]
        Resource = "*"
      },
      {
        Sid      = "RuntimeMetrics"
        Effect   = "Allow"
        Action   = ["cloudwatch:PutMetricData"]
        Resource = "*"
        Condition = {
          StringEquals = { "cloudwatch:namespace" = "bedrock-agentcore" }
        }
      },
    ]
  })
}

resource "aws_bedrockagentcore_agent_runtime" "lionetta" {
  agent_runtime_name = var.agent_runtime_name
  description        = "Future Lionetta sandbox API runtime; real client integrations require additional configuration."
  role_arn           = aws_iam_role.runtime.arn

  agent_runtime_artifact {
    container_configuration {
      container_uri = var.container_image_uri
    }
  }

  protocol_configuration {
    server_protocol = "HTTP"
  }

  network_configuration {
    network_mode = "PUBLIC"
  }

  environment_variables = {
    HOST     = "0.0.0.0"
    API_PORT = "8080"
    NODE_ENV = "production"
  }

  lifecycle {
    precondition {
      condition     = try(split(":", var.ecr_repository_arn)[4] == local.account_id && split(":", var.ecr_repository_arn)[1] == data.aws_partition.current.partition, false)
      error_message = "Use an ECR repository in the deployment account and partition; cross-account publication is outside this scaffold."
    }
  }

  depends_on = [aws_iam_role_policy.runtime]
}
