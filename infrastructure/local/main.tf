terraform {
  required_version = "~> 1.16.0"
}

variable "port" {
  description = "Local Lionetta API port; set the same API_PORT in .env."
  type        = number
  default     = 8080
  validation {
    condition     = var.port >= 1 && var.port <= 65535 && floor(var.port) == var.port
    error_message = "The port must be an integer between 1 and 65535."
  }
}

output "local_runtime" {
  description = "Development contract only. Terraform does not start the Node process."
  value = {
    host            = "127.0.0.1"
    port            = var.port
    health_path     = "/ping"
    invocation_path = "/invocations"
    mode            = "demo"
    process_start   = "npm run dev"
    future_cloud    = "AWS Bedrock AgentCore Runtime"
  }
}
