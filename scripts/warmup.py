#!/usr/bin/env python3
"""
Warm up all RockDrop Lambda functions before a live talk/demo.
Invokes each function with a lightweight ping payload to prime the execution environment.
"""

import json
import boto3
import argparse
import concurrent.futures
from datetime import datetime

FUNCTIONS = [
    "create_session",
    "get_session",
    "close_session",
    "join_session",
    "get_players",
    "submit_move",
    "resolve_round",
    "get_round_result",
    "generate_bracket",
    "advance_bracket",
    "get_bracket",
    "connect",
    "disconnect",
    "broadcast",
]

PING_PAYLOAD = json.dumps({"source": "warmup", "ping": True}).encode()


def warmup_function(client, function_name: str, environment: str) -> dict:
    full_name = f"rockdrop-{function_name}-{environment}"
    start = datetime.utcnow()
    try:
        resp = client.invoke(
            FunctionName=full_name,
            InvocationType="RequestResponse",
            Payload=PING_PAYLOAD,
        )
        duration_ms = (datetime.utcnow() - start).total_seconds() * 1000
        status = resp["StatusCode"]
        return {"function": full_name, "status": status, "duration_ms": round(duration_ms, 1), "ok": status == 200}
    except Exception as e:
        return {"function": full_name, "status": "ERROR", "error": str(e), "ok": False}


def main():
    parser = argparse.ArgumentParser(description="Warm up RockDrop Lambdas")
    parser.add_argument("--env", default="prod", choices=["dev", "prod"])
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--concurrency", type=int, default=5)
    args = parser.parse_args()

    client = boto3.client("lambda", region_name=args.region)
    print(f"Warming up {len(FUNCTIONS)} functions in {args.env} ({args.region})...\n")

    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        futures = {executor.submit(warmup_function, client, fn, args.env): fn for fn in FUNCTIONS}
        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            results.append(result)
            icon = "✓" if result["ok"] else "✗"
            duration = result.get("duration_ms", "N/A")
            print(f"  {icon} {result['function']} — {duration}ms")

    failed = [r for r in results if not r["ok"]]
    print(f"\nDone. {len(results) - len(failed)}/{len(results)} functions warmed up successfully.")
    if failed:
        print("Failed:")
        for r in failed:
            print(f"  - {r['function']}: {r.get('error', r.get('status'))}")


if __name__ == "__main__":
    main()
