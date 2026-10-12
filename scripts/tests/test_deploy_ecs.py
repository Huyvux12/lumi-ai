"""Deployment safety tests without network access or AWS credentials."""

import importlib.util
import os
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "deploy_ecs", Path(__file__).parents[1] / "deploy_ecs.py"
)
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)

BASE = {
    "family": "lumi-dev",
    "networkMode": "awsvpc",
    "taskDefinitionArn": "base",
    "revision": 1,
    "status": "ACTIVE",
    "requiresAttributes": [],
    "containerDefinitions": [
        {
            "name": "backend",
            "image": "old-backend",
            "healthCheck": {},
            "secrets": [{"name": "DATABASE_URL", "valueFrom": "secret:arn"}],
        },
        {
            "name": "frontend",
            "image": "old-frontend",
            "dependsOn": [{"containerName": "backend", "condition": "HEALTHY"}],
        },
    ],
}
ENV = {
    "AWS_STACK_NAME": "lumi-dev",
    "ECS_CLUSTER": "cluster",
    "ECS_SERVICE": "service",
    "ECS_TASK_DEFINITION": "base",
    "ECS_SUBNETS": "subnet-a,subnet-b",
    "ECS_SECURITY_GROUP": "sg-task",
    "FRONTEND_IMAGE": "frontend@sha256:abc",
    "BACKEND_IMAGE": "backend@sha256:def",
}


class DeploymentTests(unittest.TestCase):
    def run_deploy(
        self, *, exit_code=0, launch_failure=False, waiter_failure=False, rollback=False
    ):
        calls = []

        def fake_aws(*args):
            calls.append(args)
            operation = args[1]
            if operation == "describe-stacks":
                return {"Stacks": [{"Parameters": [
                    {"ParameterKey": "DesiredCountParameter", "ParameterValue": "/lumi/lumi-dev/desired-count"},
                    {"ParameterKey": "TaskDefinitionParameter", "ParameterValue": "/lumi/lumi-dev/task-definition"},
                ]}]}
            if operation == "describe-task-definition":
                return {"taskDefinition": BASE}
            if operation == "register-task-definition":
                return {
                    "taskDefinition": {
                        "taskDefinitionArn": "new-service"
                        if len([c for c in calls if c[1] == operation]) == 2
                        else "migration"
                    }
                }
            if operation == "run-task":
                return (
                    {"failures": [{"reason": "placement"}]}
                    if launch_failure
                    else {"tasks": [{"taskArn": "migration-task"}]}
                )
            if operation == "wait" and args[2] == "tasks-stopped" and waiter_failure:
                raise subprocess.CalledProcessError(255, "aws")
            if operation == "describe-tasks":
                return {
                    "tasks": [
                        {
                            "taskArn": "migration-task",
                            "lastStatus": "STOPPED",
                            "containers": [{"exitCode": exit_code}],
                        }
                    ]
                }
            if operation == "describe-services":
                return {
                    "services": [
                        {
                            "taskDefinition": "old-service"
                            if rollback
                            else "new-service",
                            "runningCount": 1,
                            "pendingCount": 0,
                            "deployments": [{"rolloutState": "COMPLETED"}],
                        }
                    ]
                }
            return {}

        with (
            patch.dict(os.environ, ENV, clear=True),
            patch.object(deploy, "aws", side_effect=fake_aws),
        ):
            try:
                deploy.main()
            except (RuntimeError, subprocess.CalledProcessError) as error:
                return calls, error
        return calls, None

    def test_missing_or_mismatched_release_parameters_fail_before_migration(self):
        for parameters in ([], [{"ParameterKey": "DesiredCountParameter", "ParameterValue": "/wrong/path"}]):
            with self.subTest(parameters=parameters):
                with self.assertRaises(ValueError):
                    deploy.validate_release_parameters({"Parameters": parameters}, "lumi-dev")

    def test_backend_only_migration_preserves_secret_references(self):
        service, migration = deploy.definitions(
            BASE, ENV["FRONTEND_IMAGE"], ENV["BACKEND_IMAGE"]
        )
        self.assertNotIn("revision", service)
        self.assertNotIn("taskDefinitionArn", service)
        self.assertEqual(len(migration["containerDefinitions"]), 1)
        backend = migration["containerDefinitions"][0]
        self.assertNotIn("healthCheck", backend)
        self.assertEqual(backend["image"], ENV["BACKEND_IMAGE"])
        self.assertEqual(backend["secrets"], BASE["containerDefinitions"][0]["secrets"])
        self.assertEqual(
            service["containerDefinitions"][1]["image"], ENV["FRONTEND_IMAGE"]
        )
        self.assertEqual(BASE["containerDefinitions"][0]["image"], "old-backend")

    def test_success_migrates_before_service_update(self):
        calls, error = self.run_deploy()
        self.assertIsNone(error)
        operations = [call[1] for call in calls]
        self.assertLess(
            operations.index("describe-tasks"), operations.index("update-service")
        )
        self.assertEqual(operations[-3:], ["describe-services", "put-parameter", "put-parameter"])
        published = [call for call in calls if call[0] == "ssm"]
        self.assertIn("/lumi/lumi-dev/task-definition", published[0])
        self.assertIn("new-service", published[0])
        self.assertIn("/lumi/lumi-dev/desired-count", published[1])

    def test_failed_migration_never_updates_service(self):
        for options in (
            {"exit_code": 1},
            {"exit_code": None},
            {"launch_failure": True},
        ):
            with self.subTest(options=options):
                calls, error = self.run_deploy(**options)
                self.assertIsNotNone(error)
                self.assertFalse(any(call[1] == "update-service" for call in calls))

    def test_timeout_stops_migration_and_never_updates_service(self):
        calls, error = self.run_deploy(waiter_failure=True)
        self.assertIsNotNone(error)
        self.assertTrue(any(call[1] == "stop-task" for call in calls))
        self.assertFalse(any(call[1] == "update-service" for call in calls))

    def test_stable_rollback_is_reported_as_failure(self):
        calls, error = self.run_deploy(rollback=True)
        self.assertIsInstance(error, RuntimeError)
        self.assertIn("requested revision", str(error))
        self.assertFalse(any(call[0] == "ssm" for call in calls))


if __name__ == "__main__":
    unittest.main()
