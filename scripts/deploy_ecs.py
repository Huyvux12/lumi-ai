"""Deploy an image pair through the AWS CLI; runtime secrets stay inside ECS.

CloudFormation owns the base configuration, GitHub Actions owns image revisions.
Migration failures leave the running service untouched. A rolled-back service is
reported as a failed deployment even if the ECS stability waiter succeeds.
"""

import copy
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

# DescribeTaskDefinition includes read-only fields that RegisterTaskDefinition rejects.
REGISTER_FIELDS = {
    "family",
    "taskRoleArn",
    "executionRoleArn",
    "networkMode",
    "containerDefinitions",
    "volumes",
    "placementConstraints",
    "requiresCompatibilities",
    "cpu",
    "memory",
    "pidMode",
    "ipcMode",
    "proxyConfiguration",
    "inferenceAccelerators",
    "ephemeralStorage",
    "runtimePlatform",
    "enableFaultInjection",
}


def aws(*args):
    command = ["aws", *args, "--output", "json", "--no-cli-pager"]
    try:
        response = subprocess.run(command, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as error:
        print(error.stderr, file=sys.stderr)
        raise
    return json.loads(response.stdout) if response.stdout.strip() else {}


def definitions(base, frontend_image, backend_image):
    service = {
        key: copy.deepcopy(value)
        for key, value in base.items()
        if key in REGISTER_FIELDS
    }
    containers = {item["name"]: item for item in service["containerDefinitions"]}
    if set(containers) != {"frontend", "backend"}:
        raise ValueError(
            "Expected exactly frontend and backend containers in the base task definition"
        )
    containers["frontend"]["image"] = frontend_image
    containers["backend"]["image"] = backend_image
    migration = copy.deepcopy(service)
    migration["family"] += "-migration"
    backend = next(
        item for item in migration["containerDefinitions"] if item["name"] == "backend"
    )
    backend.pop("healthCheck", None)
    backend.pop("dependsOn", None)
    backend["command"] = [
        "sh",
        "-c",
        "python -m alembic upgrade head && python -m app.cli seed",
    ]
    migration["containerDefinitions"] = [backend]
    return service, migration


def register(definition, directory, name):
    path = Path(directory) / name
    path.write_text(json.dumps(definition))
    return aws("ecs", "register-task-definition", "--cli-input-json", f"file://{path}")[
        "taskDefinition"
    ]["taskDefinitionArn"]


def check_migration(response):
    tasks = response.get("tasks", [])
    if response.get("failures") or len(tasks) != 1:
        raise RuntimeError("Migration task could not be described")
    task = tasks[0]
    containers = task.get("containers", [])
    if (
        task.get("lastStatus") != "STOPPED"
        or len(containers) != 1
        or containers[0].get("exitCode") != 0
    ):
        raise RuntimeError(
            f"Migration failed; inspect ECS task {task['taskArn']} and its CloudWatch logs"
        )


def check_service(response, expected_arn):
    services = response.get("services", [])
    if response.get("failures") or len(services) != 1:
        raise RuntimeError("Service could not be described")
    service = services[0]
    if (
        service["taskDefinition"] != expected_arn
        or service["runningCount"] != 1
        or service["pendingCount"] != 0
        or len(service["deployments"]) != 1
        or service["deployments"][0].get("rolloutState") != "COMPLETED"
    ):
        raise RuntimeError(
            "Service did not deploy the requested revision; check ECS events for rollback or failed health checks"
        )


def validate_release_parameters(stack, stack_name):
    parameters = {p["ParameterKey"]: p["ParameterValue"] for p in stack.get("Parameters", [])}
    expected = {
        "DesiredCountParameter": f"/lumi/{stack_name}/desired-count",
        "TaskDefinitionParameter": f"/lumi/{stack_name}/task-definition",
    }
    if any(parameters.get(key) != value for key, value in expected.items()):
        raise ValueError("Initialize and configure the stack's two /lumi/<stack-name>/ release-state parameters before deploying")


def main():
    cluster, service_name = os.environ["ECS_CLUSTER"], os.environ["ECS_SERVICE"]
    stack_name = os.environ["AWS_STACK_NAME"]
    validate_release_parameters(
        aws("cloudformation", "describe-stacks", "--stack-name", stack_name)["Stacks"][0], stack_name
    )
    base = aws(
        "ecs",
        "describe-task-definition",
        "--task-definition",
        os.environ["ECS_TASK_DEFINITION"],
    )["taskDefinition"]
    service, migration = definitions(
        base, os.environ["FRONTEND_IMAGE"], os.environ["BACKEND_IMAGE"]
    )
    network = {
        "awsvpcConfiguration": {
            "subnets": os.environ["ECS_SUBNETS"].split(","),
            "securityGroups": [os.environ["ECS_SECURITY_GROUP"]],
            "assignPublicIp": "DISABLED",
        }
    }
    with tempfile.TemporaryDirectory() as directory:
        migration_arn = register(migration, directory, "migration.json")
        launched = aws(
            "ecs",
            "run-task",
            "--cluster",
            cluster,
            "--task-definition",
            migration_arn,
            "--launch-type",
            "FARGATE",
            "--platform-version",
            "1.4.0",
            "--network-configuration",
            json.dumps(network),
            "--count",
            "1",
        )
        if launched.get("failures") or len(launched.get("tasks", [])) != 1:
            raise RuntimeError(
                "ECS could not launch the migration; check network configuration and task permissions"
            )
        task_arn = launched["tasks"][0]["taskArn"]
        print(f"Waiting for migration: {task_arn}", flush=True)
        try:
            aws(
                "ecs",
                "wait",
                "tasks-stopped",
                "--cluster",
                cluster,
                "--tasks",
                task_arn,
            )
        except subprocess.CalledProcessError:
            # A timed-out migration must not continue unnoticed while someone retries deployment.
            aws(
                "ecs",
                "stop-task",
                "--cluster",
                cluster,
                "--task",
                task_arn,
                "--reason",
                "GitHub Actions migration wait failed",
            )
            raise
        check_migration(
            aws("ecs", "describe-tasks", "--cluster", cluster, "--tasks", task_arn)
        )
        service_arn = register(service, directory, "service.json")
        aws(
            "ecs",
            "update-service",
            "--cluster",
            cluster,
            "--service",
            service_name,
            "--task-definition",
            service_arn,
            "--desired-count",
            "1",
        )
        print(f"Waiting for service revision: {service_arn}", flush=True)
        aws(
            "ecs",
            "wait",
            "services-stable",
            "--cluster",
            cluster,
            "--services",
            service_name,
        )
        check_service(
            aws(
                "ecs",
                "describe-services",
                "--cluster",
                cluster,
                "--services",
                service_name,
            ),
            service_arn,
        )
        # Publish only after the exact revision passes verification. These
        # non-secret parameters live outside CloudFormation's resource ownership.
        prefix = f"/lumi/{stack_name}"
        aws("ssm", "put-parameter", "--name", prefix + "/task-definition",
            "--type", "String", "--value", service_arn, "--overwrite")
        aws("ssm", "put-parameter", "--name", prefix + "/desired-count",
            "--type", "String", "--value", "1", "--overwrite")
        print("Deployment succeeded.")
        if os.environ.get("GITHUB_STEP_SUMMARY"):
            with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
                summary.write(
                    f"Deployed `{service_arn}` after a successful migration.\n"
                )


if __name__ == "__main__":
    main()
