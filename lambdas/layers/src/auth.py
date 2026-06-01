import os
import boto3
from jose import jwt, JWTError

_ssm = boto3.client("ssm")
_secret_cache: str | None = None


def _get_secret() -> str:
    global _secret_cache
    if _secret_cache is None:
        env = os.environ.get("ENVIRONMENT", "dev")
        param = _ssm.get_parameter(
            Name=f"/rockdrop/{env}/JWT_SECRET", WithDecryption=True
        )
        _secret_cache = param["Parameter"]["Value"]
    return _secret_cache


def create_qr_token(session_id: str, exp_seconds: int = 3600) -> str:
    from datetime import datetime, timezone, timedelta
    secret = _get_secret()
    payload = {
        "session_id": session_id,
        "exp": datetime.now(timezone.utc) + timedelta(seconds=exp_seconds),
        "iss": "rockdrop",
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def validate_qr_token(token: str) -> dict:
    """Returns decoded payload or raises JWTError."""
    secret = _get_secret()
    return jwt.decode(token, secret, algorithms=["HS256"])
