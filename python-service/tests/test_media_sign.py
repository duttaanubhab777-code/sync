import json
import time
import unittest
from unittest import mock

import jwt

from app import create_app
from settings import load_settings
from tests.helpers import (
    NO_CONFIG_FILE,
    SDK_MODE,
    TEST_API_KEY,
    TEST_API_SECRET,
    TEST_CLOUD,
    TEST_JWT_SECRET,
    TEST_ORIGIN,
    USER_ID,
    auth,
    good_environ,
    make_client,
    make_settings,
    make_token,
    reference_signature,
)


def sign(client, token=None, body="{}", headers=None):
    h = {}
    if token is not None:
        h.update(auth(token))
    h.update(headers or {})
    kwargs = {"headers": h}
    if body is not None:
        kwargs["data"] = body
        kwargs["content_type"] = "application/json"
    return client.post("/media/sign", **kwargs)


class SignatureHappyPathTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        print(f"\n[test_media_sign] signing backend under test: {SDK_MODE}")

    def test_valid_token_returns_exact_fields_frontend_needs(self):
        res = sign(make_client(), make_token())
        self.assertEqual(res.status_code, 200)
        body = res.get_json()
        # frontend/src/services/media.js reads: signRes.data?.data || signRes.data
        data = body["data"]
        for key in ("cloudName", "apiKey", "timestamp", "folder", "signature"):
            self.assertIn(key, data)
        self.assertEqual(data["cloudName"], TEST_CLOUD)
        self.assertEqual(data["apiKey"], TEST_API_KEY)
        self.assertEqual(data["folder"], "sync/chat")
        self.assertIsInstance(data["timestamp"], int)
        self.assertLess(abs(data["timestamp"] - time.time()), 5)

    def test_signature_matches_independent_reference_computation(self):
        data = sign(make_client(), make_token()).get_json()["data"]
        expected = reference_signature(
            {"folder": data["folder"], "timestamp": data["timestamp"]}, TEST_API_SECRET
        )
        self.assertEqual(data["signature"], expected)

    def test_api_secret_and_jwt_secret_never_in_response(self):
        res = sign(make_client(), make_token())
        text = res.get_data(as_text=True)
        self.assertNotIn(TEST_API_SECRET, text)
        self.assertNotIn(TEST_JWT_SECRET, text)

    def test_response_is_not_cacheable(self):
        res = sign(make_client(), make_token())
        self.assertEqual(res.headers.get("Cache-Control"), "no-store")

    def test_accepts_empty_json_object_and_no_body_like_the_frontend(self):
        client = make_client()
        token = make_token()
        self.assertEqual(sign(client, token, body="{}").status_code, 200)
        self.assertEqual(sign(client, token, body=None).status_code, 200)

    def test_token_with_only_underscore_id_is_accepted(self):
        token = make_token(claims={"id": None})  # id=None -> treated as absent
        res = sign(make_client(), token)
        self.assertEqual(res.status_code, 200)

    def test_every_purpose_maps_to_its_folder(self):
        expected = {
            "chat": "sync/chat",
            "voice": "sync/voice",
            "avatar": "sync/avatars",
            "story": "sync/stories",
            "group": "sync/groups",
        }
        client = make_client(RATE_LIMIT_PER_MINUTE="100")
        for purpose, folder in expected.items():
            res = sign(client, make_token(), body=json.dumps({"purpose": purpose}))
            self.assertEqual(res.status_code, 200, purpose)
            data = res.get_json()["data"]
            self.assertEqual(data["folder"], folder)
            self.assertEqual(
                data["signature"],
                reference_signature({"folder": folder, "timestamp": data["timestamp"]}, TEST_API_SECRET),
            )

    def test_custom_folder_root(self):
        res = sign(make_client(MEDIA_FOLDER_ROOT="mychat/media"), make_token())
        self.assertEqual(res.get_json()["data"]["folder"], "mychat/media/chat")


