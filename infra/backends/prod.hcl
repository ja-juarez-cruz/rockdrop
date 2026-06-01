bucket         = "rockdrop-terraform-state"
key            = "rockdrop/terraform.tfstate"
region         = "us-east-1"
dynamodb_table = "rockdrop-tfstate-locks-prod"
encrypt        = true
