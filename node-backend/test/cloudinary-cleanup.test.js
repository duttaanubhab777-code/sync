import test from "node:test";
import assert from "node:assert/strict";

process.env.CLOUDINARY_CLOUD_NAME = "demo";
process.env.NODE_ENV = "production";
const { parseCloudinaryUrl } = await import("../src/services/cloudinaryCleanup.service.js");

test("image URL with version and extension", () => {
    assert.deepEqual(
        parseCloudinaryUrl("https://res.cloudinary.com/demo/image/upload/v123/sync/chat/abc.jpg"),
        { resourceType: "image", publicId: "sync/chat/abc" }
    );
});

test("video URL with transformations", () => {
    assert.deepEqual(
        parseCloudinaryUrl("https://res.cloudinary.com/demo/video/upload/f_auto,q_auto/v9/sync/stories/x.mp4"),
        { resourceType: "video", publicId: "sync/stories/x" }
    );
});

test("raw file keeps its extension", () => {
    assert.deepEqual(
        parseCloudinaryUrl("https://res.cloudinary.com/demo/raw/upload/v1/sync/chat/doc.pdf"),
        { resourceType: "raw", publicId: "sync/chat/doc.pdf" }
    );
});

test("no version, with transformation", () => {
    assert.deepEqual(
        parseCloudinaryUrl("https://res.cloudinary.com/demo/image/upload/w_200,h_200/sync/avatars/a.png"),
        { resourceType: "image", publicId: "sync/avatars/a" }
    );
});

test("foreign / invalid URLs are ignored", () => {
    assert.equal(parseCloudinaryUrl("https://res.cloudinary.com/other/image/upload/v1/a.jpg"), null);
    assert.equal(parseCloudinaryUrl("https://evil.com/demo/image/upload/v1/a.jpg"), null);
    assert.equal(parseCloudinaryUrl(""), null);
});
