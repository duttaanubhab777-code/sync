import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    Check,
    CheckCircle2,
    Circle,
    FolderInput,
    Image as ImageIcon,
    ImagePlus,
    Layers,
    Loader2,
    Pencil,
    Plus,
    RefreshCw,
    Search,
    Star,
    Tag,
    Trash2,
    Upload,
    Users,
    X
} from "lucide-react";
import ConfirmDialog from "./ConfirmDialog.jsx";
import SyncSelect from "./ui/SyncSelect.jsx";
import { WallpaperPreview, CachedImg } from "./WallpaperPicker.jsx";
import { api, extractErrorMessage } from "../services/api.js";
import { uploadMediaToCloudinary } from "../services/media.js";
import { wallpaperThumbUrl } from "../services/wallpaper.js";

// Cloudinary free plan-এ ছবির সীমা ১০ MB
const MAX_BYTES = 10 * 1024 * 1024;
const OK_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];

// ছবির আসল মাপ জানা (ছোট/ঝাপসা ছবি আগেই সতর্ক করার জন্য)
const readImageSize = src =>
    new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => reject(new Error("This image could not be read"));
        img.src = src;
    });

// Admin / Super Admin: wallpaper যোগ করা, default ঠিক করা, নাম বদলানো, মোছা
export default function WallpaperAdmin({ flashSuccess, flashError }) {
    const [items, setItems] = useState([]);
    const [followingDefault, setFollowingDefault] = useState(0);
    const [loading, setLoading] = useState(true);

    // ---- ক্যাটাগরি ----
    const [categories, setCategories] = useState([]);
    const [filterId, setFilterId] = useState(null); // null = এখনো বাছা হয়নি (নিচে ঠিক হয়)
    const [newCatName, setNewCatName] = useState("");
    const [catBusy, setCatBusy] = useState(null);
    const [catRenameId, setCatRenameId] = useState(null);
    const [catRenameValue, setCatRenameValue] = useState("");
    const [catToDelete, setCatToDelete] = useState(null);
    const [uploadCat, setUploadCat] = useState(""); // নতুন wallpaper আপলোডের ক্যাটাগরি (বাধ্যতামূলক)

    // ---- একসাথে সরানো ----
    const [selectMode, setSelectMode] = useState(false);
    const [selected, setSelected] = useState(() => new Set());
    const [moveTo, setMoveTo] = useState("");
    const [moving, setMoving] = useState(false);

    // ---- নতুন wallpaper ফর্ম ----
    const fileRef = useRef(null);
    const [file, setFile] = useState(null);
    const [localUrl, setLocalUrl] = useState("");
    const [dims, setDims] = useState(null);
    const [name, setName] = useState("");
    const [makeDefault, setMakeDefault] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [pct, setPct] = useState(0);

    const [dragOver, setDragOver] = useState(false);
    const [query, setQuery] = useState("");

    // ---- তালিকার অ্যাকশন ----
    const [busyId, setBusyId] = useState(null);
    const [renameId, setRenameId] = useState(null);
    const [renameValue, setRenameValue] = useState("");
    const [toDelete, setToDelete] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get("/api/v1/admin/wallpapers");
            const d = res.data?.data || {};
            setItems(Array.isArray(d.wallpapers) ? d.wallpapers : []);
            setFollowingDefault(d.followingDefault || 0);
            setCategories(Array.isArray(d.categories) ? d.categories : []);
        } catch (err) {
            flashError(err);
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    useEffect(
        () => () => {
            if (localUrl) URL.revokeObjectURL(localUrl);
        },
        [localUrl]
    );

    const resetForm = () => {
        setFile(null);
        setLocalUrl("");
        setDims(null);
        setName("");
        setMakeDefault(false);
        setPct(0);
        if (fileRef.current) fileRef.current.value = "";
    };

    const handlePick = e => processFile(e.target.files?.[0], e.target);

    const handleDrop = e => {
        e.preventDefault();
        setDragOver(false);
        if (uploading) return;
        processFile(e.dataTransfer?.files?.[0], fileRef.current);
    };

    const processFile = async (picked, input) => {
        if (!picked) return;
        const e = { target: input || { value: "" } };

        if (!OK_TYPES.includes(picked.type)) {
            flashError("Please choose a JPG, PNG or WebP image");
            e.target.value = "";
            return;
        }
        if (picked.size > MAX_BYTES) {
            flashError("Image is too large (max 10 MB). Try a smaller or compressed version.");
            e.target.value = "";
            return;
        }

        const url = URL.createObjectURL(picked);
        try {
            const size = await readImageSize(url);
            setDims(size);
            setLocalUrl(url);
            setFile(picked);
            // নাম খালি থাকলে ফাইলের নাম থেকে একটা সুন্দর নাম ধরে দেওয়া
            setName(prev =>
                prev.trim()
                    ? prev
                    : picked.name
                          .replace(/\.[^.]+$/, "")
                          .replace(/[_-]+/g, " ")
                          .replace(/\s+/g, " ")
                          .trim()
                          .slice(0, 40)
            );
        } catch (err) {
            URL.revokeObjectURL(url);
            flashError(err.message);
            e.target.value = "";
        }
    };

    const shortSide = dims ? Math.min(dims.width, dims.height) : 0;
    const lowRes = dims && shortSide < 720;
    const landscape = dims && dims.width > dims.height;

    const handleSubmit = async e => {
        e.preventDefault();
        const cleanName = name.trim();
        if (!file) return flashError("Choose an image first");
        if (!cleanName) return flashError("Give the wallpaper a name");
        if (!effectiveUploadCat) return flashError("Add a category first, then upload");

        setUploading(true);
        setPct(0);
        try {
            // "notice" ফোল্ডার/purpose আগে থেকেই Python সার্ভিসে আছে (শুধু ছবির ফরম্যাট),
            // তাই Python-এ কিছু বদলাতে হয়নি
            const uploaded = await uploadMediaToCloudinary(file, setPct, {
                purpose: "notice"
            });
            await api.post("/api/v1/admin/wallpapers", {
                name: cleanName,
                imageUrl: uploaded.url,
                imagePublicId: uploaded.publicId || "",
                width: uploaded.width || dims?.width || 0,
                height: uploaded.height || dims?.height || 0,
                makeDefault,
                categoryId: effectiveUploadCat
            });
            flashSuccess(
                makeDefault
                    ? `"${cleanName}" added and set as the default wallpaper`
                    : `"${cleanName}" added`
            );
            resetForm();
            load();
        } catch (err) {
            flashError(err.response ? extractErrorMessage(err) : err.message);
        } finally {
            setUploading(false);
            setPct(0);
        }
    };

    const handleMakeDefault = async item => {
        setBusyId(item._id);
        try {
            await api.put("/api/v1/admin/wallpapers/default", {
                wallpaperId: item._id
            });
            flashSuccess(`"${item.name}" is now the default wallpaper`);
            await load();
        } catch (err) {
            flashError(err);
        } finally {
            setBusyId(null);
        }
    };

    const handleClearDefault = async () => {
        setBusyId("clear");
        try {
            await api.put("/api/v1/admin/wallpapers/default", {
                wallpaperId: null
            });
            flashSuccess("Default wallpaper cleared. Chats use the classic look.");
            await load();
        } catch (err) {
            flashError(err);
        } finally {
            setBusyId(null);
        }
    };

    const startRename = item => {
        setRenameId(item._id);
        setRenameValue(item.name);
    };

    const submitRename = async item => {
        const next = renameValue.trim();
        if (!next || next === item.name) {
            setRenameId(null);
            return;
        }
        setBusyId(item._id);
        try {
            await api.patch(`/api/v1/admin/wallpapers/${item._id}`, {
                name: next
            });
            flashSuccess("Wallpaper renamed");
            setRenameId(null);
            await load();
        } catch (err) {
            flashError(err);
        } finally {
            setBusyId(null);
        }
    };

    const confirmDelete = async () => {
        const item = toDelete;
        if (!item) return;
        setBusyId(item._id);
        try {
            await api.delete(`/api/v1/admin/wallpapers/${item._id}`);
            flashSuccess(`"${item.name}" deleted`);
            setToDelete(null);
            await load();
        } catch (err) {
            flashError(err);
        } finally {
            setBusyId(null);
        }
    };

    // ---------- ক্যাটাগরি অ্যাকশন ----------
    const catName = id => categories.find(c => c._id === id)?.name || "";

    // কোন ক্যাটাগরি এখন দেখানো হচ্ছে: বাছা ক্যাটাগরি, নাহলে যেটায় আগে wallpaper আছে (পুরোনো "Uncategorized" গোছানোর সুবিধার জন্য)
    const activeFilter = (() => {
        if (filterId && categories.some(c => c._id === filterId)) return filterId;
        const uncat = categories.find(c => /^uncategorized$/i.test(c.name) && c.count > 0);
        if (uncat) return uncat._id;
        return (categories.find(c => c.count > 0) || categories[0])?._id || null;
    })();

    // আপলোডের ক্যাটাগরি না বাছলে প্রথম ক্যাটাগরিটাই ধরা হয়
    const effectiveUploadCat =
        categories.some(c => c._id === uploadCat) ? uploadCat : categories[0]?._id || "";

    const q = query.trim().toLowerCase();
    const shownItems = items.filter(
        i => i.category === activeFilter && (!q || String(i.name).toLowerCase().includes(q))
    );

    const addCategory = async e => {
        e.preventDefault();
        const name = newCatName.trim();
        if (!name) return;
        setCatBusy("add");
        try {
            const res = await api.post("/api/v1/admin/wallpaper-categories", { name });
            flashSuccess(`Category "${name}" added`);
            setNewCatName("");
            await load();
            setFilterId(res.data?.data?._id || null);
        } catch (err) {
            flashError(err);
        } finally {
            setCatBusy(null);
        }
    };

    const submitCatRename = async cat => {
        const next = catRenameValue.trim();
        if (!next || next === cat.name) {
            setCatRenameId(null);
            return;
        }
        setCatBusy(cat._id);
        try {
            await api.patch(`/api/v1/admin/wallpaper-categories/${cat._id}`, { name: next });
            flashSuccess("Category renamed");
            setCatRenameId(null);
            await load();
        } catch (err) {
            flashError(err);
        } finally {
            setCatBusy(null);
        }
    };

    const confirmDeleteCategory = async () => {
        const cat = catToDelete;
        if (!cat) return;
        setCatBusy(cat._id);
        try {
            await api.delete(`/api/v1/admin/wallpaper-categories/${cat._id}`);
            flashSuccess(`Category "${cat.name}" deleted`);
            setCatToDelete(null);
            if (filterId === cat._id) setFilterId(null);
            if (uploadCat === cat._id) setUploadCat("");
            await load();
        } catch (err) {
            flashError(err);
        } finally {
            setCatBusy(null);
        }
    };

    // ---------- একসাথে সরানো ----------
    const toggleSelect = id =>
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    const exitSelect = () => {
        setSelectMode(false);
        setSelected(new Set());
        setMoveTo("");
    };

    const allShownSelected =
        shownItems.length > 0 && shownItems.every(i => selected.has(i._id));

    const toggleSelectAll = () =>
        setSelected(allShownSelected ? new Set() : new Set(shownItems.map(i => i._id)));

    const handleMove = async () => {
        if (selected.size === 0 || !moveTo) return;
        setMoving(true);
        try {
            await api.patch("/api/v1/admin/wallpapers/move", {
                ids: [...selected],
                categoryId: moveTo
            });
            flashSuccess(
                `${selected.size} wallpaper${selected.size === 1 ? "" : "s"} moved to "${catName(moveTo)}"`
            );
            exitSelect();
            await load();
        } catch (err) {
            flashError(err);
        } finally {
            setMoving(false);
        }
    };

    const defaultItem = items.find(i => i.isDefault);

    const catOptions = categories.map(c => ({
        value: c._id,
        label: c.name,
        count: c.count
    }));
    const moveOptions = categories
        .filter(c => c._id !== activeFilter)
        .map(c => ({ value: c._id, label: c.name, count: c.count }));
    const maxCount = Math.max(1, ...categories.map(c => c.count || 0));

    return (
        <section className="sync-admin-section wpa">
            {/* ---------- উপরের সারাংশ ---------- */}
            <div className="wpa-stats">
                <div className="wpa-stat" style={{ "--i": 0 }}>
                    <span className="wpa-stat-ico"><ImageIcon size={20} /></span>
                    <div>
                        <strong>{items.length}</strong>
                        <small>Wallpapers</small>
                    </div>
                </div>
                <div className="wpa-stat" style={{ "--i": 1 }}>
                    <span className="wpa-stat-ico"><Layers size={20} /></span>
                    <div>
                        <strong>{categories.length}</strong>
                        <small>Categories</small>
                    </div>
                </div>
                <div className="wpa-stat" style={{ "--i": 2 }}>
                    <span className="wpa-stat-ico"><Users size={20} /></span>
                    <div>
                        <strong>{followingDefault}</strong>
                        <small>Follow default</small>
                    </div>
                </div>
                <div className="wpa-stat is-default" style={{ "--i": 3 }}>
                    <span className="wpa-stat-ico"><Star size={20} /></span>
                    <div>
                        <strong title={defaultItem?.name || ""}>
                            {defaultItem ? defaultItem.name : "Not set"}
                        </strong>
                        <small>Default wallpaper</small>
                    </div>
                </div>
            </div>

            <div className="wpa-top">
                {/* ---------- নতুন wallpaper ---------- */}
                <form className="wpa-card wpa-upload" onSubmit={handleSubmit}>
                    <header className="wpa-card-head">
                        <span className="wpa-card-ico"><ImagePlus size={19} /></span>
                        <div>
                            <h3>Add chat wallpaper</h3>
                            <p>Upload a portrait image and give it a name. Users see the name and can pick it as their chat background.</p>
                        </div>
                    </header>

                    <div className="wpa-upload-grid">
                        <label
                            className={`wpa-drop ${dragOver ? "is-over" : ""} ${file ? "has-file" : ""}`}
                            onDragOver={e => {
                                e.preventDefault();
                                setDragOver(true);
                            }}
                            onDragLeave={() => setDragOver(false)}
                            onDrop={handleDrop}
                        >
                            <WallpaperPreview url={localUrl} />
                            {!file && (
                                <span className="wpa-drop-hint">
                                    <Upload size={22} />
                                    <b>Tap to choose</b>
                                    <small>or drop an image here</small>
                                </span>
                            )}
                            <input
                                ref={fileRef}
                                type="file"
                                accept="image/jpeg,image/png,image/webp,image/avif"
                                hidden
                                onClick={e => {
                                    e.target.value = "";
                                }}
                                onChange={handlePick}
                                disabled={uploading}
                            />
                        </label>

                        <div className="wpa-fields">
                            <div className="wpa-field">
                                <span className="wpa-label">Image</span>
                                <div className="wpa-file-row">
                                    <label className="sync-btn secondary sm">
                                        <Upload size={15} />
                                        <span>{file ? "Change image" : "Choose image"}</span>
                                        <input
                                            type="file"
                                            accept="image/jpeg,image/png,image/webp,image/avif"
                                            hidden
                                            onClick={e => {
                                                e.target.value = "";
                                            }}
                                            onChange={handlePick}
                                            disabled={uploading}
                                        />
                                    </label>
                                    {file && !uploading && (
                                        <button type="button" className="sync-btn danger xs" onClick={resetForm}>
                                            <X size={14} /> Remove
                                        </button>
                                    )}
                                </div>
                                {dims && (
                                    <div className="wpa-meta">
                                        <span>{dims.width} × {dims.height}px</span>
                                        <span>{(file.size / 1024 / 1024).toFixed(1)} MB</span>
                                    </div>
                                )}
                                {lowRes && (
                                    <p className="wpa-warn">
                                        This image is small and may look blurry on phones. A portrait image around 1080 × 1920 works best.
                                    </p>
                                )}
                                {landscape && !lowRes && (
                                    <p className="wpa-warn">
                                        This is a landscape image. On phones the sides will be cropped. A portrait image fits better.
                                    </p>
                                )}
                            </div>

                            <div className="wpa-field">
                                <label className="wpa-label" htmlFor="wpa-name">Wallpaper name</label>
                                <input
                                    id="wpa-name"
                                    className="wpa-input"
                                    type="text"
                                    maxLength={40}
                                    placeholder="e.g. Midnight Forest"
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                    disabled={uploading}
                                    required
                                />
                            </div>

                            <div className="wpa-field">
                                <span className="wpa-label">Category</span>
                                <SyncSelect
                                    title="Choose category"
                                    icon={Tag}
                                    value={effectiveUploadCat}
                                    onChange={setUploadCat}
                                    options={catOptions}
                                    placeholder="Add a category first"
                                    disabled={uploading || categories.length === 0}
                                />
                            </div>

                            <label className={`wpa-switch-row ${makeDefault ? "is-on" : ""}`}>
                                <input
                                    type="checkbox"
                                    checked={makeDefault}
                                    onChange={e => setMakeDefault(e.target.checked)}
                                    disabled={uploading}
                                />
                                <span className="wpa-switch" aria-hidden="true"><i /></span>
                                <span className="wpa-switch-text">
                                    Make this the default wallpaper
                                    <em>Only users on “Default” will switch to it. Users who picked their own keep theirs.</em>
                                </span>
                            </label>

                            {uploading && (
                                <div
                                    className="wpa-progress"
                                    role="progressbar"
                                    aria-valuenow={pct}
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                >
                                    <i style={{ transform: `scaleX(${pct / 100})` }} />
                                </div>
                            )}

                            <button
                                type="submit"
                                className="sync-btn primary lg wpa-submit"
                                disabled={uploading || !file || !name.trim()}
                            >
                                {uploading ? (
                                    <>
                                        <Loader2 size={17} className="spin" />{" "}
                                        {pct < 100 ? `Uploading ${pct}%...` : "Saving..."}
                                    </>
                                ) : (
                                    <>
                                        <Upload size={17} /> Add wallpaper
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </form>

                {/* ---------- ক্যাটাগরি ---------- */}
                <div className="wpa-card wpa-cats">
                    <header className="wpa-card-head">
                        <span className="wpa-card-ico"><Tag size={19} /></span>
                        <div>
                            <h3>Categories</h3>
                            <p>Every wallpaper needs a category. New categories are always added at the end.</p>
                        </div>
                    </header>

                    <form className="wpa-cat-add" onSubmit={addCategory}>
                        <input
                            className="wpa-input"
                            type="text"
                            maxLength={30}
                            placeholder="New category name"
                            value={newCatName}
                            onChange={e => setNewCatName(e.target.value)}
                            disabled={catBusy === "add"}
                        />
                        <button
                            type="submit"
                            className="sync-btn primary"
                            disabled={catBusy === "add" || !newCatName.trim()}
                        >
                            {catBusy === "add" ? <Loader2 size={16} className="spin" /> : <Plus size={16} />} Add
                        </button>
                    </form>

                    <ul className="wpa-cat-list">
                        {categories.map((cat, i) => (
                            <li key={cat._id} style={{ "--i": i }}>
                                {catRenameId === cat._id ? (
                                    <form
                                        className="wpa-rename"
                                        onSubmit={e => {
                                            e.preventDefault();
                                            submitCatRename(cat);
                                        }}
                                    >
                                        <input
                                            className="wpa-input sm"
                                            type="text"
                                            maxLength={30}
                                            value={catRenameValue}
                                            onChange={e => setCatRenameValue(e.target.value)}
                                            autoFocus
                                        />
                                        <button type="submit" className="sync-icon-btn" aria-label="Save name" disabled={catBusy === cat._id}>
                                            <Check size={17} />
                                        </button>
                                        <button type="button" className="sync-icon-btn" aria-label="Cancel" onClick={() => setCatRenameId(null)}>
                                            <X size={17} />
                                        </button>
                                    </form>
                                ) : (
                                    <>
                                        <div className="wpa-cat-main">
                                            <span className="wpa-cat-name" title={cat.name}>{cat.name}</span>
                                            <span className="wpa-cat-bar" aria-hidden="true">
                                                <i style={{ transform: `scaleX(${(cat.count || 0) / maxCount})` }} />
                                            </span>
                                        </div>
                                        <em className="wpa-cat-count">{cat.count}</em>
                                        <button
                                            type="button"
                                            className="sync-icon-btn"
                                            aria-label="Rename category"
                                            title="Rename"
                                            onClick={() => {
                                                setCatRenameId(cat._id);
                                                setCatRenameValue(cat.name);
                                            }}
                                        >
                                            <Pencil size={16} />
                                        </button>
                                        {!cat.isSystem ? (
                                            <button
                                                type="button"
                                                className="sync-icon-btn danger"
                                                aria-label="Delete category"
                                                title="Delete"
                                                onClick={() =>
                                                    cat.count > 0
                                                        ? flashError(
                                                              `"${cat.name}" still has ${cat.count} wallpaper${
                                                                  cat.count === 1 ? "" : "s"
                                                              }. Move ${cat.count === 1 ? "it" : "them"} to another category first.`
                                                          )
                                                        : setCatToDelete(cat)
                                                }
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        ) : (
                                            <span className="wpa-cat-lock" aria-hidden="true" />
                                        )}
                                    </>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            </div>

            {/* ---------- তালিকা ---------- */}
            <div className="wpa-card wpa-library">
                <header className="wpa-lib-head">
                    <div>
                        <h3>Wallpaper library</h3>
                        <p>
                            {defaultItem
                                ? `Default: “${defaultItem.name}” · ${followingDefault} user${followingDefault === 1 ? "" : "s"} follow it`
                                : "No default set. Chats use the classic Sync look."}
                        </p>
                    </div>
                    <div className="wpa-lib-actions">
                        {defaultItem && (
                            <button
                                type="button"
                                className="sync-btn secondary sm"
                                onClick={handleClearDefault}
                                disabled={busyId === "clear"}
                            >
                                Clear default
                            </button>
                        )}
                        <button
                            type="button"
                            className="sync-btn secondary sm"
                            onClick={load}
                            disabled={loading}
                            aria-label="Refresh"
                        >
                            <RefreshCw size={15} className={loading ? "spin" : ""} />
                        </button>
                    </div>
                </header>

                {items.length > 0 && (
                    <>
                        <div className="wpa-tabs" role="tablist">
                            {categories.map(c => (
                                <button
                                    key={c._id}
                                    type="button"
                                    role="tab"
                                    aria-selected={activeFilter === c._id}
                                    className={`wpa-tab ${activeFilter === c._id ? "is-active" : ""}`}
                                    onClick={() => {
                                        setFilterId(c._id);
                                        setSelected(new Set());
                                    }}
                                >
                                    {c.name}
                                    <em>{c.count}</em>
                                </button>
                            ))}
                        </div>

                        <div className="wpa-toolbar">
                            <label className="wpa-search">
                                <Search size={16} />
                                <input
                                    type="search"
                                    placeholder="Search in this category"
                                    value={query}
                                    onChange={e => setQuery(e.target.value)}
                                />
                                {query && (
                                    <button type="button" aria-label="Clear search" onClick={() => setQuery("")}>
                                        <X size={14} />
                                    </button>
                                )}
                            </label>
                            {!selectMode && (
                                <button
                                    type="button"
                                    className="sync-btn secondary"
                                    onClick={() => setSelectMode(true)}
                                    disabled={shownItems.length === 0}
                                >
                                    <CheckCircle2 size={16} /> Select &amp; move
                                </button>
                            )}
                        </div>
                    </>
                )}

                {loading && items.length === 0 ? (
                    <div className="wpa-empty">
                        <Loader2 size={20} className="spin" /> Loading...
                    </div>
                ) : items.length === 0 ? (
                    <div className="wpa-empty">
                        <ImageIcon size={26} />
                        <b>No wallpapers yet</b>
                        <span>Add the first one from the form above.</span>
                    </div>
                ) : shownItems.length === 0 ? (
                    <div className="wpa-empty">
                        <ImageIcon size={26} />
                        <b>{q ? "No match found" : "Nothing in this category"}</b>
                        <span>{q ? "Try a different name." : "Upload one or move some here."}</span>
                    </div>
                ) : (
                    <div className="wpa-grid" key={activeFilter}>
                        {shownItems.map((item, idx) => {
                            const picked = selectMode && selected.has(item._id);
                            return (
                                <article
                                    key={item._id}
                                    className={`wpa-item ${item.isDefault ? "is-default" : ""} ${picked ? "is-picked" : ""}`}
                                    style={{ "--i": Math.min(idx, 12) }}
                                >
                                    <div
                                        className="wpa-thumb"
                                        onClick={selectMode ? () => toggleSelect(item._id) : undefined}
                                        role={selectMode ? "checkbox" : undefined}
                                        aria-checked={selectMode ? picked : undefined}
                                    >
                                        <CachedImg url={wallpaperThumbUrl(item.url)} alt={item.name} />
                                        <span className="wpa-shade" aria-hidden="true" />
                                        {item.isDefault && (
                                            <span className="wpa-badge">
                                                <Star size={11} /> Default
                                            </span>
                                        )}
                                        {selectMode && (
                                            <span className="wpa-pick">
                                                {picked ? <CheckCircle2 size={24} /> : <Circle size={24} />}
                                            </span>
                                        )}
                                        <span className="wpa-used">
                                            <Users size={11} /> {item.usedBy}
                                        </span>
                                    </div>

                                    {renameId === item._id ? (
                                        <form
                                            className="wpa-rename"
                                            onSubmit={e => {
                                                e.preventDefault();
                                                submitRename(item);
                                            }}
                                        >
                                            <input
                                                className="wpa-input sm"
                                                type="text"
                                                maxLength={40}
                                                value={renameValue}
                                                onChange={e => setRenameValue(e.target.value)}
                                                autoFocus
                                            />
                                            <button type="submit" className="sync-icon-btn xs" aria-label="Save name" disabled={busyId === item._id}>
                                                <Check size={16} />
                                            </button>
                                            <button type="button" className="sync-icon-btn xs" aria-label="Cancel" onClick={() => setRenameId(null)}>
                                                <X size={16} />
                                            </button>
                                        </form>
                                    ) : (
                                        <div className="wpa-info">
                                            <strong title={item.name}>{item.name}</strong>
                                            <small>
                                                {item.usedBy} chose this
                                                {item.createdBy ? ` · @${item.createdBy.username}` : ""}
                                            </small>
                                        </div>
                                    )}

                                    {!selectMode && (
                                        <div className="wpa-actions">
                                            {item.isDefault ? (
                                                <span className="wpa-is-default">
                                                    <Star size={13} /> Default
                                                </span>
                                            ) : (
                                                <button
                                                    type="button"
                                                    className="wpa-default-btn"
                                                    onClick={() => handleMakeDefault(item)}
                                                    disabled={busyId === item._id}
                                                >
                                                    {busyId === item._id ? (
                                                        <Loader2 size={14} className="spin" />
                                                    ) : (
                                                        <Star size={14} />
                                                    )}
                                                    Make default
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                className="sync-icon-btn xs"
                                                aria-label="Rename"
                                                title="Rename"
                                                onClick={() => startRename(item)}
                                            >
                                                <Pencil size={15} />
                                            </button>
                                            <button
                                                type="button"
                                                className="sync-icon-btn xs danger"
                                                aria-label="Delete"
                                                title="Delete"
                                                onClick={() => setToDelete(item)}
                                            >
                                                <Trash2 size={15} />
                                            </button>
                                        </div>
                                    )}
                                </article>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ---------- একসাথে সরানোর ভাসমান বার ---------- */}
            {selectMode && (
                <div className="wpa-movebar" role="region" aria-label="Move selected wallpapers">
                    <div className="wpa-movebar-top">
                        <strong>
                            <FolderInput size={17} /> {selected.size} selected
                        </strong>
                        <button type="button" className="wpa-link" onClick={toggleSelectAll}>
                            {allShownSelected ? "Clear all" : `Select all (${shownItems.length})`}
                        </button>
                    </div>
                    <div className="wpa-movebar-row">
                        <SyncSelect
                            title="Move to category"
                            className="is-compact"
                            value={moveTo}
                            onChange={setMoveTo}
                            options={moveOptions}
                            placeholder="Move to..."
                        />
                        <button
                            type="button"
                            className="sync-btn primary"
                            onClick={handleMove}
                            disabled={moving || selected.size === 0 || !moveTo}
                        >
                            {moving ? <Loader2 size={16} className="spin" /> : "Move"}
                        </button>
                        <button type="button" className="sync-btn secondary" onClick={exitSelect}>
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {catToDelete && (
                <ConfirmDialog
                    icon={Trash2}
                    title="Delete this category?"
                    message={`“${catToDelete.name}” is empty and will be deleted.`}
                    confirmLabel="Delete category"
                    busy={catBusy === catToDelete._id}
                    onConfirm={confirmDeleteCategory}
                    onCancel={() => setCatToDelete(null)}
                />
            )}

            {toDelete && (
                <ConfirmDialog
                    icon={Trash2}
                    title="Delete this wallpaper?"
                    message={`“${toDelete.name}” will be removed for everyone. Users who picked it go back to the Default wallpaper.`}
                    confirmLabel="Delete"
                    busy={busyId === toDelete._id}
                    onConfirm={confirmDelete}
                    onCancel={() => setToDelete(null)}
                />
            )}
        </section>
    );
}