class InputValidationTests(unittest.TestCase):
    def setUp(self):
        self.client = make_client(RATE_LIMIT_PER_MINUTE="100")
        self.token = make_token()

    def test_unknown_purpose_rejected(self):
        res = sign(self.client, self.token, body=json.dumps({"purpose": "../../etc"}))
        self.assertEqual(res.status_code, 400)

    def test_non_string_purpose_rejected(self):
        res = sign(self.client, self.token, body=json.dumps({"purpose": 5}))
        self.assertEqual(res.status_code, 400)

    def test_unknown_fields_rejected(self):
        res = sign(self.client, self.token, body=json.dumps({"folder": "evil"}))
        self.assertEqual(res.status_code, 400)

    def test_client_cannot_choose_folder(self):
        res = sign(self.client, self.token, body=json.dumps({"purpose": "chat", "folder": "other"}))
        self.assertEqual(res.status_code, 400)

    def test_body_must_be_json_object(self):
        self.assertEqual(sign(self.client, self.token, body="[1,2]").status_code, 400)
        self.assertEqual(sign(self.client, self.token, body="not json").status_code, 400)

    def test_oversized_body_rejected(self):
        res = sign(self.client, self.token, body=json.dumps({"purpose": "x" * 20000}))
        self.assertEqual(res.status_code, 413)

    def test_get_not_allowed(self):
        self.assertEqual(self.client.get("/media/sign").status_code, 405)


class AuthenticationTests(unittest.TestCase):
    def setUp(self):
        self.client = make_client()

    def assert_401(self, res):
        self.assertEqual(res.status_code, 401)
        body = res.get_json()
        self.assertFalse(body["success"])
        self.assertIn("message", body)  # frontend shows err.response.data.message

    def test_missing_token(self):
        self.assert_401(sign(self.client))

    def test_garbage_token(self):
        self.assert_401(sign(self.client, "garbage"))
        self.assert_401(sign(self.client, "a.b.c"))

    def test_wrong_scheme(self):
        res = self.client.post(
            "/media/sign", headers={"Authorization": f"Basic {make_token()}"}, json={}
        )
        self.assert_401(res)

    def test_token_signed_with_wrong_secret(self):
        self.assert_401(sign(self.client, make_token(secret="a-completely-different-secret-value-xyz")))

    def test_expired_token_returns_401_so_frontend_can_refresh(self):
        res = sign(self.client, make_token(expires_in=-120))
        self.assert_401(res)
        self.assertIn("expired", res.get_json()["message"].lower())

    def test_refresh_token_rejected_even_with_correct_secret(self):
        token = make_token(claims={"tokenType": "refresh", "jti": "abc"})
        self.assert_401(sign(self.client, token))

    def test_refresh_token_signed_with_refresh_secret_rejected(self):
        token = make_token(secret="separate-refresh-secret-value-0123456789", claims={"tokenType": "refresh"})
        self.assert_401(sign(self.client, token))

    def test_alg_none_rejected(self):
        header = jwt.utils.base64url_encode(json.dumps({"alg": "none", "typ": "JWT"}).encode()).decode()
        payload = jwt.utils.base64url_encode(
            json.dumps({"id": USER_ID, "_id": USER_ID, "exp": int(time.time()) + 900}).encode()
        ).decode()
        self.assert_401(sign(self.client, f"{header}.{payload}."))

    def test_other_hmac_algorithm_rejected(self):
        self.assert_401(sign(self.client, make_token(algorithm="HS512")))

    def test_token_without_exp_rejected(self):
        self.assert_401(sign(self.client, make_token(include_exp=False)))

    def test_invalid_user_ids_rejected(self):
        self.assert_401(sign(self.client, make_token(user_id="not-an-object-id")))
        self.assert_401(sign(self.client, make_token(claims={"_id": "64b7f0c2a1b2c3d4e5f60719"})))  # id/_id mismatch
        token = make_token()
        payload = jwt.decode(token, TEST_JWT_SECRET, algorithms=["HS256"])
        payload.pop("id"); payload.pop("_id")
        self.assert_401(sign(self.client, jwt.encode(payload, TEST_JWT_SECRET, algorithm="HS256")))

    def test_small_clock_skew_tolerated_but_not_long_expiry(self):
        self.assertEqual(sign(self.client, make_token(expires_in=-3)).status_code, 200)  # inside 10s leeway
        self.assertEqual(sign(self.client, make_token(expires_in=-30)).status_code, 401)

    def test_auth_failures_never_return_403(self):
        # The frontend only refreshes on 401; 403 would break token refresh.
        for token in (None, "garbage", make_token(expires_in=-120)):
            self.assertEqual(sign(self.client, token).status_code, 401)


