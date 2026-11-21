// Run with: node --test
import test from "node:test";
import assert from "node:assert/strict";
import { getClientIp, isPrivateIp, normalizeIp } from "../src/utils/clientIp.js";

const req = (headers = {}, ip = "10.31.10.85") => ({ headers, ip });

test("private ranges are detected", () => {
    for (const ip of ["10.31.10.85", "172.16.0.1", "192.168.1.4", "127.0.0.1", "100.64.0.9", "::1", "fd00::1"]) {
        assert.equal(isPrivateIp(ip), true, ip);
    }
    for (const ip of ["49.36.12.7", "172.32.0.1", "2405:201::1"]) {
        assert.equal(isPrivateIp(ip), false, ip);
    }
});

test("normalizeIp strips ::ffff:, port and brackets", () => {
    assert.equal(normalizeIp("::ffff:49.36.12.7"), "49.36.12.7");
    assert.equal(normalizeIp("49.36.12.7:5555"), "49.36.12.7");
    assert.equal(normalizeIp("[2405:201::1]:443"), "2405:201::1");
    assert.equal(normalizeIp("garbage"), "");
});

test("cf-connecting-ip wins over a private req.ip", () => {
    assert.equal(getClientIp(req({ "cf-connecting-ip": "49.36.12.7" })), "49.36.12.7");
});

test("x-forwarded-for: first public hop is used, private hops skipped", () => {
    assert.equal(
        getClientIp(req({ "x-forwarded-for": "10.0.0.2, 49.36.12.7, 10.25.213.90" })),
        "49.36.12.7"
    );
});

test("falls back to req.ip when no proxy headers (local dev)", () => {
    assert.equal(getClientIp(req({}, "::ffff:127.0.0.1")), "127.0.0.1");
});
