"""Initialize non-secret release state before creating/upgrading the AWS stack.

Existing service state is adopted; existing parameters are never overwritten.
Run as the infrastructure administrator, with AWS_DEFAULT_REGION set.
"""

import argparse
import json
import subprocess


def aws(*args):
    result = subprocess.run(
        ["aws", *args, "--output", "json", "--no-cli-pager"],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout) if result.stdout.strip() else {}


def initialize(stack_name):
    count, revision = "0", "bootstrap"
    try:
        stack = aws("cloudformation", "describe-stacks", "--stack-name", stack_name)[
            "Stacks"
        ][0]
    except subprocess.CalledProcessError as error:
        if "does not exist" not in error.stderr:
            raise
    else:
        outputs = {o["OutputKey"]: o["OutputValue"] for o in stack["Outputs"]}
        service = aws(
            "ecs",
            "describe-services",
            "--cluster",
            outputs["ClusterName"],
            "--services",
            outputs["ServiceName"],
        )["services"][0]
        if service["desiredCount"] not in {0, 1}:
            raise ValueError("Only one API worker is supported")
        count, revision = str(service["desiredCount"]), service["taskDefinition"]
        if count == "1" and (
            service["runningCount"] != 1
            or service["pendingCount"] != 0
            or len(service["deployments"]) != 1
            or service["deployments"][0].get("rolloutState") != "COMPLETED"
        ):
            raise ValueError(
                "Wait for the active deployment to complete before adopting it"
            )
    prefix = f"/lumi/{stack_name}"
    for name, value in (("task-definition", revision), ("desired-count", count)):
        try:
            aws(
                "ssm",
                "put-parameter",
                "--name",
                prefix + "/" + name,
                "--type",
                "String",
                "--value",
                value,
            )
        except subprocess.CalledProcessError as error:
            if "ParameterAlreadyExists" not in error.stderr:
                raise
    print("Release state initialized; existing values preserved.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--stack-name", required=True)
    initialize(parser.parse_args().stack_name)
