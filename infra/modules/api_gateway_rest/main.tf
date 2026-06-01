variable "environment" {
  type = string
}

variable "lambdas" {
  type = map(string)
}

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  region     = data.aws_region.current.name
  account_id = data.aws_caller_identity.current.account_id
}

resource "aws_api_gateway_rest_api" "rockdrop" {
  name        = "rockdrop-rest-${var.environment}"
  description = "RockDrop REST API"

  tags = {
    app  = "rockdrop"
    name = "rest-api"
  }
}

# /sessions
resource "aws_api_gateway_resource" "sessions" {
  rest_api_id = aws_api_gateway_rest_api.rockdrop.id
  parent_id   = aws_api_gateway_rest_api.rockdrop.root_resource_id
  path_part   = "sessions"
}

# /sessions/{session_id}
resource "aws_api_gateway_resource" "session_id" {
  rest_api_id = aws_api_gateway_rest_api.rockdrop.id
  parent_id   = aws_api_gateway_resource.sessions.id
  path_part   = "{session_id}"
}

# /sessions/{session_id}/players
resource "aws_api_gateway_resource" "players" {
  rest_api_id = aws_api_gateway_rest_api.rockdrop.id
  parent_id   = aws_api_gateway_resource.session_id.id
  path_part   = "players"
}

# /sessions/{session_id}/game
resource "aws_api_gateway_resource" "game" {
  rest_api_id = aws_api_gateway_rest_api.rockdrop.id
  parent_id   = aws_api_gateway_resource.session_id.id
  path_part   = "game"
}

# /sessions/{session_id}/game/move
resource "aws_api_gateway_resource" "game_move" {
  rest_api_id = aws_api_gateway_rest_api.rockdrop.id
  parent_id   = aws_api_gateway_resource.game.id
  path_part   = "move"
}

# /sessions/{session_id}/game/round
resource "aws_api_gateway_resource" "game_round" {
  rest_api_id = aws_api_gateway_rest_api.rockdrop.id
  parent_id   = aws_api_gateway_resource.game.id
  path_part   = "round"
}

# /sessions/{session_id}/game/round/{round}
resource "aws_api_gateway_resource" "game_round_id" {
  rest_api_id = aws_api_gateway_rest_api.rockdrop.id
  parent_id   = aws_api_gateway_resource.game_round.id
  path_part   = "{round}"
}

# /sessions/{session_id}/tournament
resource "aws_api_gateway_resource" "tournament" {
  rest_api_id = aws_api_gateway_rest_api.rockdrop.id
  parent_id   = aws_api_gateway_resource.session_id.id
  path_part   = "tournament"
}

# /sessions/{session_id}/tournament/bracket
resource "aws_api_gateway_resource" "bracket" {
  rest_api_id = aws_api_gateway_rest_api.rockdrop.id
  parent_id   = aws_api_gateway_resource.tournament.id
  path_part   = "bracket"
}

# /sessions/{session_id}/tournament/bracket/advance
resource "aws_api_gateway_resource" "bracket_advance" {
  rest_api_id = aws_api_gateway_rest_api.rockdrop.id
  parent_id   = aws_api_gateway_resource.bracket.id
  path_part   = "advance"
}

# --- Methods and integrations ---

locals {
  integrations = {
    create_session   = { resource = aws_api_gateway_resource.sessions.id, http_method = "POST" }
    get_session      = { resource = aws_api_gateway_resource.session_id.id, http_method = "GET" }
    close_session    = { resource = aws_api_gateway_resource.session_id.id, http_method = "DELETE" }
    join_session     = { resource = aws_api_gateway_resource.players.id, http_method = "POST" }
    get_players      = { resource = aws_api_gateway_resource.players.id, http_method = "GET" }
    submit_move      = { resource = aws_api_gateway_resource.game_move.id, http_method = "POST" }
    get_round_result = { resource = aws_api_gateway_resource.game_round_id.id, http_method = "GET" }
    generate_bracket = { resource = aws_api_gateway_resource.bracket.id, http_method = "POST" }
    advance_bracket  = { resource = aws_api_gateway_resource.bracket_advance.id, http_method = "PUT" }
    get_bracket      = { resource = aws_api_gateway_resource.bracket.id, http_method = "GET" }
  }
}

resource "aws_api_gateway_method" "methods" {
  for_each = local.integrations

  rest_api_id   = aws_api_gateway_rest_api.rockdrop.id
  resource_id   = each.value.resource
  http_method   = each.value.http_method
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "integrations" {
  for_each = local.integrations

  rest_api_id             = aws_api_gateway_rest_api.rockdrop.id
  resource_id             = each.value.resource
  http_method             = aws_api_gateway_method.methods[each.key].http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = "arn:aws:apigateway:${local.region}:lambda:path/2015-03-31/functions/${var.lambdas[each.key]}/invocations"
}

resource "aws_lambda_permission" "apigw_invoke" {
  for_each = local.integrations

  statement_id  = "AllowAPIGatewayInvoke-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = var.lambdas[each.key]
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.rockdrop.execution_arn}/*/*"
}

resource "aws_api_gateway_deployment" "rockdrop" {
  rest_api_id = aws_api_gateway_rest_api.rockdrop.id

  depends_on = [
    aws_api_gateway_integration.integrations,
    aws_api_gateway_integration.options,
  ]

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_api_gateway_stage" "prod" {
  deployment_id = aws_api_gateway_deployment.rockdrop.id
  rest_api_id   = aws_api_gateway_rest_api.rockdrop.id
  stage_name    = var.environment

  tags = {
    app  = "rockdrop"
    name = "rest-api-stage"
  }
}

output "api_url" {
  value = aws_api_gateway_stage.prod.invoke_url
}

output "api_id" {
  value = aws_api_gateway_rest_api.rockdrop.id
}
