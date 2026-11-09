import tempfile
import unittest
from pathlib import Path

from settings import Settings, load_settings
from tests.helpers import NO_CONFIG_FILE, TEST_API_SECRET, TEST_JWT_SECRET, good_environ


class SettingsTests(unittest.TestCase):
    def test_complete_environment_is_configured(self):
        s = load_settings(environ=good_environ(), config_file=NO_CONFIG_FILE)
        self.assertTrue(s.is_configured)
        self.assertEqual(s.problems, ())

    def test_empty_environment_lists_every_missing_value(self):
        s = load_settings(environ={}, config_file=NO_CONFIG_FILE)
        self.assertFalse(s.is_configured)
        self.assertEqual(len(s.problems), 4)

    def test_repr_hides_secrets(self):
        s = load_settings(environ=good_environ(), config_file=NO_CONFIG_FILE)
        text = repr(s)
        self.assertNotIn(TEST_JWT_SECRET, text)
        self.assertNotIn(TEST_API_SECRET, text)

    def test_problem_messages_never_contain_values(self):
        s = load_settings(environ=good_environ(CLOUDINARY_API_KEY="bad-key-value"), config_file=NO_CONFIG_FILE)
        self.assertFalse(s.is_configured)
        self.assertNotIn("bad-key-value", " ".join(s.problems + s.warnings))

    def test_config_py_is_read_and_environment_overrides_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.py"
            path.write_text(
                'JWT_SECRET = "file-secret-0123456789-0123456789-abcdef"\n'
                'CLOUDINARY_CLOUD_NAME = "filecloud"\n'
                'CLOUDINARY_API_KEY = "111111111111"\n'
                'CLOUDINARY_API_SECRET = "filesecret"\n'
                'ALLOWED_ORIGINS = ["https://sync-5lfm.onrender.com"]\n'
            )
            s = load_settings(environ={}, config_file=path)
            self.assertTrue(s.is_configured)
            self.assertEqual(s.cloud_name, "filecloud")
            s2 = load_settings(environ={"CLOUDINARY_CLOUD_NAME": "envcloud"}, config_file=path)
            self.assertEqual(s2.cloud_name, "envcloud")

    def test_broken_config_py_does_not_crash_and_leaks_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.py"
            path.write_text('JWT_SECRET = "oops-secret-value\n')  # syntax error
            with self.assertLogs("sync.media.settings", level="ERROR") as logs:
                s = load_settings(environ={}, config_file=path)
            self.assertFalse(s.is_configured)
            self.assertNotIn("oops-secret-value", "\n".join(logs.output))

    def test_placeholders_count_as_missing(self):
        s = load_settings(environ=good_environ(JWT_SECRET="PASTE_YOUR_SECRET_HERE"), config_file=NO_CONFIG_FILE)
        self.assertFalse(s.is_configured)

    def test_whitespace_is_trimmed(self):
        s = load_settings(environ=good_environ(CLOUDINARY_CLOUD_NAME="  demo-cloud\n"), config_file=NO_CONFIG_FILE)
        self.assertEqual(s.cloud_name, "demo-cloud")

    def test_numeric_options_are_bounded(self):
        s = load_settings(environ=good_environ(RATE_LIMIT_PER_MINUTE="99999", JWT_LEEWAY_SECONDS="abc"),
                          config_file=NO_CONFIG_FILE)
        self.assertEqual(s.rate_limit_per_minute, 30)
        self.assertEqual(s.jwt_leeway_seconds, 10)
        self.assertTrue(s.warnings)

    def test_short_secret_warns_but_works(self):
        s = load_settings(environ=good_environ(JWT_SECRET="short-secret"), config_file=NO_CONFIG_FILE)
        self.assertTrue(s.is_configured)
        self.assertTrue(any("JWT_SECRET" in w for w in s.warnings))


if __name__ == "__main__":
    unittest.main()
