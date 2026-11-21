// Run with: node --test
import test from "node:test";
import assert from "node:assert/strict";
import { isTokenStale } from "../src/utils/tokenFreshness.js";
import {
    MAX_MAIL_HTML_BYTES,
    buildPasswordResetEmail
} from "../src/services/mail.service.js";
import { hashOtp, isOtpMatch } from "../src/utils/otp.js";

process.env.OTP_SECRET = "test-secret-for-otp";

test("token issued before the password change is stale", () => {
    const changed = new Date("2026-11-21T10:00:30Z");
    const before = Math.floor(new Date("2026-11-21T09:59:00Z").getTime() / 1000);
    assert.equal(isTokenStale({ iat: before }, changed), true);
});

test("token issued in the same second or later stays valid", () => {
    const changed = new Date("2026-11-21T10:00:30.700Z");
    const sameSecond = Math.floor(changed.getTime() / 1000);
    assert.equal(isTokenStale({ iat: sameSecond }, changed), false);
    assert.equal(isTokenStale({ iat: sameSecond + 5 }, changed), false);
});

test("users who never changed their password are unaffected", () => {
    assert.equal(isTokenStale({ iat: 1 }, null), false);
    assert.equal(isTokenStale({ iat: 1 }, undefined), false);
    assert.equal(isTokenStale({}, new Date()), false);
});

test("reset email carries the code, escapes the name and fits the relay limit", () => {
    const { subject, html } = buildPasswordResetEmail({
        fullName: '<img src=x onerror=alert(1)> Dutta',
        otp: "123456",
        minutes: 10
    });
    assert.match(subject, /123456/);
    assert.ok(html.includes("123456"));
    assert.ok(!html.includes("<img"));
    assert.ok(Buffer.byteLength(html, "utf8") < MAX_MAIL_HTML_BYTES);
});

test("a signup OTP hash never matches the reset namespace", () => {
    const email = "a@b.com";
    const signupHash = hashOtp(email, "123456");
    assert.equal(isOtpMatch(`reset:${email}`, "123456", signupHash), false);
    assert.equal(isOtpMatch(`reset:${email}`, "123456", hashOtp(`reset:${email}`, "123456")), true);
});
