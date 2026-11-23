import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    Check,
    CheckCircle2,
    Circle,
    Image as ImageIcon,
    Loader2,
    Pencil,
    Plus,
    RefreshCw,
    Star,
    Tag,
    Trash2,
    Upload,
    X
} from "lucide-react";
import ConfirmDialog from "./ConfirmDialog.jsx";
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

    const handlePick = async e => {
        const picked = e.target.files?.[0];
        if (!picked) return;

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

    const shownItems = items.filter(i => i.category === activeFilter);

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

    return (
        <section className="sync-admin-section">
            <div className="sync-admin-notices-layout">
                {/* ---------- নতুন wallpaper ---------- */}
                <form className="sync-profile-card" onSubmit={handleSubmit}>
                    <h3>
                        <ImageIcon size={18} /> Add Chat Wallpaper
                    </h3>
                    <p className="sync-muted">
                        Upload a wallpaper (for example from Pinterest) and give
                        it a name. Users will see the name and can pick it as
                        their chat background.
                    </p>

                    <div className="sync-wp-admin-form">
                        <div className="sync-wp-admin-preview">
                            <WallpaperPreview url={localUrl} />
                        </div>

                        <div className="sync-wp-admin-fields">
                            <div className="sync-field">
                                <label>Image *</label>
                                <div className="sync-notice-upload-row">
                                    <label className="sync-btn secondary sm">
                                        <Upload size={15} />
                                        <span>
                                            {file ? "Change image" : "Choose image"}
                                        </span>
                                        <input
                                            ref={fileRef}
                                            type="file"
                                            accept="image/jpeg,image/png,image/webp,image/avif"
                                            hidden
                                            onChange={handlePick}
                                            disabled={uploading}
                                        />
                                    </label>
                                    {file && !uploading && (
                                        <button
                                            type="button"
                                            className="sync-btn danger xs"
                                            onClick={resetForm}
                                        >
                                            <X size={14} /> Remove
                                        </button>
                                    )}
                                </div>
                                {dims && (
                                    <small className="sync-wp-meta">
                                        {dims.width} × {dims.height}px ·{" "}
                                        {(file.size / 1024 / 1024).toFixed(1)} MB
                                    </small>
                                )}
                                {lowRes && (
                                    <small className="sync-wp-warn">
                                        This image is small and may look blurry
                                        on phones. A portrait image around
                                        1080 × 1920 works best.
                                    </small>
                                )}
                                {landscape && !lowRes && (
                                    <small className="sync-wp-warn">
                                        This is a landscape image. On phones
                                        the sides will be cropped. A portrait
                                        image fits better.
                                    </small>
                                )}
                            </div>

                            <div className="sync-field">
                                <label>Wallpaper name *</label>
                                <input
                                    type="text"
                                    maxLength={40}
                                    placeholder="e.g. Midnight Forest"
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                    disabled={uploading}
                                    required
                                />
                            </div>

                            <div className="sync-field">
                                <label>Category *</label>
                                <select
                                    className="sync-wp-select"
                                    value={effectiveUploadCat}
                                    onChange={e => setUploadCat(e.target.value)}
                                    disabled={uploading}
                                    required
                                >
                                    {categories.map(c => (
                                        <option key={c._id} value={c._id}>
                                            {c.name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <label className="sync-wp-check-row">
                                <input
                                    type="checkbox"
                                    checked={makeDefault}
                                    onChange={e => setMakeDefault(e.target.checked)}
                                    disabled={uploading}
                                />
                                <span>
                                    Make this the default wallpaper
                                    <em>
                                        Only users on “Default” will switch to
                                        it. Users who picked their own keep
                                        theirs.
                                    </em>
                                </span>
                            </label>

                            {uploading && (
                                <div
                                    className="sync-wp-progress"
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
                                className="sync-btn primary"
                                disabled={uploading || !file || !name.trim()}
                            >
                                {uploading ? (
                                    <>
                                        <Loader2 size={16} className="spin" />{" "}
                                        {pct < 100
                                            ? `Uploading ${pct}%...`
                                            : "Saving..."}
                                    </>
                                ) : (
                                    <>
                                        <Upload size={16} /> Add wallpaper
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </form>

                {/* ---------- ক্যাটাগরি ---------- */}
                <div className="sync-profile-card">
                    <h3>
                        <Tag size={18} /> Categories
                    </h3>
                    <p className="sync-muted">
                        Total {items.length} wallpaper{items.length === 1 ? "" : "s"}
                        {" · "}
                        {categories.length} categor{categories.length === 1 ? "y" : "ies"}
                        . Every wallpaper must have a category. New categories are
                        always added at the end.
                    </p>

                    <form className="sync-wp-cat-add" onSubmit={addCategory}>
                        <input
                            type="text"
                            maxLength={30}
                            placeholder="New category name"
                            value={newCatName}
                            onChange={e => setNewCatName(e.target.value)}
                            disabled={catBusy === "add"}
                        />
                        <button
                            type="submit"
                            className="sync-btn primary sm"
                            disabled={catBusy === "add" || !newCatName.trim()}
                        >
                            {catBusy === "add" ? (
                                <Loader2 size={15} className="spin" />
                            ) : (
                                <Plus size={15} />
                            )}{" "}
                            Add
                        </button>
                    </form>

                    <ul className="sync-wp-cat-list">
                        {categories.map(cat => (
                            <li key={cat._id}>
                                {catRenameId === cat._id ? (
                                    <form
                                        className="sync-wp-rename"
                                        onSubmit={e => {
                                            e.preventDefault();
                                            submitCatRename(cat);
                                        }}
                                    >
                                        <input
                                            type="text"
                                            maxLength={30}
                                            value={catRenameValue}
                                            onChange={e => setCatRenameValue(e.target.value)}
                                            autoFocus
                                        />
                                        <button
                                            type="submit"
                                            className="sync-icon-btn"
                                            aria-label="Save name"
                                            disabled={catBusy === cat._id}
                                        >
                                            <Check size={16} />
                                        </button>
                                        <button
                                            type="button"
                                            className="sync-icon-btn"
                                            aria-label="Cancel"
                                            onClick={() => setCatRenameId(null)}
                                        >
                                            <X size={16} />
                                        </button>
                                    </form>
                                ) : (
                                    <>
                                        <span className="sync-wp-cat-name" title={cat.name}>
                                            {cat.name}
                                        </span>
                                        <em className="sync-wp-cat-count">{cat.count}</em>
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
                                            <Pencil size={15} />
                                        </button>
                                        {!cat.isSystem && (
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
                                                <Trash2 size={15} />
                                            </button>
                                        )}
                                    </>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>

                {/* ---------- তালিকা ---------- */}
                <div className="sync-profile-card">
                    <div className="sync-admin-section-head">
                        <div>
                            <h3>Wallpapers (total {items.length})</h3>
                            <p className="sync-muted">
                                {defaultItem
                                    ? `Default: “${defaultItem.name}” · ${followingDefault} user${
                                          followingDefault === 1 ? "" : "s"
                                      } follow it`
                                    : "No default set. Chats use the classic Sync look."}
                            </p>
                        </div>
                        <div className="sync-wp-head-actions">
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
                            >
                                <RefreshCw
                                    size={15}
                                    className={loading ? "spin" : ""}
                                />
                            </button>
                        </div>
                    </div>

                    {items.length > 0 && (
                        <div className="sync-wp-cats admin" role="tablist">
                            {categories.map(c => (
                                <button
                                    key={c._id}
                                    type="button"
                                    role="tab"
                                    aria-selected={activeFilter === c._id}
                                    className={`sync-wp-cat ${activeFilter === c._id ? "is-active" : ""}`}
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
                    )}

                    {items.length > 0 && (
                        <div className="sync-wp-selectbar">
                            {!selectMode ? (
                                <button
                                    type="button"
                                    className="sync-btn secondary sm"
                                    onClick={() => setSelectMode(true)}
                                    disabled={shownItems.length === 0}
                                >
                                    <CheckCircle2 size={15} /> Select &amp; move
                                </button>
                            ) : (
                                <>
                                    <button
                                        type="button"
                                        className="sync-btn secondary sm"
                                        onClick={toggleSelectAll}
                                    >
                                        {allShownSelected ? "Clear" : `Select all (${shownItems.length})`}
                                    </button>
                                    <select
                                        className="sync-wp-select"
                                        value={moveTo}
                                        onChange={e => setMoveTo(e.target.value)}
                                        aria-label="Move to category"
                                    >
                                        <option value="">Move {selected.size} to...</option>
                                        {categories
                                            .filter(c => c._id !== activeFilter)
                                            .map(c => (
                                                <option key={c._id} value={c._id}>
                                                    {c.name}
                                                </option>
                                            ))}
                                    </select>
                                    <button
                                        type="button"
                                        className="sync-btn primary sm"
                                        onClick={handleMove}
                                        disabled={moving || selected.size === 0 || !moveTo}
                                    >
                                        {moving ? <Loader2 size={15} className="spin" /> : "Move"}
                                    </button>
                                    <button
                                        type="button"
                                        className="sync-btn secondary sm"
                                        onClick={exitSelect}
                                    >
                                        Cancel
                                    </button>
                                </>
                            )}
                        </div>
                    )}

                    {loading && items.length === 0 ? (
                        <div className="sync-wp-empty">
                            <Loader2 size={18} className="spin" /> Loading...
                        </div>
                    ) : items.length === 0 ? (
                        <div className="sync-wp-empty">
                            No wallpapers yet. Add the first one.
                        </div>
                    ) : shownItems.length === 0 ? (
                        <div className="sync-wp-empty">
                            No wallpapers in this category yet.
                        </div>
                    ) : (
                        <div className="sync-wp-admin-grid">
                            {shownItems.map(item => (
                                <div
                                    key={item._id}
                                    className={`sync-wp-admin-card ${
                                        item.isDefault ? "is-default" : ""
                                    } ${selectMode && selected.has(item._id) ? "is-picked" : ""}`}
                                >
                                    <div
                                        className="sync-wp-thumb"
                                        onClick={selectMode ? () => toggleSelect(item._id) : undefined}
                                        role={selectMode ? "checkbox" : undefined}
                                        aria-checked={selectMode ? selected.has(item._id) : undefined}
                                    >
                                        {selectMode && (
                                            <span className="sync-wp-pick">
                                                {selected.has(item._id) ? (
                                                    <CheckCircle2 size={22} />
                                                ) : (
                                                    <Circle size={22} />
                                                )}
                                            </span>
                                        )}
                                        <CachedImg
                                            url={wallpaperThumbUrl(item.url)}
                                            alt={item.name}
                                            />
                                        {item.isDefault && (
                                            <span className="sync-wp-default-tag">
                                                <Star size={11} /> Default
                                            </span>
                                        )}
                                    </div>

                                    {renameId === item._id ? (
                                        <form
                                            className="sync-wp-rename"
                                            onSubmit={e => {
                                                e.preventDefault();
                                                submitRename(item);
                                            }}
                                        >
                                            <input
                                                type="text"
                                                maxLength={40}
                                                value={renameValue}
                                                onChange={e =>
                                                    setRenameValue(e.target.value)
                                                }
                                                autoFocus
                                            />
                                            <button
                                                type="submit"
                                                className="sync-icon-btn"
                                                aria-label="Save name"
                                                disabled={busyId === item._id}
                                            >
                                                <Check size={16} />
                                            </button>
                                            <button
                                                type="button"
                                                className="sync-icon-btn"
                                                aria-label="Cancel"
                                                onClick={() => setRenameId(null)}
                                            >
                                                <X size={16} />
                                            </button>
                                        </form>
                                    ) : (
                                        <div className="sync-wp-admin-info">
                                            <strong title={item.name}>
                                                {item.name}
                                            </strong>
                                            <small>
                                                {item.usedBy} chose this
                                                {item.createdBy
                                                    ? ` · by @${item.createdBy.username}`
                                                    : ""}
                                            </small>
                                        </div>
                                    )}

                                    <div className="sync-wp-admin-actions">
                                        {!item.isDefault && (
                                            <button
                                                type="button"
                                                className="sync-btn secondary xs"
                                                onClick={() => handleMakeDefault(item)}
                                                disabled={busyId === item._id}
                                            >
                                                {busyId === item._id ? (
                                                    <Loader2
                                                        size={13}
                                                        className="spin"
                                                    />
                                                ) : (
                                                    <Star size={13} />
                                                )}{" "}
                                                Make default
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            className="sync-icon-btn"
                                            aria-label="Rename"
                                            title="Rename"
                                            onClick={() => startRename(item)}
                                        >
                                            <Pencil size={15} />
                                        </button>
                                        <button
                                            type="button"
                                            className="sync-icon-btn danger"
                                            aria-label="Delete"
                                            title="Delete"
                                            onClick={() => setToDelete(item)}
                                        >
                                            <Trash2 size={15} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

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
