variable "environment" {
  type = string
}

variable "dynamodb_tables" {
  type = map(string)
}

variable "ws_api_id" {
  type = string
}

variable "ws_stage" {
  type = string
}

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  region     = data.aws_region.current.name
  account_id = data.aws_caller_identity.current.account_id
  lambdas_path = "${path.root}/../../lambdas"

  lambda_definitions = {
    create_session   = { dir = "session", timeout = 10 }
    get_session      = { dir = "session", timeout = 10 }
    close_session    = { dir = "session", timeout = 10 }
    join_session     = { dir = "player", timeout = 10 }
    get_players      = { dir = "player", timeout = 10 }
    submit_move      = { dir = "game", timeout = 10 }
    resolve_round    = { dir = "game", timeout = 10 }
    get_round_result = { dir = "game", timeout = 10 }
    generate_bracket = { dir = "tournament", timeout = 10 }
    advance_bracket  = { dir = "tournament", timeout = 10 }
    get_bracket      = { dir = "tournament", timeout = 10 }
    connect          = { dir = "websocket", timeout = 3 }
    disconnect       = { dir = "websocket", timeout = 3 }
    broadcast        = { dir = "websocket", timeout = 3 }
  }

  common_env = {
    ENVIRONMENT    = var.environment
    SESSIONS_TABLE = var.dynamodb_tables["sessions"]
    PLAYERS_TABLE  = var.dynamodb_tables["players"]
    MOVES_TABLE    = var.dynamodb_tables["moves"]
    ROUNDS_TABLE   = var.dynamodb_tables["rounds"]
    WS_API_ID      = var.ws_api_id
    WS_STAGE       = var.ws_stage
    POWERTOOLS_SERVICE_NAME = "rockdrop"
    LOG_LEVEL      = "INFO"
  }
}

# IAM base role
data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# Common Lambda layer
data "archive_file" "common_layer" {
  type        = "zip"
  source_dir  = "${local.lambdas_path}/layers/common"
  output_path = "${path.module}/builds/common_layer.zip"
}

resource "aws_lambda_layer_version" "common" {
  layer_name          = "rockdrop-common-${var.environment}"
  filename            = data.archive_file.common_layer.output_path
  source_code_hash    = data.archive_file.common_layer.output_base64sha256
  compatible_runtimes = ["python3.12"]

  lifecycle {
    create_before_destroy = true
  }
}

# DynamoDB policy for each lambda (least-privilege per function defined below)
resource "aws_iam_role" "lambda_roles" {
  for_each = local.lambda_definitions

  name               = "rockdrop-${each.key}-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json

  tags = {
    app      = "rockdrop"
    function = each.key
  }
}

resource "aws_iam_role_policy_attachment" "basic_execution" {
  for_each = local.lambda_definitions

  role       = aws_iam_role.lambda_roles[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "dynamo_ssm_ws" {
  statement {
    sid    = "DynamoDBAccess"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:Scan",
    ]
    resources = [
      "arn:aws:dynamodb:${local.region}:${local.account_id}:table/rockdrop-*",
    ]
  }

  statement {
    sid    = "SSMAccess"
    effect = "Allow"
    actions = ["ssm:GetParameter", "ssm:GetParameters"]
    resources = [
      "arn:aws:ssm:${local.region}:${local.account_id}:parameter/rockdrop/*",
    ]
  }

  statement {
    sid    = "WebSocketPost"
    effect = "Allow"
    actions = ["execute-api:ManageConnections"]
    resources = [
      "arn:aws:execute-api:${local.region}:${local.account_id}:${var.ws_api_id}/*",
    ]
  }

  statement {
    sid    = "EventBridgePut"
    effect = "Allow"
    actions = ["events:PutEvents"]
    resources = ["arn:aws:events:${local.region}:${local.account_id}:event-bus/default"]
  }
}

resource "aws_iam_policy" "rockdrop_lambda_policy" {
  name   = "rockdrop-lambda-policy-${var.environment}"
  policy = data.aws_iam_policy_document.dynamo_ssm_ws.json

  tags = {
    app = "rockdrop"
  }
}

resource "aws_iam_role_policy_attachment" "rockdrop_policy" {
  for_each = local.lambda_definitions

  role       = aws_iam_role.lambda_roles[each.key].name
  policy_arn = aws_iam_policy.rockdrop_lambda_policy.arn
}

# Lambda zip archives
data "archive_file" "lambda_zips" {
  for_each = local.lambda_definitions

  type        = "zip"
  source_file = "${local.lambdas_path}/${each.value.dir}/${each.key}.py"
  output_path = "${path.module}/builds/${each.key}.zip"
}

# Lambda functions
resource "aws_lambda_function" "functions" {
  for_each = local.lambda_definitions

  function_name    = "rockdrop-${each.key}-${var.environment}"
  role             = aws_iam_role.lambda_roles[each.key].arn
  handler          = "${each.key}.handler"
  runtime          = "python3.12"
  timeout          = each.value.timeout
  filename         = data.archive_file.lambda_zips[each.key].output_path
  source_code_hash = data.archive_file.lambda_zips[each.key].output_base64sha256
  layers           = [aws_lambda_layer_version.common.arn]

  environment {
    variables = local.common_env
  }

  tags = {
    app      = "rockdrop"
    function = each.key
  }
}

# EventBridge rule for resolve_round
resource "aws_cloudwatch_event_rule" "all_moves_submitted" {
  name        = "rockdrop-all-moves-submitted-${var.environment}"
  description = "Fired when all players submit their move in a round"

  event_pattern = jsonencode({
    source      = ["rockdrop.game"]
    detail-type = ["AllMovesSubmitted"]
    detail = {
      session_id   = [{ exists = true }]
      round_number = [{ exists = true }]
    }
  })

  tags = {
    app = "rockdrop"
  }
}

resource "aws_cloudwatch_event_target" "resolve_round" {
  rule      = aws_cloudwatch_event_rule.all_moves_submitted.name
  target_id = "resolve_round"
  arn       = aws_lambda_function.functions["resolve_round"].arn
}

resource "aws_lambda_permission" "eventbridge_resolve_round" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.functions["resolve_round"].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.all_moves_submitted.arn
}

output "function_arns" {
  value = { for k, v in aws_lambda_function.functions : k => v.arn }
}

output "function_names" {
  value = { for k, v in aws_lambda_function.functions : k => v.function_name }
}
