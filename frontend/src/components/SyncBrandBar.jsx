import React from "react";
import SyncLogo from "./SyncLogo.jsx";

// লোগো + গ্রেডিয়েন্ট "Sync" লেখা (মোবাইলে চ্যাট/স্টোরির হেডারে ব্যবহার হয়)
export default function SyncBrandBar({ className = "" }) {
    return (
        <div className={`sync-brandbar ${className}`.trim()}>
            <SyncLogo size="bar" />
            <span className="sync-brandbar-name">Sync</span>
        </div>
    );
}
