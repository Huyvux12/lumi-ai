import unittest
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[2]


def read_yaml(path):
    # YAML 1.1 SafeLoader treats the GitHub key 'on' as a boolean.
    return yaml.load((ROOT / path).read_text(), Loader=yaml.BaseLoader)


class WorkflowTests(unittest.TestCase):
    def test_deployments_have_separate_branches_and_require_checks(self):
        for path, branch in [("deploy.yml", "main"), ("deploy-aws.yml", "dev")]:
            config = read_yaml(".github/workflows/" + path)
            self.assertEqual(config["on"]["push"]["branches"], [branch])
            self.assertEqual(config["jobs"]["checks"]["uses"], "./.github/workflows/checks.yml")
            self.assertEqual(config["jobs"]["deploy"]["needs"], "checks")
            self.assertEqual(config["jobs"]["deploy"]["if"], f"github.ref == 'refs/heads/{branch}'")
            self.assertEqual(config["concurrency"]["cancel-in-progress"], "false")
        aws = read_yaml(".github/workflows/deploy-aws.yml")["jobs"]["deploy"]
        self.assertEqual(aws["permissions"]["id-token"], "write")
        deploy = aws["steps"][-1]
        self.assertIn("@${{ steps.frontend.outputs.digest }}", deploy["env"]["FRONTEND_IMAGE"])
        self.assertIn("@${{ steps.backend.outputs.digest }}", deploy["env"]["BACKEND_IMAGE"])

    def test_compose_uses_trusted_loopback_and_opt_in_reconciliation(self):
        services = read_yaml("compose.yaml")["services"]
        self.assertEqual(services["frontend"]["network_mode"], "service:backend")
        self.assertEqual(services["frontend"]["build"]["args"]["PYTHON_API_URL"], "http://127.0.0.1:8000")
        self.assertNotIn("ports", services["frontend"])
        self.assertTrue(all(port.startswith("127.0.0.1:") for port in services["backend"]["ports"]))
        self.assertEqual(services["frontend"]["depends_on"]["backend"]["condition"], "service_healthy")
        self.assertIn("healthcheck", services["backend"])
        self.assertEqual(services["worker"]["profiles"], ["reconciliation"])
        self.assertEqual(services["worker"]["command"], ["python", "-m", "app.worker"])


if __name__ == "__main__":
    unittest.main()
