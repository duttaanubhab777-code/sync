import React from "react";
import SyncLogo from "./SyncLogo.jsx";

export default function SyncBrandBar({ className = "" }) {
    return (
        <header className={`sync-brandbar ${className}`.trim()}>
            <SyncLogo size="bar" />
            <span className="sync-brandbar-name">Sync</span>
        </header>
    );
}
