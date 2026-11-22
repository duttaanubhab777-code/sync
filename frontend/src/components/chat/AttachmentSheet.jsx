import React, { useEffect, useRef, useState } from "react";
import {
    Camera,
    ChevronLeft,
    FileText,
    Headphones,
    Image as ImageIcon,
    Loader2,
    MapPin,
    Send,
    UserRound,
    Video,
    X
} from "lucide-react";
import LocationCard from "./LocationCard.jsx";

const DOC_ACCEPT = [
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".txt",
    ".csv",
    ".md",
    ".json",
    ".zip",
    ".rar",
    ".7z",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "text/csv",
    "application/zip"
].join(",");

const PHONE_VALID_REGEX = /^[+\d][\d\s().\-]{2,31}$/;

const supportsWebContactPicker = () =>
    typeof navigator !== "undefined" &&
    "contacts" in navigator &&
    typeof navigator.contacts?.select === "function";

// Capacitor Android অ্যাপে @capacitor/geolocation থাকলে সেটাই ব্যবহার, নইলে browser navigator.geolocation
async function fetchCurrentCoords() {
    const cap = typeof window !== "undefined" ? window.Capacitor : null;
    const isNative = Boolean(cap?.isNativePlatform?.());
    const capGeo = cap?.Plugins?.Geolocation;

    if (isNative && capGeo?.getCurrentPosition) {
        if (capGeo.requestPermissions) {
            const perm = await capGeo.requestPermissions();
            const granted =
                perm?.location === "granted" ||
                perm?.coarseLocation === "granted";
            if (!granted) {
                const err = new Error(
                    "Location permission was denied. Enable Location for Sync in Android Settings and try again."
                );
                err.code = "PERMISSION_DENIED";
                throw err;
            }
        }
        const pos = await capGeo.getCurrentPosition({
            enableHighAccuracy: true,
            timeout: 15000
        });
        return {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy
        };
    }

    if (typeof navigator === "undefined" || !navigator.geolocation) {
        throw new Error("Location sharing is not supported on this device.");
    }

    return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
            pos =>
                resolve({
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    accuracy: pos.coords.accuracy
                }),
            err => {
                if (err?.code === 1) {
                    reject(
                        new Error(
                            "Location permission denied. Allow location access in your browser or site settings and try again."
                        )
                    );
                } else if (err?.code === 2) {
                    reject(
                        new Error(
                            "Could not determine your location. Make sure GPS / location services are turned on."
                        )
                    );
                } else if (err?.code === 3) {
                    reject(
                        new Error("Location request timed out. Please try again.")
                    );
                } else {
                    reject(new Error("Unable to fetch your current location."));
                }
            },
            {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 30000
            }
        );
    });
}

