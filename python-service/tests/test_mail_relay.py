"""Unit tests for the /mail/send and /mail/diag relay routes and mail_service."""
from __future__ import annotations

import smtplib
import unittest
from unittest import mock

from services import mail_service
from tests.helpers import make_client, make_settings

TEST_RELAY_KEY = "relay-secret-key-0123456789abcdef"
TEST_GMAIL = "sync93346@gmail.com"
TEST_APP_PASS = "abcd efgh ijkl mnop"


def mail_client(**overrides):
    env = {
        "GMAIL_USER": TEST_GMAIL,
        "GMAIL_APP_PASSWORD": TEST_APP_PASS,
        "MAIL_RELAY_SECRET": TEST_RELAY_KEY,
    }
    env.update(overrides)
    return make_client(**env)


class MailRelayTests(unittest.TestCase):
    def test_health_reports_mail_configured(self):
        self.assertFalse(make_client().get("/health").get_json()["mailConfigured"])
        self.assertTrue(mail_client().get("/health").get_json()["mailConfigured"])

    def test_send_requires_configured_relay(self):
        res = make_client().post(
            "/mail/send",
            headers={"X-Relay-Key": TEST_RELAY_KEY},
            json={"to": "u@example.com", "subject": "Code", "html": "<p>123456</p>"},
        )
        self.assertEqual(res.status_code, 503)

    def test_send_rejects_wrong_key_and_browser_origin(self):
        client = mail_client()
        res = client.post(
            "/mail/send",
            headers={"X-Relay-Key": "wrong-key"},
            json={"to": "u@example.com", "subject": "Code", "html": "<p>123456</p>"},
        )
        self.assertEqual(res.status_code, 403)

        res_origin = client.post(
            "/mail/send",
            headers={"X-Relay-Key": TEST_RELAY_KEY, "Origin": "https://sync-5lfm.onrender.com"},
            json={"to": "u@example.com", "subject": "Code", "html": "<p>123456</p>"},
        )
        self.assertEqual(res_origin.status_code, 403)

    def test_send_happy_path_calls_smtp(self):
        client = mail_client()
        with mock.patch("services.mail_service.send_mail", return_value=465) as mocked:
            res = client.post(
                "/mail/send",
                headers={"X-Relay-Key": TEST_RELAY_KEY},
                json={"to": "u@example.com", "subject": "123456 is your code", "html": "<p>123456</p>"},
            )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.get_json()["data"]["port"], 465)
        mocked.assert_called_once()

    def test_send_auth_error_returns_502_with_hint(self):
        client = mail_client()
        with mock.patch(
            "services.mail_service.send_mail",
            side_effect=smtplib.SMTPAuthenticationError(535, b"Bad credentials"),
        ):
            res = client.post(
                "/mail/send",
                headers={"X-Relay-Key": TEST_RELAY_KEY},
                json={"to": "u@example.com", "subject": "Code", "html": "<p>123456</p>"},
            )
        self.assertEqual(res.status_code, 502)
        self.assertIn("gmail_auth_failed", res.get_json()["message"])

    def test_recipient_rate_limit(self):
        client = mail_client(MAIL_PER_RECIPIENT_LIMIT="2")
        with mock.patch("services.mail_service.send_mail", return_value=465):
            codes = [
                client.post(
                    "/mail/send",
                    headers={"X-Relay-Key": TEST_RELAY_KEY},
                    json={"to": "same@example.com", "subject": "Code", "html": "<p>1</p>"},
                ).status_code
                for _ in range(3)
            ]
        self.assertEqual(codes, [200, 200, 429])

    def test_diag_allows_query_key_and_checks_ports(self):
        client = mail_client()
        with mock.patch(
            "services.mail_service.check_ports",
            return_value=[{"port": 465, "mode": "ssl", "result": "OK"}],
        ):
            res = client.get(f"/mail/diag?key={TEST_RELAY_KEY}")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()["data"]
        self.assertTrue(data["ok"])
        self.assertEqual(data["gmailUser"], TEST_GMAIL)

    def test_build_message_creates_text_and_html_parts(self):
        s = make_settings(
            GMAIL_USER=TEST_GMAIL,
            GMAIL_APP_PASSWORD=TEST_APP_PASS,
            MAIL_RELAY_SECRET=TEST_RELAY_KEY,
        )
        msg = mail_service.build_message(
            s, "user@example.com", "Your code", "<p>Hello <b>123456</b></p>"
        )
        self.assertEqual(msg["To"], "user@example.com")
        self.assertIn("123456", msg.get_body(preferencelist=("plain",)).get_content())


if __name__ == "__main__":
    unittest.main()
