output "rest_api_url" {
  description = "Base URL for the REST API"
  value       = module.api_gateway_rest.api_url
}

output "ws_api_url" {
  description = "WebSocket API URL"
  value       = module.api_gateway_ws.api_url
}

output "dynamodb_table_names" {
  description = "DynamoDB table names"
  value       = module.dynamodb.table_names
}

output "web_app_url" {
  description = "URL pública del frontend (CloudFront HTTPS). Copiar a web_app_url en dev.tfvars/prod.tfvars."
  value       = "https://${aws_cloudfront_distribution.web_app.domain_name}"
}

output "web_bucket_name" {
  description = "Nombre del bucket S3 donde subir el build del frontend"
  value       = aws_s3_bucket.web_app.id
}

output "cloudfront_distribution_id" {
  description = "ID de la distribución CloudFront (para invalidaciones)"
  value       = aws_cloudfront_distribution.web_app.id
}
