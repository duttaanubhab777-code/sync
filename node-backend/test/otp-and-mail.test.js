// Run with: node --test
import test from "node:test";
import assert from "node:assert/strict";
import {
    OTP_LENGTH,
    generateOtp,
    hashOtp,
    isOtpMatch,
    otpCooldownMs,
    otpExpiryMs,
    otpMaxAttempts,
    otpMaxSends
} from "../src/utils/otp.js";
import {
    MAX_MAIL_HTML_BYTES,
    MailRelayError,
    buildOtpEmail,
    isMailRelayConfigured,
    sendOtpEmail
} from "../src/services/mail.service.js";

test("generateOtp creates a 6-digit numeric string", () => {
    for (let i = 0; i < 50; i++) {
        const code = generateOtp();
        assert.equal(code.length, OTP_LENGTH);
        assert.match(code, /^\d{6}$/);
    }
});

test("hashOtp and isOtpMatch verify OTPs safely and bind to email", () => {
    process.env.JWT_SECRET = "test-jwt-secret-0123456789abcdef0123456789";
    const hash = hashOtp("User@Example.com", "042198");
    assert.equal(isOtpMatch("user@example.com", "042198", hash), true);
    assert.equal(isOtpMatch("user@example.com", "042199", hash), false);
    assert.equal(isOtpMatch("other@example.com", "042198", hash), false);
    assert.equal(isOtpMatch("user@example.com", "042198", ""), false);
});

test("OTP limits respect defaults and bounds", () => {
    delete process.env.OTP_EXPIRES_MINUTES;
    delete process.env.OTP_RESEND_COOLDOWN_SECONDS;
    delete process.env.OTP_MAX_SENDS;
    delete process.env.OTP_MAX_ATTEMPTS;

    assert.equal(otpExpiryMs(), 10 * 60_000);
    assert.equal(otpCooldownMs(), 60 * 1000);
    assert.equal(otpMaxSends(), 5);
    assert.equal(otpMaxAttempts(), 5);

    process.env.OTP_EXPIRES_MINUTES = "999";
    assert.equal(otpExpiryMs(), 30 * 60_000);
    delete process.env.OTP_EXPIRES_MINUTES;
});

test("buildOtpEmail escapes HTML and stays well under MAX_MAIL_HTML_BYTES", () => {
    const { subject, html } = buildOtpEmail({
        fullName: '<script>alert("xss")</script> Anubhab',
        otp: "123456",
        minutes: 10
    });
    assert.match(subject, /123456/);
    assert.equal(html.includes("<script>"), false);
    assert.equal(html.includes("&lt;script&gt;"), true);
    assert.equal(html.includes("123456"), true);
    assert.equal(Buffer.byteLength(html, "utf8") < MAX_MAIL_HTML_BYTES, true);
});

test("sendOtpEmail uses console fallback in dev when relay is not configured, and rejects in prod", async () => {
    delete process.env.PYTHON_SERVICE_URL;
    delete process.env.MAIL_RELAY_SECRET;
    delete process.env.RENDER;
    process.env.NODE_ENV = "development";

    assert.equal(isMailRelayConfigured(), false);
    const devResult = await sendOtpEmail({
        to: "user@example.com",
        fullName: "Test User",
        otp: "654321",
        minutes: 10
    });
    assert.deepEqual(devResult, { dev: true });

    process.env.NODE_ENV = "production";
    await assert.rejects(
        () =>
            sendOtpEmail({
                to: "user@example.com",
                fullName: "Test User",
                otp: "654321",
                minutes: 10
            }),
        err => err instanceof MailRelayError && err.code === "not_configured"
    );
});
