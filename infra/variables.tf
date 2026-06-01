variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "environment" {
  type    = string
  default = "dev"
  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "environment must be dev or prod."
  }
}

variable "ws_stage" {
  type    = string
  default = "prod"
}

variable "web_bucket_name" {
  type        = string
  description = "Nombre del bucket S3 para el frontend. Ej: rockdrop-web-dev"
}

variable "web_app_url" {
  type        = string
  default     = ""
  description = "URL del frontend (CloudFront). Rellenar tras el primer deploy con el output web_app_url."
}
