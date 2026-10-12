import importlib.util
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "init_release", Path(__file__).parents[1] / "init_release_state.py"
)
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseStateTests(unittest.TestCase):
    def test_new_stack_bootstraps_at_zero_without_overwriting_parameters(self):
        calls = []

        def aws(*args):
            calls.append(args)
            if args[0] == "cloudformation":
                raise subprocess.CalledProcessError(
                    1, "aws", stderr="Stack does not exist"
                )
            return {}

        with patch.object(release, "aws", side_effect=aws):
            release.initialize("lumi-dev")
        self.assertIn("bootstrap", calls[1])
        self.assertIn("0", calls[2])
        self.assertTrue(all("--overwrite" not in call for call in calls))

    def test_existing_service_is_adopted_before_stack_update(self):
        calls = []

        def aws(*args):
            calls.append(args)
            if args[0] == "cloudformation":
                return {
                    "Stacks": [
                        {
                            "Outputs": [
                                {"OutputKey": "ClusterName", "OutputValue": "cluster"},
                                {"OutputKey": "ServiceName", "OutputValue": "service"},
                            ]
                        }
                    ]
                }
            if args[0] == "ecs":
                return {
                    "services": [
                        {
                            "desiredCount": 1,
                            "runningCount": 1,
                            "pendingCount": 0,
                            "taskDefinition": "verified-revision",
                            "deployments": [{"rolloutState": "COMPLETED"}],
                        }
                    ]
                }
            return {}

        with patch.object(release, "aws", side_effect=aws):
            release.initialize("lumi-dev")
        self.assertIn("verified-revision", calls[-2])
        self.assertIn("1", calls[-1])

    def test_template_update_uses_last_release_instead_of_new_bootstrap_definition(
        self,
    ):
        import yaml

        class Loader(yaml.SafeLoader):
            pass

        Loader.add_multi_constructor(
            "!",
            lambda loader, tag, node: {
                tag: loader.construct_sequence(node)
                if isinstance(node, yaml.SequenceNode)
                else loader.construct_scalar(node)
            },
        )
        template = yaml.load(
            (Path(__file__).parents[2] / "deploy/aws/stack.yaml").read_text(),
            Loader=Loader,
        )
        properties = template["Resources"]["Service"]["Properties"]
        self.assertEqual(properties["DesiredCount"], {"Ref": "DesiredCountParameter"})
        self.assertEqual(
            properties["TaskDefinition"]["If"],
            [
                "HasReleasedService",
                {"Ref": "TaskDefinitionParameter"},
                {"Ref": "TaskDefinition"},
            ],
        )
        self.assertEqual(
            template["Parameters"]["TaskDefinitionParameter"]["Type"],
            "AWS::SSM::Parameter::Value<String>",
        )
        self.assertFalse(
            any(
                r["Type"] == "AWS::SSM::Parameter"
                for r in template["Resources"].values()
            )
        )
