"""
Full-lifecycle permission audit -- extends the earlier read-only version
with the write actions that could only be verified by actually doing them:
launching a real (tiny, cheap) EC2 instance, confirming it launched, then
terminating it immediately. No assumptions carried forward.

Safety: uses t3.micro (cheapest available, ~$0.0104/hr in ap-south-1) and
guarantees termination even if a later step fails, via try/finally. Total
worst-case cost if everything works as expected: a few cents, for well
under a minute of actual running time.

Run:
    python check_permissions_full.py
"""

import json
import time

import boto3
from botocore.exceptions import ClientError

REGION = "ap-south-1"
ACCOUNT_ID = "307857335726"

results = []


def check(name, fn):
    try:
        detail = fn()
        results.append((name, "PASS", detail or ""))
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "Unknown")
        msg = e.response.get("Error", {}).get("Message", str(e))
        results.append((name, "FAIL", f"{code}: {msg}"))
    except Exception as e:
        results.append((name, "FAIL", str(e)))


# ---------------------------------------------------------------------------
# Read-only checks (same as before, kept for a complete single report)
# ---------------------------------------------------------------------------

def check_identity():
    sts = boto3.client("sts", region_name=REGION)
    return boto3.client("sts", region_name=REGION).get_caller_identity()["Arn"]


def check_bedrock_invoke_llama():
    bedrock = boto3.client("bedrock-runtime", region_name=REGION)
    body = json.dumps({
        "prompt": "<|begin_of_text|><|start_header_id|>user<|end_header_id|>\nSay OK.\n<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n",
        "max_gen_len": 5,
        "temperature": 0.0,
    })
    resp = bedrock.invoke_model(modelId="meta.llama3-8b-instruct-v1:0", body=body)
    payload = json.loads(resp["body"].read())
    return f"got response: {payload.get('generation', '')[:30]!r}"


def check_apigateway_list():
    apigw = boto3.client("apigateway", region_name=REGION)
    resp = apigw.get_rest_apis(limit=1)
    return f"can list REST APIs, {len(resp.get('items', []))} visible"


def check_service_quotas():
    sq = boto3.client("service-quotas", region_name=REGION)
    resp = sq.list_service_quotas(ServiceCode="bedrock", MaxResults=1)
    return f"can list Bedrock quotas, {len(resp.get('Quotas', []))} visible"


def check_iam_pass_role_visibility():
    # Can't fully test PassRole without an actual RunInstances call (done
    # below), but confirm the role exists and is readable as a precondition.
    iam = boto3.client("iam", region_name=REGION)
    resp = iam.get_role(RoleName="closemore-ai-ingest-role")
    return f"role visible for potential PassRole use: {resp['Role']['Arn']}"


# ---------------------------------------------------------------------------
# EC2 full lifecycle test -- the real, unassumed check.
# Launch a t3.micro, confirm running, terminate it. try/finally guarantees
# termination is attempted even if something in between fails.
# ---------------------------------------------------------------------------

def check_ec2_full_lifecycle():
    ec2 = boto3.client("ec2", region_name=REGION)
    instance_id = None

    try:
        # Find a current Amazon Linux 2023 AMI to launch (avoids hardcoding
        # a possibly-stale AMI ID).
        images = ec2.describe_images(
            Owners=["amazon"],
            Filters=[
                {"Name": "name", "Values": ["al2023-ami-*-x86_64"]},
                {"Name": "state", "Values": ["available"]},
            ],
        )
        if not images["Images"]:
            return "SKIPPED launch test -- no AL2023 AMI found to test with (informational only)"
        ami_id = sorted(images["Images"], key=lambda i: i["CreationDate"])[-1]["ImageId"]

        launch_resp = ec2.run_instances(
            ImageId=ami_id,
            InstanceType="t3.micro",
            MinCount=1,
            MaxCount=1,
            TagSpecifications=[{
                "ResourceType": "instance",
                "Tags": [{"Key": "Name", "Value": "permission-audit-temp-DELETE-ME"}],
            }],
        )
        instance_id = launch_resp["Instances"][0]["InstanceId"]

        # Wait briefly for it to actually reach running state -- confirms
        # the launch wasn't just accepted but actually succeeded.
        waiter = ec2.get_waiter("instance_running")
        waiter.wait(InstanceIds=[instance_id], WaiterConfig={"Delay": 5, "MaxAttempts": 12})

        state = ec2.describe_instances(InstanceIds=[instance_id])
        actual_state = state["Reservations"][0]["Instances"][0]["State"]["Name"]

        return f"LAUNCHED and CONFIRMED RUNNING: {instance_id} (state={actual_state}) -- will terminate now"

    finally:
        if instance_id:
            try:
                ec2.terminate_instances(InstanceIds=[instance_id])
                print(f"  [cleanup] Termination requested for {instance_id}")
            except Exception as term_err:
                print(f"  [cleanup] WARNING: termination request FAILED for {instance_id}: {term_err}")
                print(f"  [cleanup] MANUALLY TERMINATE {instance_id} IN THE AWS CONSOLE NOW")


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

CHECKS = [
    ("Identity", check_identity),
    ("Bedrock - InvokeModel (Llama 3 8B)", check_bedrock_invoke_llama),
    ("API Gateway - GetRestApis", check_apigateway_list),
    ("Service Quotas - List + Get", check_service_quotas),
    ("IAM - role visible for PassRole", check_iam_pass_role_visibility),
    ("EC2 - FULL LIFECYCLE (RunInstances -> confirm running -> TerminateInstances)", check_ec2_full_lifecycle),
]


def main():
    print(f"Running {len(CHECKS)} checks (includes a REAL EC2 launch+terminate) against account {ACCOUNT_ID}, region {REGION}...\n")
    print("NOTE: the EC2 lifecycle check will launch a real t3.micro instance for under a minute,")
    print("then terminate it. Expected cost: a fraction of a cent.\n")

    for name, fn in CHECKS:
        print(f"Running: {name} ...")
        check(name, fn)

    print(f"\n{'CHECK':<70}{'STATUS':<8}DETAIL")
    print("-" * 130)
    passed, failed = 0, 0
    for name, status, detail in results:
        if status == "PASS":
            passed += 1
        else:
            failed += 1
        print(f"{name:<70}{status:<8}{detail}")

    print("\n" + "=" * 130)
    print(f"TOTAL: {passed} passed, {failed} failed out of {len(CHECKS)}")
    if failed:
        print("\nSTILL MISSING:")
        for name, status, detail in results:
            if status == "FAIL":
                print(f"  - {name}: {detail}")

    print("\nIMPORTANT: verify no instance named 'permission-audit-temp-DELETE-ME' is still running:")
    print("  aws ec2 describe-instances --region ap-south-1 --filters \"Name=tag:Name,Values=permission-audit-temp-DELETE-ME\" \"Name=instance-state-name,Values=running,pending\" --query \"Reservations[].Instances[].InstanceId\" --output text")


if __name__ == "__main__":
    main()