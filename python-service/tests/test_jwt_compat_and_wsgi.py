"""Cross-implementation JWT check (token built by Node's crypto module) and WSGI-file check."""
import base64
import hashlib
import hmac
import json
import shutil
import subprocess
import time
import unittest
from pathlib import Path

from werkzeug.test import Client

from tests.helpers import ROOT, TEST_JWT_SECRET, USER_ID, auth, make_client, make_settings
from utils.jwt_utils import AccessTokenError, extract_bearer_token, verify_access_token

NODE = shutil.which("node")


class NodeTokenCompatibilityTests(unittest.TestCase):
    @unittest.skipUnless(NODE, "node is not installed")
    def test_token_hand_built_by_node_crypto_verifies(self):
        # Same header/payload shape as node-backend/src/models/user.model.js generateAccessToken(),
        # signed with HMAC-SHA256 by Node's own crypto module (independent of PyJWT).
        script = r"""
        const crypto = require('node:crypto');
        const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
        const now = Math.floor(Date.now()/1000);
        const head = b64({alg:'HS256',typ:'JWT'});
        const body = b64({id:process.argv[2],_id:process.argv[2],email:'a@example.com',
                          username:'alice',fullName:'Alice',iat:now,exp:now+900});
        const sig = crypto.createHmac('sha256', process.argv[1]).update(head+'.'+body).digest('base64url');
        process.stdout.write(head+'.'+body+'.'+sig);
        """
        token = subprocess.run(
            [NODE, "-e", script, TEST_JWT_SECRET, USER_ID], capture_output=True, text=True, timeout=30, check=True
        ).stdout.strip()
        verified = verify_access_token(token, TEST_JWT_SECRET)
        self.assertEqual(verified.user_id, USER_ID)
        res = make_client().post("/media/sign", headers=auth(token), json={})
        self.assertEqual(res.status_code, 200)

    @unittest.skipUnless(NODE, "node is not installed")
    def test_node_built_refresh_style_token_is_rejected(self):
        script = r"""
        const crypto = require('node:crypto');
        const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
        const now = Math.floor(Date.now()/1000);
        const head = b64({alg:'HS256',typ:'JWT'});
        const body = b64({id:process.argv[2],_id:process.argv[2],tokenType:'refresh',iat:now,exp:now+999999,jti:'x'});
        const sig = crypto.createHmac('sha256', process.argv[1]).update(head+'.'+body).digest('base64url');
        process.stdout.write(head+'.'+body+'.'+sig);
        """
        token = subprocess.run(
            [NODE, "-e", script, TEST_JWT_SECRET, USER_ID], capture_output=True, text=True, timeout=30, check=True
        ).stdout.strip()
        with self.assertRaises(AccessTokenError) as ctx:
            verify_access_token(token, TEST_JWT_SECRET)
        self.assertEqual(ctx.exception.reason, "wrong_token_type")


class BearerParsingTests(unittest.TestCase):
    def test_parsing(self):
        with self.assertRaises(AccessTokenError):
            extract_bearer_token(None)
        with self.assertRaises(AccessTokenError):
            extract_bearer_token("Bearer")
        with self.assertRaises(AccessTokenError):
            extract_bearer_token("Bearer a b c")
        with self.assertRaises(AccessTokenError):
            extract_bearer_token("Bearer " + "x." * 3000)
        self.assertEqual(extract_bearer_token("bearer aaa.bbb.ccc"), "aaa.bbb.ccc")


class WsgiFileTests(unittest.TestCase):
    def test_pythonanywhere_wsgi_file_exposes_working_application(self):
        source = (ROOT / "pythonanywhere_wsgi.py").read_text()
        self.assertIn("application", source)
        # Replace the placeholder path the owner would edit with the real folder.
        patched = source.replace(
            '"/home/<YOUR_PYTHONANYWHERE_USERNAME>/sync-media-service"', repr(str(ROOT))
        )
        self.assertNotEqual(source, patched, "placeholder line changed unexpectedly")
        namespace: dict = {}
        exec(compile(patched, "pythonanywhere_wsgi.py", "exec"), namespace)
        application = namespace["application"]
        res = Client(application).get("/health")
        self.assertEqual(res.status_code, 200)

    def test_app_py_has_no_unguarded_app_run(self):
        lines = (ROOT / "app.py").read_text().splitlines()
        for index, line in enumerate(lines):
            if "app.run(" in line and not line.lstrip().startswith("#"):
                self.assertTrue(line.startswith("    "), "app.run must be indented under __main__ guard")
                self.assertIn('if __name__ == "__main__":', "\n".join(lines[max(0, index - 3):index]))


if __name__ == "__main__":
    unittest.main()
