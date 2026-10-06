variable "aws_region" {
  description = "AWS region selected for a future AgentCore sandbox deployment. Verify AgentCore availability first."
  type        = string

  validation {
    condition     = can(regex("^[a-z]{2}(-[a-z]+)+-[0-9]+$", var.aws_region))
    error_message = "Use an AWS region identifier, for example eu-central-1."
  }
}

variable "agent_runtime_name" {
  description = "Name of the future sandbox runtime."
  type        = string
  default     = "lionetta_sandbox"

  validation {
    condition     = can(regex("^[a-zA-Z][a-zA-Z0-9_]{0,47}$", var.agent_runtime_name))
    error_message = "Runtime names start with a letter, contain letters, digits or underscores, and are at most 48 characters."
  }
}

variable "ecr_repository_arn" {
  description = "ARN of an existing ECR repository containing the published ARM64 image; this root does not create or populate ECR."
  type        = string

  validation {
    condition     = can(regex("^arn:aws(-[a-z-]+)?:ecr:[a-z0-9-]+:[0-9]{12}:repository/[a-z0-9][a-z0-9._/-]*$", var.ecr_repository_arn))
    error_message = "Supply an ECR repository ARN, including its region, account and repository name."
  }

  validation {
    condition     = try(split(":", var.ecr_repository_arn)[3] == var.aws_region, false)
    error_message = "The image repository must be in the selected runtime region."
  }
}

variable "container_image_uri" {
  description = "Existing ECR ARM64 image URI pinned by its sha256 digest. Mutable image tags are rejected."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}\\.dkr\\.ecr\\.[a-z0-9-]+\\.amazonaws\\.com(\\.cn)?/[^@[:space:]]+@sha256:[0-9a-f]{64}$", var.container_image_uri))
    error_message = "Supply an ECR image URI ending in @sha256: followed by 64 lowercase hexadecimal characters."
  }

  validation {
    condition = try(
      split(".", var.container_image_uri)[0] == split(":", var.ecr_repository_arn)[4] &&
      split(".", var.container_image_uri)[3] == var.aws_region &&
      split("@", join("/", slice(split("/", var.container_image_uri), 1, length(split("/", var.container_image_uri)))))[0] == trimprefix(split(":", var.ecr_repository_arn)[5], "repository/"),
      false
    )
    error_message = "The image URI must match the account, region and repository named in ecr_repository_arn."
  }
}
