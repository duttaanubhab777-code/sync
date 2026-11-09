// Run with:  node --test               (Node 20+, no extra packages needed)
import test from "node:test";
import assert from "node:assert/strict";

const load = async (env = {}) => {
    for (const k of ["CLOUDINARY_CLOUD_NAME", "NODE_ENV", "RENDER"]) {
        delete process.env[k];
    }
    Object.assign(process.env, env);
    return import(`../src/utils/cloudinary.js?${Math.random()}`);
};

test("accepts normal uploads from our own cloud", async () => {
    const { isValidCloudinaryUrl: ok } = await load({
        CLOUDINARY_CLOUD_NAME: "demo",
        NODE_ENV: "production"
    });
    assert.equal(ok("https://res.cloudinary.com/demo/image/upload/v1/sync/chat/a.jpg"), true);
    assert.equal(ok("https://res.cloudinary.com/demo/video/upload/v1/sync/stories/a.mp4"), true);
    assert.equal(ok("https://res.cloudinary.com/demo/raw/upload/v1/sync/chat/a.pdf"), true);
});

test("rejects other clouds, other hosts and tricks", async () => {
    const { isValidCloudinaryUrl: ok } = await load({
        CLOUDINARY_CLOUD_NAME: "demo",
        NODE_ENV: "production"
    });
    const bad = [
        "https://res.cloudinary.com/other/image/upload/v1/a.jpg",
        "https://res.cloudinary.com/demo2/image/upload/v1/a.jpg",
        "https://res.cloudinary.com/demo/../other/image/upload/a.jpg",
        "https://res.cloudinary.com/demo/image/fetch/https://evil.example/x.png",
        "https://res.cloudinary.com/demo/image/private/v1/a.jpg",
        "http://res.cloudinary.com/demo/image/upload/v1/a.jpg",
        "https://evil.example/demo/image/upload/v1/a.jpg",
        "https://res.cloudinary.com.evil.example/demo/image/upload/v1/a.jpg",
        "https://user:pw@res.cloudinary.com/demo/image/upload/v1/a.jpg",
        "https://res.cloudinary.com:8443/demo/image/upload/v1/a.jpg",
        "javascript:alert(1)",
        "",
        null,
        42
    ];
    for (const url of bad) assert.equal(ok(url), false, String(url));
});

test("production without CLOUDINARY_CLOUD_NAME accepts nothing (fails closed)", async () => {
    const { isValidCloudinaryUrl: ok } = await load({ NODE_ENV: "production" });
    assert.equal(ok("https://res.cloudinary.com/demo/image/upload/v1/a.jpg"), false);
});

test("local development without cloud name still allows upload URLs", async () => {
    const { isValidCloudinaryUrl: ok } = await load({ NODE_ENV: "development" });
    assert.equal(ok("https://res.cloudinary.com/demo/image/upload/v1/a.jpg"), true);
    assert.equal(ok("https://res.cloudinary.com/demo/image/fetch/https://evil.example/x"), false);
});

test("pickMedia keeps only expected fields", async () => {
    const { pickMedia } = await load({ NODE_ENV: "development" });
    const out = pickMedia({ url: "u", publicId: "p", mime: "image/png", bytes: "12", evil: "x", width: -1 });
    assert.deepEqual(out, { url: "u", publicId: "p", mime: "image/png", bytes: 12 });
});
