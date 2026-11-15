"""
Minimal test: can this AWS account/region call a small Bedrock model
and get a real response back? Uses the Converse API, so the same code
works for any model.

Run:
    python test_bedrock_llama.py
    python test_bedrock_llama.py google.gemma-3-4b-it
"""

import sys
import boto3

DEFAULT_MODEL_ID = "mistral.ministral-3-3b-instruct"
BEDROCK_REGION = "ap-south-1"

TEST_PROMPT = "In one sentence, what is Amazon S3 used for?"


def main():
    model_id = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_MODEL_ID

    print(f"Region: {BEDROCK_REGION}")
    print(f"Model:  {model_id}")
    print(f"Prompt: {TEST_PROMPT}\n")

    bedrock = boto3.client("bedrock-runtime", region_name=BEDROCK_REGION)

    print("Calling Bedrock...\n")
    try:
        response = bedrock.converse(
            modelId=model_id,
            messages=[{"role": "user", "content": [{"text": TEST_PROMPT}]}],
            inferenceConfig={"maxTokens": 128, "temperature": 0.2},
        )
    except Exception as e:
        print("FAILED to call Bedrock.")
        print(f"Error: {e}")
        return

    # Some models return extra blocks (e.g. reasoning), so pick out the text
    blocks = response["output"]["message"]["content"]
    generation = " ".join(b["text"] for b in blocks if "text" in b).strip()

    print("SUCCESS\n")
    print(f"Response: {generation}\n")
    print(f"Stop reason: {response.get('stopReason')}")
    print(f"Input tokens: {response['usage']['inputTokens']}")
    print(f"Output tokens: {response['usage']['outputTokens']}")
    print(f"Latency (ms): {response.get('metrics', {}).get('latencyMs')}")


if __name__ == "__main__":
    main()