class ConfigurationTests(unittest.TestCase):
    def test_missing_configuration_returns_503_not_a_signature(self):
        settings = load_settings(environ={}, config_file=NO_CONFIG_FILE)
        client = create_app(settings).test_client()
        res = sign(client, make_token())
        self.assertEqual(res.status_code, 503)
        self.assertNotIn("signature", res.get_data(as_text=True))

    def test_each_required_value_is_checked(self):
        for missing in ("JWT_SECRET", "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"):
            env = good_environ()
            env.pop(missing)
            client = create_app(load_settings(environ=env, config_file=NO_CONFIG_FILE)).test_client()
            self.assertEqual(sign(client, make_token()).status_code, 503, missing)

    def test_invalid_values_are_treated_as_misconfiguration(self):
        for key, bad in (
            ("CLOUDINARY_API_KEY", "abc"),
            ("CLOUDINARY_CLOUD_NAME", "bad name!"),
            ("CLOUDINARY_API_SECRET", "has space"),
        ):
            client = make_client(**{key: bad})
            self.assertEqual(sign(client, make_token()).status_code, 503, key)

    def test_sdk_failure_returns_503_without_details(self):
        client = make_client()
        with mock.patch(
            "services.cloudinary_service.sign_params",
            side_effect=__import__("services.cloudinary_service", fromlist=["x"]).SigningUnavailableError("boom"),
        ):
            res = sign(client, make_token())
        self.assertEqual(res.status_code, 503)
        self.assertNotIn("boom", res.get_data(as_text=True))

    def test_missing_sdk_package_returns_503(self):
        import sys
        client = make_client()
        with mock.patch.dict(sys.modules, {"cloudinary": None, "cloudinary.utils": None}):
            res = sign(client, make_token())
        self.assertEqual(res.status_code, 503)


class CorsTests(unittest.TestCase):
    def test_preflight_from_allowed_origin(self):
        res = make_client().options(
            "/media/sign",
            headers={
                "Origin": TEST_ORIGIN,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )
        self.assertEqual(res.status_code, 204)
        self.assertEqual(res.headers["Access-Control-Allow-Origin"], TEST_ORIGIN)
        self.assertIn("Authorization", res.headers["Access-Control-Allow-Headers"])
        self.assertIn("POST", res.headers["Access-Control-Allow-Methods"])
        self.assertNotEqual(res.headers["Access-Control-Allow-Origin"], "*")
        self.assertNotIn("Access-Control-Allow-Credentials", res.headers)

    def test_preflight_from_other_origin_refused(self):
        res = make_client().options(
            "/media/sign",
            headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"},
        )
        self.assertEqual(res.status_code, 403)
        self.assertNotIn("Access-Control-Allow-Origin", res.headers)

    def test_actual_request_from_allowed_origin_gets_cors_header(self):
        res = sign(make_client(), make_token(), headers={"Origin": TEST_ORIGIN})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.headers["Access-Control-Allow-Origin"], TEST_ORIGIN)
        self.assertEqual(res.headers["Vary"], "Origin")

    def test_actual_request_from_other_origin_refused(self):
        res = sign(make_client(), make_token(), headers={"Origin": "https://evil.example"})
        self.assertEqual(res.status_code, 403)
        self.assertNotIn("Access-Control-Allow-Origin", res.headers)
        self.assertNotIn("signature", res.get_data(as_text=True))

    def test_lookalike_origins_refused(self):
        client = make_client()
        for origin in (
            "https://sync-5lfm.onrender.com.evil.example",
            "http://sync-5lfm.onrender.com",
            "https://sync-5lfm.onrender.com:8443",
            "null",
        ):
            res = sign(client, make_token(), headers={"Origin": origin})
            self.assertEqual(res.status_code, 403, origin)

    def test_local_dev_origin_only_when_configured(self):
        local = "http://localhost:5173"
        self.assertEqual(sign(make_client(), make_token(), headers={"Origin": local}).status_code, 403)
        client = make_client(ALLOWED_ORIGINS=f"{TEST_ORIGIN}, {local}/")
        res = sign(client, make_token(), headers={"Origin": local})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.headers["Access-Control-Allow-Origin"], local)

    def test_wildcard_and_insecure_origins_in_config_are_ignored(self):
        settings = make_settings(ALLOWED_ORIGINS="*, http://example.com, https://*.onrender.com")
        self.assertEqual(settings.allowed_origins, ())
        client = create_app(settings).test_client()
        res = sign(client, make_token(), headers={"Origin": "https://anything.example"})
        self.assertEqual(res.status_code, 403)

    def test_default_origin_when_not_configured(self):
        env = good_environ()
        env.pop("ALLOWED_ORIGINS")
        settings = load_settings(environ=env, config_file=NO_CONFIG_FILE)
        self.assertEqual(settings.allowed_origins, (TEST_ORIGIN,))

    def test_non_browser_caller_without_origin_still_works(self):
        self.assertEqual(sign(make_client(), make_token()).status_code, 200)


