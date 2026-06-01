# CORS preflight (OPTIONS) for all resources
# Browser sends OPTIONS before every cross-origin request; API Gateway must respond
# with Allow-Origin/Allow-Methods/Allow-Headers before the actual request proceeds.

locals {
  cors_resources = {
    sessions        = aws_api_gateway_resource.sessions.id
    session_id      = aws_api_gateway_resource.session_id.id
    session_start   = aws_api_gateway_resource.session_start.id
    players         = aws_api_gateway_resource.players.id
    game_move       = aws_api_gateway_resource.game_move.id
    game_round_id   = aws_api_gateway_resource.game_round_id.id
    bracket         = aws_api_gateway_resource.bracket.id
    bracket_advance = aws_api_gateway_resource.bracket_advance.id
  }
}

resource "aws_api_gateway_method" "options" {
  for_each      = local.cors_resources
  rest_api_id   = aws_api_gateway_rest_api.rockdrop.id
  resource_id   = each.value
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "options" {
  for_each    = local.cors_resources
  rest_api_id = aws_api_gateway_rest_api.rockdrop.id
  resource_id = each.value
  http_method = aws_api_gateway_method.options[each.key].http_method
  type        = "MOCK"
  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "options_200" {
  for_each    = local.cors_resources
  rest_api_id = aws_api_gateway_rest_api.rockdrop.id
  resource_id = each.value
  http_method = aws_api_gateway_method.options[each.key].http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }

  depends_on = [aws_api_gateway_method.options]
}

resource "aws_api_gateway_integration_response" "options" {
  for_each    = local.cors_resources
  rest_api_id = aws_api_gateway_rest_api.rockdrop.id
  resource_id = each.value
  http_method = aws_api_gateway_method.options[each.key].http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,x-host-token'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,DELETE,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }

  depends_on = [aws_api_gateway_method_response.options_200]
}
