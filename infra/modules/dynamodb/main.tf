variable "environment" {
  type = string
}

locals {
  prefix = "rockdrop-${var.environment}"
}

# Sessions table
resource "aws_dynamodb_table" "sessions" {
  name         = "rockdrop-sessions-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "session_id"
  range_key    = "sk"

  attribute {
    name = "session_id"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  attribute {
    name = "qr_token"
    type = "S"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  global_secondary_index {
    name            = "qr_token-index"
    hash_key        = "qr_token"
    projection_type = "ALL"
  }

  tags = {
    app  = "rockdrop"
    name = "sessions"
  }
}

# Players table
resource "aws_dynamodb_table" "players" {
  name         = "rockdrop-players-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "session_id"
  range_key    = "player_id"

  attribute {
    name = "session_id"
    type = "S"
  }

  attribute {
    name = "player_id"
    type = "S"
  }

  attribute {
    name = "ws_connection_id"
    type = "S"
  }

  global_secondary_index {
    name            = "connection-index"
    hash_key        = "ws_connection_id"
    projection_type = "ALL"
  }

  tags = {
    app  = "rockdrop"
    name = "players"
  }
}

# Moves table
resource "aws_dynamodb_table" "moves" {
  name         = "rockdrop-moves-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "player_id"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "player_id"
    type = "S"
  }

  tags = {
    app  = "rockdrop"
    name = "moves"
  }
}

# Rounds table
resource "aws_dynamodb_table" "rounds" {
  name         = "rockdrop-rounds-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "session_id"
  range_key    = "round_number"

  attribute {
    name = "session_id"
    type = "S"
  }

  attribute {
    name = "round_number"
    type = "S"
  }

  tags = {
    app  = "rockdrop"
    name = "rounds"
  }
}

output "table_names" {
  value = {
    sessions = aws_dynamodb_table.sessions.name
    players  = aws_dynamodb_table.players.name
    moves    = aws_dynamodb_table.moves.name
    rounds   = aws_dynamodb_table.rounds.name
  }
}

output "table_arns" {
  value = {
    sessions = aws_dynamodb_table.sessions.arn
    players  = aws_dynamodb_table.players.arn
    moves    = aws_dynamodb_table.moves.arn
    rounds   = aws_dynamodb_table.rounds.arn
  }
}