class RateLimitTests(unittest.TestCase):
    def test_per_user_limit(self):
        client = make_client(RATE_LIMIT_PER_MINUTE="3")
        token = make_token()
        codes = [sign(client, token).status_code for _ in range(5)]
        self.assertEqual(codes, [200, 200, 200, 429, 429])
        res = sign(client, token)
        self.assertIn("Retry-After", res.headers)

    def test_limit_is_per_user_not_global(self):
        client = make_client(RATE_LIMIT_PER_MINUTE="1")
        self.assertEqual(sign(client, make_token(user_id="64b7f0c2a1b2c3d4e5f60718")).status_code, 200)
        self.assertEqual(sign(client, make_token(user_id="64b7f0c2a1b2c3d4e5f60799")).status_code, 200)

    def test_repeated_bad_tokens_get_blocked_then_valid_token_from_same_ip_waits(self):
        client = make_client(AUTH_FAILURE_LIMIT_PER_MINUTE="3")
        codes = [sign(client, "bad.token.value").status_code for _ in range(5)]
        self.assertEqual(codes, [401, 401, 401, 429, 429])
        self.assertEqual(sign(client, make_token()).status_code, 429)

    def test_successful_requests_do_not_count_as_failures(self):
        client = make_client(AUTH_FAILURE_LIMIT_PER_MINUTE="2", RATE_LIMIT_PER_MINUTE="50")
        token = make_token()
        for _ in range(10):
            self.assertEqual(sign(client, token).status_code, 200)


class AllowedFormatsOptionTests(unittest.TestCase):
    def test_off_by_default(self):
        data = sign(make_client(), make_token(), body=json.dumps({"purpose": "avatar"})).get_json()["data"]
        self.assertNotIn("allowedFormats", data)

    def test_when_enabled_formats_are_signed(self):
        client = make_client(ENFORCE_ALLOWED_FORMATS="true")
        data = sign(client, make_token(), body=json.dumps({"purpose": "avatar"})).get_json()["data"]
        self.assertIn("jpg", data["allowedFormats"])
        expected = reference_signature(
            {"folder": data["folder"], "timestamp": data["timestamp"], "allowed_formats": data["allowedFormats"]},
            TEST_API_SECRET,
        )
        self.assertEqual(data["signature"], expected)

    def test_chat_attachments_stay_unrestricted_when_enabled(self):
        client = make_client(ENFORCE_ALLOWED_FORMATS="true")
        data = sign(client, make_token()).get_json()["data"]
        self.assertNotIn("allowedFormats", data)


if __name__ == "__main__":
    unittest.main()
