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
