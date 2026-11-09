import subprocess
import sys
import unittest

from tests.helpers import (
    ROOT,
    TEST_API_SECRET,
    TEST_JWT_SECRET,
    NO_CONFIG_FILE,
    make_client,
)
from app import create_app
from settings import SERVICE_NAME, SERVICE_VERSION, load_settings


class HealthEndpointTests(unittest.TestCase):
    def test_health_works_without_authentication(self):
        res = make_client().get("/health")
        self.assertEqual(res.status_code, 200)
        body = res.get_json()
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["service"], SERVICE_NAME)
        self.assertEqual(body["version"], SERVICE_VERSION)
        self.assertIn("timestamp", body)
        self.assertTrue(body["configured"])

    def test_health_does_not_leak_secrets_or_config(self):
        text = make_client().get("/health").get_data(as_text=True)
        for secret in (TEST_JWT_SECRET, TEST_API_SECRET, "123456789012345", "demo-cloud"):
            self.assertNotIn(secret, text)

    def test_health_still_works_when_unconfigured_and_says_so(self):
        settings = load_settings(environ={}, config_file=NO_CONFIG_FILE)
        client = create_app(settings).test_client()
        res = client.get("/health")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.get_json()["configured"])

    def test_unknown_route_and_wrong_method_return_json(self):
        client = make_client()
        res = client.get("/nope")
        self.assertEqual(res.status_code, 404)
        self.assertFalse(res.get_json()["success"])
        res = client.post("/health")
        self.assertEqual(res.status_code, 405)
        self.assertFalse(res.get_json()["success"])


class ImportTests(unittest.TestCase):
    def test_importing_app_does_not_start_a_server_or_crash_without_config(self):
        # If app.run() executed on import this would block until the timeout.
        proc = subprocess.run(
            [sys.executable, "-c", "import app; print('IMPORT_OK', app.app is not None)"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=30,
            env={"PATH": "/usr/bin:/bin", "PYTHONDONTWRITEBYTECODE": "1"},
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("IMPORT_OK True", proc.stdout)


if __name__ == "__main__":
    unittest.main()
