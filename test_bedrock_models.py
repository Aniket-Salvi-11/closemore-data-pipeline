"""
Tests one tiny Converse API call per candidate model in ap-south-1, with
boto3 retries OFF, so each model gets exactly one request and a throttle
shows up as a throttle instead of being hidden by automatic retries.

Converse is model-agnostic (no per-model prompt format needed), so the same
call works across providers.

Run:
    python test_bedrock_models.py

Some model IDs may fail for reasons other than throttling (e.g. a model
that only supports cross-region inference needs an inference-profile ID,
or access/use-case details may be required). The error code printed for
each model says which.
"""

import time

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

REGION = "ap-south-1"

# Candidates whose on-demand RPM quota showed 100 in Service Quotas, plus
# Llama 3 8B (8 RPM) for comparison. Edit freely.
MODEL_IDS = [
    "meta.llama3-8b-instruct-v1:0",
    "mistral.mistral-large-3-675b-instruct",
    "nvidia.nemotron-nano-12b-v2",
    "nvidia.nemotron-nano-9b-v2",
    "deepseek.v3.2",
    "minimax.minimax-m2",
    "openai.gpt-oss-20b-1:0",
    "openai.gpt-oss-120b-1:0",
    "qwen.qwen3-32b-v1:0",
    "mistral.ministral-3-8b-instruct",
]

client = boto3.client(
    "bedrock-runtime",
    region_name=REGION,
    config=Config(retries={"max_attempts": 1}),
)


def test_model(model_id):
    start = time.time()
    try:
        resp = client.converse(
            modelId=model_id,
            messages=[{"role": "user", "content": [{"text": "Reply with the single word OK."}]}],
            inferenceConfig={"maxTokens": 20, "temperature": 0.0},
        )
        elapsed = time.time() - start
        blocks = resp["output"]["message"]["content"]
        text = "".join(b.get("text", "") for b in blocks).strip()
        return "OK", f"{elapsed:.1f}s  reply={text[:40]!r}"
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "Unknown")
        msg = e.response.get("Error", {}).get("Message", "")
        return code, msg[:110]
    except Exception as e:
        return "Error", str(e)[:110]


def main():
    print(f"Region: {REGION}  (one request per model, retries off)\n")
    print(f"{'MODEL ID':<46}{'RESULT':<26}DETAIL")
    print("-" * 130)
    for model_id in MODEL_IDS:
        status, detail = test_model(model_id)
        print(f"{model_id:<46}{status:<26}{detail}")
        time.sleep(3)  # spacing so one model's calls can't eat another's per-minute budget


if __name__ == "__main__":
    main()