export default function AttachmentSheet({
    open,
    disabled = false,
    onClose,
    onFilesSelected,
    onSendLocation,
    onSendContact
}) {
    // mode: "menu" | "location" | "contact"
    const [mode, setMode] = useState("menu");

    // লোকেশন প্রিভিউ স্টেট
    const [locLoading, setLocLoading] = useState(false);
    const [locError, setLocError] = useState("");
    const [locCoords, setLocCoords] = useState(null);
    const [locAddress, setLocAddress] = useState("");

    // ম্যানুয়াল কনট্যাক্ট ফর্ম স্টেট
    const [contactName, setContactName] = useState("");
    const [contactPhone, setContactPhone] = useState("");
    const [contactError, setContactError] = useState("");

    // লুকানো file input refs — এগুলো সবসময় DOM-এ মাউন্ট থাকে যাতে sheet বন্ধ হলেও Android/iOS-এ onChange ফায়ার করে
    const galleryInputRef = useRef(null);
    const cameraInputRef = useRef(null);
    const videoInputRef = useRef(null);
    const docInputRef = useRef(null);
    const audioInputRef = useRef(null);

    // Android back button / browser popstate হ্যান্ডলিং
    const pushedHistoryRef = useRef(false);
    const closedViaPopRef = useRef(false);

    useEffect(() => {
        if (!open) {
            setMode("menu");
            setLocError("");
            setLocCoords(null);
            setLocAddress("");
            setContactName("");
            setContactPhone("");
            setContactError("");
            return undefined;
        }

        closedViaPopRef.current = false;
        try {
            window.history.pushState({ syncAttachSheet: true }, "");
            pushedHistoryRef.current = true;
        } catch {
            pushedHistoryRef.current = false;
        }

        const handlePopState = () => {
            if (pushedHistoryRef.current) {
                pushedHistoryRef.current = false;
                closedViaPopRef.current = true;
                onClose();
            }
        };

        const handleKeyDown = e => {
            if (e.key === "Escape") {
                e.preventDefault();
                requestClose();
            }
        };

        window.addEventListener("popstate", handlePopState);
        window.addEventListener("keydown", handleKeyDown);
        return () => {
            window.removeEventListener("popstate", handlePopState);
            window.removeEventListener("keydown", handleKeyDown);
            if (pushedHistoryRef.current && !closedViaPopRef.current) {
                pushedHistoryRef.current = false;
                try {
                    if (window.history.state?.syncAttachSheet) {
                        window.history.back();
                    }
                } catch {
                    // ignore
                }
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const requestClose = () => {
        onClose();
    };

    const handleInputChange = e => {
        const files = e.target.files ? Array.from(e.target.files) : [];
        e.target.value = "";
        if (files.length > 0) {
            onFilesSelected(files);
        }
    };

    // Document বোতামের ফাইল compress ছাড়া, আসল অবস্থায় যাবে
    const handleDocInputChange = e => {
        const files = e.target.files ? Array.from(e.target.files) : [];
        e.target.value = "";
        if (files.length > 0) {
            onFilesSelected(files, { asDocument: true });
        }
    };

    const triggerPicker = ref => {
        if (disabled) return;
        requestClose();
        ref.current?.click();
    };

    const loadLocation = async () => {
        setMode("location");
        setLocLoading(true);
        setLocError("");
        setLocCoords(null);
        try {
            const coords = await fetchCurrentCoords();
            setLocCoords(coords);
        } catch (err) {
            setLocError(err?.message || "Could not get your location.");
        } finally {
            setLocLoading(false);
        }
    };

    const handleConfirmLocation = e => {
        e.preventDefault();
        if (!locCoords) return;
        const payload = {
            lat: locCoords.lat,
            lng: locCoords.lng,
            ...(Number.isFinite(Number(locCoords.accuracy))
                ? { accuracy: Number(locCoords.accuracy) }
                : {}),
            ...(locAddress.trim() ? { address: locAddress.trim().slice(0, 240) } : {})
        };
        onSendLocation(payload);
        requestClose();
    };

    const handlePickContact = async () => {
        if (disabled) return;
        if (supportsWebContactPicker()) {
            try {
                const picked = await navigator.contacts.select(["name", "tel"], {
                    multiple: true
                });
                if (!Array.isArray(picked) || picked.length === 0) {
                    return;
                }
                let sentAny = false;
                for (const item of picked) {
                    const phones = (item?.tel || [])
                        .map(p => String(p || "").trim())
                        .filter(p => PHONE_VALID_REGEX.test(p) && p.replace(/\D/g, "").length >= 3);
                    const name = String(item?.name?.[0] || phones[0] || "").trim().slice(0, 100);
                    if (name && phones.length > 0) {
                        onSendContact({ name, phones: phones.slice(0, 10) });
                        sentAny = true;
                    }
                }
                if (sentAny) {
                    requestClose();
                    return;
                }
                // নির্বাচিত কনট্যাক্টে ফোন নম্বর না থাকলে ম্যানুয়াল ফর্মে যাওয়া
                setContactError("Selected contact had no valid phone number. You can enter it manually.");
                setMode("contact");
                return;
            } catch {
                // WebView বা ব্রাউজারে Contact Picker ব্যর্থ হলে ম্যানুয়াল ফর্মে fallback
                setMode("contact");
                return;
            }
        }
        setMode("contact");
    };

    const handleSubmitManualContact = e => {
        e.preventDefault();
        const name = contactName.trim();
        const phones = contactPhone
            .split(",")
            .map(s => s.trim())
            .filter(Boolean);

        if (!name) {
            setContactError("Please enter a contact name.");
            return;
        }
        if (phones.length === 0) {
            setContactError("Please enter a phone number.");
            return;
        }
        const invalid = phones.find(
            p => !PHONE_VALID_REGEX.test(p) || p.replace(/\D/g, "").length < 3
        );
        if (invalid) {
            setContactError(
                "Enter a valid phone number (digits, +, spaces, hyphens, or parentheses)."
            );
            return;
        }

        onSendContact({
            name: name.slice(0, 100),
            phones: phones.slice(0, 10)
        });
        requestClose();
    };

    const menuItems = [
        {
            id: "gallery",
            label: "Gallery",
            Icon: ImageIcon,
            tone: "gallery",
            onClick: () => triggerPicker(galleryInputRef)
        },
        {
            id: "camera",
            label: "Camera",
            Icon: Camera,
            tone: "camera",
            onClick: () => triggerPicker(cameraInputRef)
        },
        {
            id: "video",
            label: "Video",
            Icon: Video,
            tone: "video",
            onClick: () => triggerPicker(videoInputRef)
        },
        {
            id: "document",
            label: "Document",
            Icon: FileText,
            tone: "document",
            onClick: () => triggerPicker(docInputRef)
        },
        {
            id: "audio",
            label: "Audio",
            Icon: Headphones,
            tone: "audio",
            onClick: () => triggerPicker(audioInputRef)
        },
        {
            id: "location",
            label: "Location",
            Icon: MapPin,
            tone: "location",
            onClick: loadLocation
        },
        {
            id: "contact",
            label: "Contact",
            Icon: UserRound,
            tone: "contact",
            onClick: handlePickContact
        }
    ];

    return (
        <>
            {/* ফাইল ইনপুটগুলো সবসময় মাউন্ট থাকে, নইলে পিকার খোলার আগেই unmount হয়ে onChange হারিয়ে যায় */}
            <input
                ref={galleryInputRef}
                type="file"
                accept="image/*,video/*"
                multiple
                hidden
                disabled={disabled}
                onChange={handleInputChange}
            />
            <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                disabled={disabled}
                onChange={handleInputChange}
            />
            <input
                ref={videoInputRef}
                type="file"
                accept="video/*"
                capture="environment"
                hidden
                disabled={disabled}
                onChange={handleInputChange}
            />
            <input
                ref={docInputRef}
                type="file"
                accept={DOC_ACCEPT}
                multiple
                hidden
                disabled={disabled}
                onChange={handleDocInputChange}
            />
            <input
                ref={audioInputRef}
                type="file"
                accept="audio/*"
                multiple
                hidden
                disabled={disabled}
                onChange={handleInputChange}
            />

            {open && (
                <div
                    className="sync-attach-backdrop"
                    role="presentation"
                    onClick={requestClose}
                >
                    <section
                        className="sync-attach-sheet"
                        role="dialog"
                        aria-modal="true"
                        aria-label="Attach to message"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="sync-attach-handle" aria-hidden="true" />

                        {mode === "menu" && (
                            <div className="sync-attach-grid">
                                {menuItems.map(({ id, label, Icon, tone, onClick }) => (
                                    <button
                                        key={id}
                                        type="button"
                                        className="sync-attach-item"
                                        onClick={onClick}
                                        disabled={disabled}
                                    >
                                        <span className={`sync-attach-circle ${tone}`}>
                                            <Icon size={22} />
                                        </span>
                                        <span className="sync-attach-label">{label}</span>
                                    </button>
                                ))}
                            </div>
                        )}

                        {mode === "location" && (
                            <div className="sync-attach-subview">
                                <div className="sync-attach-subhead">
                                    <button
                                        type="button"
                                        className="sync-icon-btn xs"
                                        aria-label="Back"
                                        onClick={() => setMode("menu")}
                                    >
                                        <ChevronLeft size={18} />
                                    </button>
                                    <h4>Send your current location</h4>
                                    <button
                                        type="button"
                                        className="sync-icon-btn xs"
                                        aria-label="Close"
                                        onClick={requestClose}
                                    >
                                        <X size={16} />
                                    </button>
                                </div>

                                {locLoading && (
                                    <div className="sync-attach-status">
                                        <Loader2 size={20} className="spin" />
                                        <span>Getting your current location...</span>
                                    </div>
                                )}

                                {!locLoading && locError && (
                                    <div className="sync-attach-error-box">
                                        <p>{locError}</p>
                                        <div className="sync-attach-subactions">
                                            <button
                                                type="button"
                                                className="sync-btn ghost sm"
                                                onClick={() => setMode("menu")}
                                            >
                                                Back
                                            </button>
                                            <button
                                                type="button"
                                                className="sync-btn primary sm"
                                                onClick={loadLocation}
                                            >
                                                Try Again
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {!locLoading && locCoords && (
                                    <form
                                        className="sync-attach-form"
                                        onSubmit={handleConfirmLocation}
                                    >
                                        <LocationCard
                                            location={{
                                                ...locCoords,
                                                address: locAddress.trim() || "Your current location"
                                            }}
                                            compact
                                        />
                                        <div className="sync-field">
                                            <label htmlFor="sync-loc-label">
                                                Place label (optional)
                                            </label>
                                            <input
                                                id="sync-loc-label"
                                                type="text"
                                                maxLength={240}
                                                placeholder="e.g. City Centre, Home, Main Gate"
                                                value={locAddress}
                                                onChange={e => setLocAddress(e.target.value)}
                                            />
                                        </div>
                                        <div className="sync-attach-subactions">
                                            <button
                                                type="button"
                                                className="sync-btn ghost sm"
                                                onClick={requestClose}
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                type="submit"
                                                className="sync-btn primary sm"
                                            >
                                                <Send size={15} /> Send Location
                                            </button>
                                        </div>
                                    </form>
                                )}
                            </div>
                        )}

                        {mode === "contact" && (
                            <div className="sync-attach-subview">
                                <div className="sync-attach-subhead">
                                    <button
                                        type="button"
                                        className="sync-icon-btn xs"
                                        aria-label="Back"
                                        onClick={() => setMode("menu")}
                                    >
                                        <ChevronLeft size={18} />
                                    </button>
                                    <h4>Share a contact</h4>
                                    <button
                                        type="button"
                                        className="sync-icon-btn xs"
                                        aria-label="Close"
                                        onClick={requestClose}
                                    >
                                        <X size={16} />
                                    </button>
                                </div>

                                <form
                                    className="sync-attach-form"
                                    onSubmit={handleSubmitManualContact}
                                >
                                    {contactError && (
                                        <div className="sync-alert error">
                                            {contactError}
                                        </div>
                                    )}
                                    <div className="sync-field">
                                        <label htmlFor="sync-contact-name">Name</label>
                                        <input
                                            id="sync-contact-name"
                                            type="text"
                                            maxLength={100}
                                            placeholder="e.g. Arnab Adhikari"
                                            value={contactName}
                                            onChange={e => {
                                                setContactName(e.target.value);
                                                setContactError("");
                                            }}
                                            required
                                        />
                                    </div>
                                    <div className="sync-field">
                                        <label htmlFor="sync-contact-phone">
                                            Phone number (separate multiple with commas)
                                        </label>
                                        <input
                                            id="sync-contact-phone"
                                            type="tel"
                                            maxLength={120}
                                            placeholder="e.g. +91 98765 43210"
                                            value={contactPhone}
                                            onChange={e => {
                                                setContactPhone(e.target.value);
                                                setContactError("");
                                            }}
                                            required
                                        />
                                    </div>
                                    <div className="sync-attach-subactions">
                                        <button
                                            type="button"
                                            className="sync-btn ghost sm"
                                            onClick={requestClose}
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="submit"
                                            className="sync-btn primary sm"
                                        >
                                            <Send size={15} /> Send Contact
                                        </button>
                                    </div>
                                </form>
                            </div>
                        )}
                    </section>
                </div>
            )}
        </>
    );
}
