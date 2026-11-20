// Run with: node --test
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
    normalizePrivateKey,
    resolveFcmCredentials,
    isFcmConfigured,
    createServiceAccountJwt,
    buildFcmDataMap
} from "../src/services/push.service.js";

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" }
});

test("normalizePrivateKey handles escaped newlines and surrounding quotes", () => {
    const escaped = `"${privateKey.replace(/\n/g, "\\n")}"`;
    const normalized = normalizePrivateKey(escaped);
    assert.equal(normalized, privateKey.trim());
});

test("resolveFcmCredentials supports both FIREBASE_SERVICE_ACCOUNT_JSON and individual env vars", () => {
    const jsonEnv = {
        FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
            project_id: "sync-34886",
            client_email: "firebase-adminsdk@sync-34886.iam.gserviceaccount.com",
            private_key: privateKey
        })
    };
    const c1 = resolveFcmCredentials(jsonEnv);
    assert.equal(c1.projectId, "sync-34886");
    assert.equal(
        c1.clientEmail,
        "firebase-adminsdk@sync-34886.iam.gserviceaccount.com"
    );
    assert.equal(c1.privateKey, privateKey.trim());

    const splitEnv = {
        FIREBASE_PROJECT_ID: "sync-34886",
        FIREBASE_CLIENT_EMAIL:
            "firebase-adminsdk@sync-34886.iam.gserviceaccount.com",
        FIREBASE_PRIVATE_KEY: privateKey.replace(/\n/g, "\\n")
    };
    const c2 = resolveFcmCredentials(splitEnv);
    assert.equal(c2.projectId, "sync-34886");
    assert.equal(isFcmConfigured(splitEnv), true);
    assert.equal(isFcmConfigured({}), false);
});

test("createServiceAccountJwt produces a valid RS256 signed JWT verifiable with public key", () => {
    const jwt = createServiceAccountJwt({
        clientEmail: "firebase-adminsdk@sync-34886.iam.gserviceaccount.com",
        privateKey,
        nowSec: 1700000000
    });
    const parts = jwt.split(".");
    assert.equal(parts.length, 3);

    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(`${parts[0]}.${parts[1]}`);
    verifier.end();
    const sigBuf = Buffer.from(
        parts[2].replace(/-/g, "+").replace(/_/g, "/"),
        "base64"
    );
    assert.equal(verifier.verify(publicKey, sigBuf), true);
});

test("buildFcmDataMap converts all fields to strings for FCM HTTP v1", () => {
    const map = buildFcmDataMap({
        type: "group_message",
        title: "JEE Study Group",
        body: "Anubhab: হ্যালো সবাই",
        messageText: "হ্যালো সবাই",
        senderName: "Anubhab",
        senderAvatar: "https://res.cloudinary.com/demo/image/upload/a.png",
        tag: "conversation-123",
        data: {
            conversationId: "123",
            messageId: "456",
            url: "/chats/123"
        }
    });

    assert.equal(map.type, "group_message");
    assert.equal(map.title, "JEE Study Group");
    assert.equal(map.messageText, "হ্যালো সবাই");
    assert.equal(map.senderName, "Anubhab");
    assert.equal(map.conversationId, "123");
    assert.equal(map.messageId, "456");
    assert.equal(map.url, "/chats/123");
    for (const val of Object.values(map)) {
        assert.equal(typeof val, "string");
    }
});

test("buildFcmDataMap carries unread badge counts, including zero", () => {
    const withBadge = buildFcmDataMap({
        type: "message",
        title: "Arnab",
        body: "hi",
        badgeCount: 7,
        chatUnread: 3
    });
    assert.equal(withBadge.badgeCount, "7");
    assert.equal(withBadge.chatUnread, "3");

    const zero = buildFcmDataMap({ type: "message", badgeCount: 0 });
    assert.equal(zero.badgeCount, "0");

    const missing = buildFcmDataMap({ type: "message" });
    assert.equal("badgeCount" in missing, false);
});
