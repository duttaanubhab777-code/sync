import test from "node:test";
import assert from "node:assert/strict";
import { makeAckToken, isValidAckToken, ackUrl } from "../src/utils/deliveryAck.js";

process.env.JWT_SECRET = "test-secret-for-ack";

test("ack token is valid only for the same user and message", () => {
    const u = "64b000000000000000000001";
    const m = "64b0000000000000000000aa";
    const token = makeAckToken(u, m);
    assert.equal(token.length, 32);
    assert.equal(isValidAckToken(u, m, token), true);
    assert.equal(isValidAckToken("64b000000000000000000002", m, token), false);
    assert.equal(isValidAckToken(u, "64b0000000000000000000bb", token), false);
    assert.equal(isValidAckToken(u, m, "x".repeat(32)), false);
    assert.equal(isValidAckToken(u, m, undefined), false);
});

test("ackUrl needs an https base URL", () => {
    delete process.env.PUBLIC_BASE_URL;
    delete process.env.RENDER_EXTERNAL_URL;
    assert.equal(ackUrl(), "");
    process.env.RENDER_EXTERNAL_URL = "https://sync-5lfm.onrender.com/";
    assert.equal(ackUrl(), "https://sync-5lfm.onrender.com/api/v1/messages/delivery-ack");
    process.env.RENDER_EXTERNAL_URL = "http://insecure.example";
    assert.equal(ackUrl(), "");
});
