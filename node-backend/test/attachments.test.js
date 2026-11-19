// Run with:  node --test test/attachments.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { pickMedia, sanitizeFileName } from "../src/utils/cloudinary.js";
import {
    buildLastMessagePreview,
    pickContact,
    pickLocation,
    sanitizePhoneNumber
} from "../src/utils/attachments.js";

test("sanitizeFileName blocks path traversal, control chars and HTML", () => {
    assert.equal(sanitizeFileName("../../etc/passwd"), "passwd");
    assert.equal(sanitizeFileName("C:\\Users\\test\\<script>notes.pdf"), "notes.pdf");
    assert.equal(sanitizeFileName("   ...hidden..report.docx  "), "hidden.report.docx");
    assert.equal(sanitizeFileName("Q1\x00Report\n2026.xlsx"), "Q1Report2026.xlsx");
    assert.equal(sanitizeFileName("..."), "");
    assert.equal(sanitizeFileName(null), "");
    assert.equal(sanitizeFileName("a".repeat(250)).length, 180);
});

test("pickMedia preserves sanitized fileName and drops unsafe/unknown fields", () => {
    const out = pickMedia({
        url: "https://res.cloudinary.com/demo/raw/upload/v1/sync/chat/doc.pdf",
        publicId: "sync/chat/doc.pdf",
        mime: "application/pdf",
        fileName: "../<b>Syllabus 2026.pdf</b>",
        bytes: 4096,
        evil: "drop-me"
    });
    assert.deepEqual(out, {
        url: "https://res.cloudinary.com/demo/raw/upload/v1/sync/chat/doc.pdf",
        publicId: "sync/chat/doc.pdf",
        mime: "application/pdf",
        fileName: "Syllabus 2026.pdf",
        bytes: 4096
    });
});

test("pickLocation validates lat/lng bounds and strips HTML in address", () => {
    const valid = pickLocation({
        lat: 23.520444321,
        lng: 87.311922789,
        accuracy: 14.67,
        address: "  Durgapur <b>West Bengal</b>  "
    });
    assert.deepEqual(valid, {
        lat: 23.5204443,
        lng: 87.3119228,
        accuracy: 14.7,
        address: "Durgapur bWest Bengal/b"
    });

    assert.equal(pickLocation({ lat: 91, lng: 87 }), null);
    assert.equal(pickLocation({ lat: -91, lng: 0 }), null);
    assert.equal(pickLocation({ lat: 23, lng: 181 }), null);
    assert.equal(pickLocation({ lat: "NaN", lng: 87 }), null);
    assert.equal(pickLocation(null), null);
});

test("pickContact validates name and phones, deduplicates and rejects invalid entries", () => {
    const valid = pickContact({
        name: "  Arnab <Adhikari> ",
        phones: ["+91 98765 43210", "+91-98765-43210", "bad<script>", "0343-2541234"]
    });
    assert.deepEqual(valid, {
        name: "Arnab Adhikari",
        phones: ["+91 98765 43210", "0343-2541234"]
    });

    assert.equal(pickContact({ name: "", phones: ["+91 9876543210"] }), null);
    assert.equal(pickContact({ name: "No Phone", phones: [] }), null);
    assert.equal(pickContact({ name: "Invalid Only", phones: ["abc", "12", "javascript:1"] }), null);
    assert.equal(sanitizePhoneNumber("+91 (987) 654-3210"), "+91 (987) 654-3210");
    assert.equal(sanitizePhoneNumber("12"), "");
});

test("buildLastMessagePreview formats location, contact and file previews", () => {
    assert.equal(
        buildLastMessagePreview({ type: "location", location: { lat: 23.5, lng: 87.3 } }),
        "📍 Location"
    );
    assert.equal(
        buildLastMessagePreview({
            type: "location",
            location: { lat: 23.5, lng: 87.3, address: "City Centre" }
        }),
        "📍 City Centre"
    );
    assert.equal(
        buildLastMessagePreview({
            type: "contact",
            contact: { name: "Arnab", phones: ["+91 9876543210"] }
        }),
        "👤 Contact: Arnab"
    );
    assert.equal(
        buildLastMessagePreview({
            type: "file",
            media: { fileName: "Notes.pdf" }
        }),
        "📎 Notes.pdf"
    );
    assert.equal(buildLastMessagePreview({ type: "file", media: {} }), "📎 Attachment");
});
