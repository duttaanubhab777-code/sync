import React, { useState } from "react";
import { MapPin, ExternalLink, Navigation } from "lucide-react";

// OpenStreetMap Slippy Map টাইল স্থানাঙ্ক বের করা (কোনো API key লাগে না)
export const getOsmTileInfo = (lat, lng, zoom = 15) => {
    const clampedLat = Math.max(-85.0511, Math.min(85.0511, Number(lat) || 0));
    const clampedLng = Math.max(-180, Math.min(180, Number(lng) || 0));
    const latRad = (clampedLat * Math.PI) / 180;
    const n = 2 ** zoom;
    const xExact = ((clampedLng + 180) / 360) * n;
    const yExact =
        ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
        n;
    const xTile = Math.floor(xExact);
    const yTile = Math.floor(yExact);
    const pinLeftPct = Math.max(8, Math.min(92, (xExact - xTile) * 100));
    const pinTopPct = Math.max(12, Math.min(88, (yExact - yTile) * 100));

    return {
        tileUrl: `https://tile.openstreetmap.org/${zoom}/${xTile}/${yTile}.png`,
        pinLeftPct,
        pinTopPct
    };
};

export const formatCoords = (lat, lng) => {
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return "";
    return `${la.toFixed(5)}, ${ln.toFixed(5)}`;
};

export default function LocationCard({ location, compact = false }) {
    const [tileFailed, setTileFailed] = useState(false);

    if (!location || !Number.isFinite(Number(location.lat)) || !Number.isFinite(Number(location.lng))) {
        return null;
    }

    const lat = Number(location.lat);
    const lng = Number(location.lng);
    const accuracy = Number.isFinite(Number(location.accuracy))
        ? Math.round(Number(location.accuracy))
        : null;
    const address = location.address || "";
    const coordsText = formatCoords(lat, lng);

    const { tileUrl, pinLeftPct, pinTopPct } = getOsmTileInfo(lat, lng, 15);
    const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
    const osmUrl = `https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lng)}#map=16/${encodeURIComponent(lat)}/${encodeURIComponent(lng)}`;

    return (
        <div className={`sync-location-card ${compact ? "compact" : ""}`}>
            <a
                href={googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="sync-location-map-link"
                onClick={e => e.stopPropagation()}
                title="Open in Google Maps"
            >
                <div className={`sync-location-map ${tileFailed ? "fallback" : ""}`}>
                    {!tileFailed && (
                        <img
                            src={tileUrl}
                            alt={`Map at ${coordsText}`}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            onError={() => setTileFailed(true)}
                        />
                    )}
                    <span
                        className="sync-location-pin"
                        style={
                            tileFailed
                                ? undefined
                                : {
                                      left: `${pinLeftPct}%`,
                                      top: `${pinTopPct}%`
                                  }
                        }
                        aria-hidden="true"
                    >
                        <MapPin size={22} />
                    </span>
                    <span className="sync-location-badge">
                        <Navigation size={11} /> Maps
                    </span>
                </div>
            </a>

            <div className="sync-location-body">
                <div className="sync-location-info">
                    <strong className="sync-location-title">
                        {address || "Shared Location"}
                    </strong>
                    <span className="sync-location-coords">
                        {coordsText}
                        {accuracy !== null ? ` · ±${accuracy}m` : ""}
                    </span>
                </div>
                {!compact && (
                    <div className="sync-location-links">
                        <a
                            href={googleMapsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                        >
                            Google Maps <ExternalLink size={12} />
                        </a>
                        <a
                            href={osmUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                        >
                            OSM <ExternalLink size={12} />
                        </a>
                    </div>
                )}
            </div>
        </div>
    );
}
