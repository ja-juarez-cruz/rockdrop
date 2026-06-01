terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {}
  # Inyectado via: terraform init -backend-config=backends/dev.hcl
  #             o: terraform init -backend-config=backends/prod.hcl
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      app         = "rockdrop"
      environment = var.environment
      managed_by  = "terraform"
    }
  }
}

module "dynamodb" {
  source      = "./modules/dynamodb"
  environment = var.environment
}

module "lambdas" {
  source          = "./modules/lambdas"
  environment     = var.environment
  dynamodb_tables = module.dynamodb.table_names
  ws_api_id       = module.api_gateway_ws.api_id
  ws_stage        = var.ws_stage
  web_app_url     = var.web_app_url
}

module "api_gateway_rest" {
  source      = "./modules/api_gateway_rest"
  environment = var.environment
  lambdas     = module.lambdas.function_arns
}

module "api_gateway_ws" {
  source      = "./modules/api_gateway_ws"
  environment = var.environment
  lambdas     = module.lambdas.function_arns
}
