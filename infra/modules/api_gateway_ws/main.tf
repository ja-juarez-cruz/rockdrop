variable "environment" {
  type = string
}

variable "lambdas" {
  type = map(string)
}

data "aws_region" "current" {}

resource "aws_apigatewayv2_api" "rockdrop_ws" {
  name                       = "rockdrop-ws-${var.environment}"
  protocol_type              = "WEBSOCKET"
  route_selection_expression = "$request.body.action"

  tags = {
    app  = "rockdrop"
    name = "websocket-api"
  }
}

# $connect route
resource "aws_apigatewayv2_integration" "connect" {
  api_id           = aws_apigatewayv2_api.rockdrop_ws.id
  integration_type = "AWS_PROXY"
  integration_uri  = var.lambdas["connect"]
}

resource "aws_apigatewayv2_route" "connect" {
  api_id    = aws_apigatewayv2_api.rockdrop_ws.id
  route_key = "$connect"
  target    = "integrations/${aws_apigatewayv2_integration.connect.id}"
}

# $disconnect route
resource "aws_apigatewayv2_integration" "disconnect" {
  api_id           = aws_apigatewayv2_api.rockdrop_ws.id
  integration_type = "AWS_PROXY"
  integration_uri  = var.lambdas["disconnect"]
}

resource "aws_apigatewayv2_route" "disconnect" {
  api_id    = aws_apigatewayv2_api.rockdrop_ws.id
  route_key = "$disconnect"
  target    = "integrations/${aws_apigatewayv2_integration.disconnect.id}"
}

# $default route
resource "aws_apigatewayv2_integration" "broadcast" {
  api_id           = aws_apigatewayv2_api.rockdrop_ws.id
  integration_type = "AWS_PROXY"
  integration_uri  = var.lambdas["broadcast"]
}

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.rockdrop_ws.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.broadcast.id}"
}

resource "aws_apigatewayv2_stage" "prod" {
  api_id      = aws_apigatewayv2_api.rockdrop_ws.id
  name        = var.environment
  auto_deploy = true

  tags = {
    app  = "rockdrop"
    name = "websocket-stage"
  }
}

resource "aws_lambda_permission" "ws_connect" {
  statement_id  = "AllowWSConnect"
  action        = "lambda:InvokeFunction"
  function_name = var.lambdas["connect"]
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.rockdrop_ws.execution_arn}/*/*"
}

resource "aws_lambda_permission" "ws_disconnect" {
  statement_id  = "AllowWSDisconnect"
  action        = "lambda:InvokeFunction"
  function_name = var.lambdas["disconnect"]
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.rockdrop_ws.execution_arn}/*/*"
}

resource "aws_lambda_permission" "ws_broadcast" {
  statement_id  = "AllowWSBroadcast"
  action        = "lambda:InvokeFunction"
  function_name = var.lambdas["broadcast"]
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.rockdrop_ws.execution_arn}/*/*"
}

output "api_url" {
  value = aws_apigatewayv2_stage.prod.invoke_url
}

output "api_id" {
  value = aws_apigatewayv2_api.rockdrop_ws.id
}
