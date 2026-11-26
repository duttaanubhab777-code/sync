import React, { useState, useEffect, useRef } from "react";
import { useDispatch } from "react-redux";
import {
    Paperclip,
    Mic,
    Pause,
    Play,
    Send,
    ChevronLeft,
    ChevronUp
} from "lucide-react";
import AttachmentSheet from "./AttachmentSheet.jsx";
import PollIcon from "./PollIcon.jsx";
import VoiceTrash from "./VoiceTrash.jsx";
import { setReplyTo } from "../../store/chatSlice.js";
import { emitTypingStart, emitTypingStop } from "../../services/socket.js";
import { enqueueMediaMessage } from "../../services/outbox.js";
import {
    playSound,
    getSharedAudioContext,
    resumeAudio
} from "../../services/sounds.js";

const VOICE_BAR_COUNT = 40;
const MIN_VOICE_MS = 800;
// mic চেপে ধরা (hold-to-record): কত ms ধরলে hold ধরা হবে, আর কতটা swipe করলে কী হবে
const HOLD_DELAY_MS = 260;
const HOLD_DELETE_PX = 96; // বামে এতটা টানলে ছাড়লে delete
const HOLD_PAUSE_UP_PX = 56; // উপরে এতটা টানলেই pause (mic ডান কিনারায় থাকে, তাই ডানে নয়, উপরে)
const HOLD_SLOP_PX = 14; // hold শুরুর আগে এর বেশি নড়লে hold বাতিল

function formatRecTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const sec = totalSeconds % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
}

// কম্পোজার বার (টেক্সট ইনপুট + ভয়েস রেকর্ডিং UI)। রেকর্ডিংয়ের সব state (recPhase, holdMode, holdArm,
// recordingSeconds...) এখানেই থাকে, তাই এগুলো বদলালে শুধু এই ছোট কম্পোনেন্ট re-render হয় —
// ChatPage-এর মেসেজ লিস্ট/সাইডবার নয়।
export default function ChatComposer({
    canSendInActive,
    activeConversationId,
    replyingTo,
    activeIsGroup,
    draftText,
    composerInputRef,
    typingStopTimerRef,
    isTypingSentRef,
    voiceApiRef,
    showAttachSheet,
    setShowAttachSheet,
    setComposerError,
    setShowMicrophoneHelp,
    setShowCreatePoll,
    onTypingChange,
    onSendText,
    onFilesSelected,
    onSendLocation,
    onSendContact
}) {
    const dispatch = useDispatch();
    const uploadingMedia = false; // আপলোড এখন composer আটকায় না: ইউজার লিখতে/পাঠাতে থাকতে পারে

    // recPhase: "idle" | "recording" | "paused" | "discarding"
    const [recPhase, setRecPhase] = useState("idle");
    const [recordingSeconds, setRecordingSeconds] = useState(0);
    const isRecording = recPhase !== "idle";
    // hold-to-record: আঙুল mic-এ থাকা অবস্থায় true; holdArm = বাম swipe-এ delete প্রস্তুত কিনা
    const [holdMode, setHoldMode] = useState(false);
    const [holdArm, setHoldArm] = useState(null);
    const [pausedFromHold, setPausedFromHold] = useState(false);
    const holdRef = useRef({
        active: false,
        pointerId: null,
        startX: 0,
        startY: 0,
        dx: 0,
        started: false,
        released: false,
        done: false,
        timer: 0
    });
    const composerBarRef = useRef(null);
    const recStartingRef = useRef(false);
    const voiceActionsRef = useRef({});
    const mediaRecorderRef = useRef(null);
    const audioChunksRef = useRef([]);
    const recordTimerRef = useRef(null);
    const recStreamRef = useRef(null);
    const recAudioCtxRef = useRef(null);
    const recAnalyserRef = useRef(null);
    const recRafRef = useRef(0);
    const recDiscardRef = useRef(false);
    const recElapsedRef = useRef(0);
    const recLastTickRef = useRef(0);
    const recLevelsRef = useRef(new Array(VOICE_BAR_COUNT).fill(0.08));
    const recBarsRef = useRef([]);
    const recDiscardTimerRef = useRef(null);
    const recContextRef = useRef({ conversationId: null, replyingTo: null });

    // লেখা বাড়লে ইনপুট বক্স নিজে থেকে উঁচু হয় (সর্বোচ্চ ~5 লাইন), তারপর ভেতরে স্ক্রল
    useEffect(() => {
        const el = composerInputRef.current;
        if (!el) return;
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
    }, [draftText, isRecording, activeConversationId]);

    // ভয়েস রেকর্ড চলার সময় অন্যপাশে "recording audio..." দেখাতে হার্টবিট পাঠানো হয়
    // (receiver ৪.৫ সেকেন্ড পর নিজে থেকে মুছে ফেলে, তাই ২.৫ সেকেন্ড পরপর নতুন করে পাঠাই)
    useEffect(() => {
        if (recPhase !== "recording" || !activeConversationId) return undefined;
        const convId = activeConversationId;
        if (typingStopTimerRef.current) {
            clearTimeout(typingStopTimerRef.current);
            typingStopTimerRef.current = null;
        }
        isTypingSentRef.current = false;
        emitTypingStart(convId, "recording");
        const timer = setInterval(
            () => emitTypingStart(convId, "recording"),
            2500
        );
        return () => {
            clearInterval(timer);
            emitTypingStop(convId);
        };
    }, [recPhase, activeConversationId]);

    // ---- Voice recording: record → (pause / resume) → Send or Delete ----

    const paintWaveform = () => {
        const bars = recBarsRef.current;
        const levels = recLevelsRef.current;
        for (let i = 0; i < bars.length; i += 1) {
            const el = bars[i];
            if (el) el.style.transform = `scaleY(${Math.max(0.08, levels[i] || 0.08)})`;
        }
    };

    const teardownRecordingResources = () => {
        cancelAnimationFrame(recRafRef.current);
        recRafRef.current = 0;
        clearInterval(recordTimerRef.current);
        recordTimerRef.current = null;
        recStreamRef.current?.getTracks().forEach(track => track.stop());
        recStreamRef.current = null;
        recAnalyserRef.current = null;
        // শেয়ার্ড AudioContext বন্ধ করা যাবে না (এটা দিয়েই সাউন্ড বাজে) — শুধু মাইকের source খুলে দেওয়া হয়
        const source = recAudioCtxRef.current;
        recAudioCtxRef.current = null;
        try { source?.disconnect(); } catch { /* already disconnected */ }
    };

    const startWaveform = stream => {
        recLevelsRef.current = new Array(VOICE_BAR_COUNT).fill(0.08);
        paintWaveform();
        try {
            // আলাদা AudioContext না বানিয়ে সাউন্ডের শেয়ার্ড context-ই ব্যবহার হয়:
            // দুটো context একসাথে চললে মোবাইলে রেকর্ডিংয়ের সময় সাউন্ড কেটে যায়/বাজে না
            const ctx = getSharedAudioContext();
            if (ctx) {
                const analyser = ctx.createAnalyser();
                analyser.fftSize = 512;
                const source = ctx.createMediaStreamSource(stream);
                source.connect(analyser);
                recAudioCtxRef.current = source;
                recAnalyserRef.current = analyser;
            }
        } catch {
            recAnalyserRef.current = null;
        }

        const buffer = new Uint8Array(512);
        let lastPush = 0;
        const loop = now => {
            recRafRef.current = requestAnimationFrame(loop);
            const recorder = mediaRecorderRef.current;
            if (!recorder || recorder.state !== "recording") return;
            if (now - lastPush < 70) return;
            lastPush = now;

            let level;
            const analyser = recAnalyserRef.current;
            if (analyser) {
                analyser.getByteTimeDomainData(buffer);
                let sum = 0;
                for (let i = 0; i < buffer.length; i += 1) {
                    const v = (buffer[i] - 128) / 128;
                    sum += v * v;
                }
                level = Math.min(1, Math.sqrt(sum / buffer.length) * 4.2);
            } else {
                level = 0.2 + Math.random() * 0.5;
            }
            const levels = recLevelsRef.current;
            levels.push(level);
            levels.shift();
            paintWaveform();
        };
        recRafRef.current = requestAnimationFrame(loop);
    };

    // ভয়েস মেসেজও background queue দিয়ে যায় (নেট গেলে নিজে অপেক্ষা করে আবার পাঠায়)
    const uploadAndSendVoice = (audioFile, conversationId, replyTarget) => {
        enqueueMediaMessage({
            file: audioFile,
            conversationId,
            replyToMessage: replyTarget,
            purpose: "voice",
            type: "audio"
        });
        if (replyTarget) {
            dispatch(setReplyTo({ conversationId, message: null }));
        }
    };

    const startVoiceRecording = async opts => {
        if (recPhase !== "idle") return false;
        // getUserMedia requires HTTPS (or localhost) and a user gesture.
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
            setComposerError(
                "Microphone access requires a secure HTTPS connection. Open Sync using its HTTPS address and try again."
            );
            return false;
        }
        if (typeof window.MediaRecorder === "undefined") {
            setComposerError("Voice recording is not supported by this browser.");
            return false;
        }

        // টাচ + ক্লিক একসাথে এলেও দুটো রেকর্ডার যেন না চলে
        if (recStartingRef.current) return false;
        recStartingRef.current = true;
        // রেকর্ডার চালুর আগেই বাজে, যাতে শব্দটা রেকর্ডিংয়ে না ঢোকে
        // mic বাটনে আঙুল পড়ার মুহূর্তেই সাউন্ড বেজে গেছে (handleMicPointerDown) — না হলে (অন্য বাটন) এখানে বাজে
        if (!opts?.soundPlayed) playSound("recStart");

        setComposerError("");
        setShowMicrophoneHelp(false);
        let stream;
        try {
            // Calling this directly from the microphone button opens the
            // browser's native Allow / Block permission prompt when needed.
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            const mimeType = [
                "audio/webm;codecs=opus",
                "audio/webm",
                "audio/mp4"
            ].find(type => MediaRecorder.isTypeSupported?.(type));
            const recorder = new MediaRecorder(
                stream,
                mimeType ? { mimeType } : undefined
            );
            const recordingType = recorder.mimeType || mimeType || "audio/webm";
            audioChunksRef.current = [];
            recDiscardRef.current = false;
            recElapsedRef.current = 0;
            clearTimeout(recDiscardTimerRef.current);
            recContextRef.current = {
                conversationId: activeConversationId,
                replyingTo
            };

            recorder.ondataavailable = evt => {
                if (evt.data.size > 0) audioChunksRef.current.push(evt.data);
            };

            recorder.onerror = () => {
                teardownRecordingResources();
                recDiscardRef.current = true;
                setRecPhase("idle");
                setRecordingSeconds(0);
                setComposerError("The microphone recording could not be started. Please try again.");
            };

            recorder.onstop = () => {
                // a stale recorder must not tear down a newer recording
                if (mediaRecorderRef.current === recorder) {
                    teardownRecordingResources();
                }
                const discarded = recDiscardRef.current;
                const chunks = audioChunksRef.current;
                audioChunksRef.current = [];
                if (discarded || chunks.length === 0) return;

                setRecPhase("idle");
                setRecordingSeconds(0);

                const blob = new Blob(chunks, { type: recordingType });
                const extension = recordingType.includes("mp4") ? "m4a" : "webm";
                const audioFile = new File(
                    [blob],
                    `voice_${Date.now()}.${extension}`,
                    { type: recordingType }
                );
                const { conversationId, replyingTo: replyTarget } =
                    recContextRef.current;
                uploadAndSendVoice(audioFile, conversationId, replyTarget);
            };

            mediaRecorderRef.current = recorder;
            recStreamRef.current = stream;
            recorder.start();
            startWaveform(stream);
            setRecPhase("recording");
            setRecordingSeconds(0);
            recLastTickRef.current = Date.now();
            recordTimerRef.current = setInterval(() => {
                const now = Date.now();
                if (mediaRecorderRef.current?.state === "recording") {
                    recElapsedRef.current += now - recLastTickRef.current;
                    setRecordingSeconds(Math.floor(recElapsedRef.current / 1000));
                }
                recLastTickRef.current = now;
            }, 200);
            recStartingRef.current = false;
            return true;
        } catch (err) {
            recStartingRef.current = false;
            stream?.getTracks().forEach(track => track.stop());
            teardownRecordingResources();
            const messages = {
                NotAllowedError: "Please allow microphone access in your browser to record a voice message.",
                PermissionDeniedError: "Please allow microphone access in your browser to record a voice message.",
                NotFoundError: "No microphone was found on this device.",
                NotReadableError: "The microphone is already in use by another app."
            };
            if (
                err?.name === "NotAllowedError" ||
                err?.name === "PermissionDeniedError" ||
                err?.name === "SecurityError"
            ) {
                setShowMicrophoneHelp(true);
            } else {
                setComposerError(
                    messages[err?.name] ||
                    err?.message ||
                    "Could not access the microphone. Check your browser permissions and try again."
                );
            }
            return false;
        }
    };

    const togglePauseVoiceRecording = () => {
        const recorder = mediaRecorderRef.current;
        if (!recorder) return;
        if (recorder.state === "recording") {
            // সাউন্ড সবার আগে: recorder.pause() ও state আপডেটের ভারী কাজ সাউন্ডকে দেরি করাবে না
            playSound("recPause");
            recElapsedRef.current += Date.now() - recLastTickRef.current;
            recorder.pause();
            setRecPhase("paused");
        } else if (recorder.state === "paused") {
            // সাউন্ড আগে বাজে, তারপর একটু পরে resume — তাই শব্দ রেকর্ডিংয়ে ঢোকে না
            playSound("recPlay");
            setTimeout(() => {
                if (recorder.state !== "paused") return;
                recLastTickRef.current = Date.now();
                recorder.resume();
                resumeAudio();
                setRecPhase("recording");
            }, 300);
        }
    };

    // Delete: throw the recording away with a short exit animation.
    const discardVoiceRecording = (silent = false) => {
        // সাউন্ড সবার আগে: recorder.stop() আর মাইক ছাড়তে ফোনে সময় লাগে, তার আগেই শব্দ বাজবে
        if (!silent) playSound("recDelete");
        const recorder = mediaRecorderRef.current;
        recDiscardRef.current = true;
        audioChunksRef.current = [];
        if (recorder && recorder.state !== "inactive") {
            try { recorder.stop(); } catch { /* already stopped */ }
        }
        teardownRecordingResources();
        clearTimeout(recDiscardTimerRef.current);
        if (silent) {
            setRecPhase("idle");
            setRecordingSeconds(0);
            return;
        }
        setRecPhase("discarding");
        recDiscardTimerRef.current = setTimeout(() => {
            setRecPhase("idle");
            setRecordingSeconds(0);
        }, 460);
    };

    // Send: only now the voice message is uploaded and delivered.
    const sendVoiceRecording = () => {
        const recorder = mediaRecorderRef.current;
        if (!recorder || recorder.state === "inactive") return;
        if (recPhase === "recording") {
            recElapsedRef.current += Date.now() - recLastTickRef.current;
        }
        if (recElapsedRef.current < MIN_VOICE_MS) {
            discardVoiceRecording();
            setComposerError("Voice message is too short. Hold on a little longer.");
            return;
        }
        recDiscardRef.current = false;
        recorder.stop();
    };

    // ---- Hold-to-record: mic চেপে ধরলে রেকর্ড · ছাড়লে send · বামে swipe = delete · উপরে swipe = pause ----
    // (ছোট টাচ/ক্লিক আগের মতই locked রেকর্ডিং চালু করে: delete · pause/play · send বাটনসহ)
    voiceActionsRef.current = {
        start: startVoiceRecording,
        send: sendVoiceRecording,
        discard: discardVoiceRecording,
        togglePause: togglePauseVoiceRecording
    };

    const buzz = ms => {
        try {
            navigator.vibrate?.(ms);
        } catch {
            /* সব ডিভাইসে নেই */
        }
    };

    // swipe-এর দূরত্ব CSS variable-এ বসে (re-render ছাড়া, তাই লাগে না)
    const setHoldVisual = (dx, dy = 0) => {
        const bar = composerBarRef.current;
        if (!bar) return;
        const clamped = Math.max(-150, Math.min(30, dx));
        bar.style.setProperty("--hold-dx", `${clamped}px`);
        bar.style.setProperty(
            "--hold-dy",
            `${Math.max(-90, Math.min(0, dy))}px`
        );
        bar.style.setProperty(
            "--hold-p",
            String(Math.min(1, Math.max(0, -dx / HOLD_DELETE_PX)))
        );
    };

    const beginHoldRecording = async () => {
        const h = holdRef.current;
        h.timer = 0;
        if (!h.active || h.done) return;
        h.started = true;
        h.dx = 0;
        setHoldVisual(0);
        setHoldArm(null);
        setHoldMode(true);
        buzz(12);
        const ok = await voiceActionsRef.current.start({ soundPlayed: true });
        if (!ok) {
            h.active = false;
            h.done = true;
            setHoldMode(false);
            return;
        }
        if (h.released || !h.active) {
            // মাইক চালু হওয়ার আগেই (যেমন পারমিশন প্রম্পটে) আঙুল উঠে গেছে → locked রেকর্ডিং হয়ে চলবে
            h.done = true;
            setHoldMode(false);
        }
    };

    const handleMicPointerDown = e => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        if (recPhase !== "idle" || uploadingMedia) return;
        const h = holdRef.current;
        clearTimeout(h.timer);
        Object.assign(h, {
            active: true,
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            dx: 0,
            started: false,
            released: false,
            done: false
        });
        try {
            e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
            /* ignore */
        }
        // সাউন্ড আঙুল পড়ার মুহূর্তেই — hold-টাইমার ও ভারী re-render-এর অপেক্ষা না করে (ফোনে সেটা ~০.৫–১ সেকেন্ড লাগছিল)
        playSound("recStart");
        h.timer = setTimeout(beginHoldRecording, HOLD_DELAY_MS);
    };

    const handleMicPointerMove = e => {
        const h = holdRef.current;
        if (!h.active || e.pointerId !== h.pointerId) return;
        const dx = e.clientX - h.startX;

        if (!h.started) {
            // hold শুরুর আগেই বেশি নড়লে এটা hold নয়, বাতিল
            if (
                Math.abs(dx) > HOLD_SLOP_PX ||
                Math.abs(e.clientY - h.startY) > HOLD_SLOP_PX
            ) {
                clearTimeout(h.timer);
                h.timer = 0;
                h.active = false;
            }
            return;
        }
        if (h.done) return;

        const dy = e.clientY - h.startY;
        h.dx = dx;
        setHoldVisual(dx, dy);

        // উপরে swipe → সাথে সাথে pause, তারপর locked প্যানেল (delete · play · send)
        if (dy <= -HOLD_PAUSE_UP_PX && Math.abs(dy) > Math.abs(dx) * 0.8) {
            if (mediaRecorderRef.current?.state === "recording") {
                h.done = true;
                buzz(14);
                voiceActionsRef.current.togglePause();
                setPausedFromHold(true);
                setHoldMode(false);
                setHoldArm(null);
                setHoldVisual(0, 0);
            }
            return;
        }

        // বামে যথেষ্ট টানলে delete "প্রস্তুত" (ছাড়লে মুছে যাবে), ফিরিয়ে আনলে বাতিল
        const arm = dx <= -HOLD_DELETE_PX ? "delete" : null;
        setHoldArm(prev => {
            if (prev !== arm && arm) buzz(10);
            return prev === arm ? prev : arm;
        });
    };

    const handleMicPointerUp = e => {
        const h = holdRef.current;
        if (!h.active || e.pointerId !== h.pointerId) return;
        clearTimeout(h.timer);
        h.timer = 0;
        h.active = false;
        h.released = true;
        try {
            e.currentTarget.releasePointerCapture?.(e.pointerId);
        } catch {
            /* ignore */
        }

        // hold হওয়ার আগেই ছেড়ে দিয়েছে = সাধারণ টাচ → locked রেকর্ডিং
        if (!h.started) {
            voiceActionsRef.current.start({ soundPlayed: true });
            return;
        }
        if (h.done) return;
        const rec = mediaRecorderRef.current;
        // মাইক এখনও চালু হচ্ছে: beginHoldRecording নিজে locked রেকর্ডিংয়ে পাল্টে দেবে
        if (!rec || rec.state === "inactive") return;

        h.done = true;
        if (h.dx <= -HOLD_DELETE_PX) {
            voiceActionsRef.current.discard();
        } else {
            voiceActionsRef.current.send();
        }
    };

    // ব্রাউজার/সিস্টেম টাচ কেড়ে নিলে রেকর্ডিং হারাবে না, locked রেকর্ডিং হয়ে চলবে
    const handleMicPointerCancel = e => {
        const h = holdRef.current;
        if (!h.active || e.pointerId !== h.pointerId) return;
        clearTimeout(h.timer);
        h.timer = 0;
        h.active = false;
        h.released = true;
        if (h.started && !h.done) {
            h.done = true;
            setHoldMode(false);
            setHoldArm(null);
            setHoldVisual(0);
        }
    };

    // রেকর্ডিং শেষ (send/delete) হলে hold-সংক্রান্ত সব কিছু পরিষ্কার
    useEffect(() => {
        if (recPhase !== "idle") return;
        setHoldMode(false);
        setHoldArm(null);
        setPausedFromHold(false);
        const bar = composerBarRef.current;
        bar?.style.removeProperty("--hold-dx");
        bar?.style.removeProperty("--hold-dy");
        bar?.style.removeProperty("--hold-p");
    }, [recPhase]);

    useEffect(() => () => clearTimeout(holdRef.current.timer), []);

    // Leaving the chat (or switching conversation) while recording cancels it.
    useEffect(() => {
        return () => {
            if (mediaRecorderRef.current?.state && mediaRecorderRef.current.state !== "inactive") {
                recDiscardRef.current = true;
                try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
            }
            teardownRecordingResources();
            clearTimeout(recDiscardTimerRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (
            recContextRef.current.conversationId &&
            String(recContextRef.current.conversationId) !== String(activeConversationId) &&
            mediaRecorderRef.current?.state &&
            mediaRecorderRef.current.state !== "inactive"
        ) {
            discardVoiceRecording(true);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeConversationId]);

    // ChatPage-এর "Try Again" বোতাম এটা দিয়ে রেকর্ডিং চালু করে
    voiceApiRef.current = { start: startVoiceRecording };

    return (
        <>
            {canSendInActive && (
                <form
                    ref={composerBarRef}
                    className={`sync-composer-bar ${
                        isRecording && holdMode
                            ? "is-holding"
                            : ""
                    }`}
                    onSubmit={onSendText}
                >
                    {recPhase === "idle" && (
                        <>
                            <button
                                type="button"
                                className={`sync-icon-btn ${
                                    showAttachSheet
                                        ? "active"
                                        : ""
                                }`}
                                title="Attach"
                                aria-label="Attach"
                                aria-expanded={showAttachSheet}
                                onClick={() =>
                                    setShowAttachSheet(v => !v)
                                }
                                disabled={uploadingMedia}
                            >
                                <Paperclip size={20} />
                            </button>
                            {activeIsGroup && (
                                <button
                                    type="button"
                                    className="sync-icon-btn sync-poll-trigger"
                                    title="Create Poll"
                                    aria-label="Create Poll"
                                    onClick={() =>
                                        setShowCreatePoll(true)
                                    }
                                >
                                    <PollIcon size={21} />
                                </button>
                            )}
                        </>
                    )}

                    {isRecording && holdMode ? (
                        <div
                            className={`sync-voice-hold ${
                                holdArm === "delete"
                                    ? "arm-delete"
                                    : ""
                            } ${
                                recPhase === "discarding"
                                    ? "discarding"
                                    : ""
                            }`}
                            role="group"
                            aria-label="Recording voice message"
                        >
                            <span className="sync-hold-trash">
                                <VoiceTrash
                                    size={18}
                                    open={
                                        holdArm === "delete" ||
                                        recPhase === "discarding"
                                    }
                                    shake={recPhase === "discarding"}
                                />
                            </span>
                            <span className="rec-dot" />
                            <span
                                className="sync-voice-time"
                                aria-live="off"
                            >
                                {formatRecTime(recordingSeconds)}
                            </span>
                            <div
                                className="sync-hold-hint"
                                aria-hidden="true"
                            >
                                <ChevronLeft size={16} />
                                <span>
                                    {holdArm === "delete"
                                        ? "Release to delete"
                                        : "Slide to delete"}
                                </span>
                            </div>
                            <span
                                className="sync-hold-pause-hint"
                                aria-hidden="true"
                            >
                                <Pause size={12} />
                                <ChevronUp size={14} />
                            </span>
                        </div>
                    ) : isRecording ? (
                        <div
                            className={`sync-voice-rec ${recPhase} ${
                                pausedFromHold ? "from-hold" : ""
                            }`}
                            role="group"
                            aria-label="Voice message recorder"
                        >
                            <button
                                type="button"
                                className="sync-voice-btn delete"
                                title="Delete recording"
                                aria-label="Delete recording"
                                onClick={() => discardVoiceRecording()}
                                disabled={recPhase === "discarding"}
                            >
                                <VoiceTrash
                                    size={20}
                                    open={recPhase === "discarding"}
                                />
                            </button>

                            <div className="sync-voice-panel">
                                <span className="rec-dot" />
                                <span
                                    className="sync-voice-time"
                                    aria-live="off"
                                >
                                    {formatRecTime(recordingSeconds)}
                                </span>
                                <div
                                    className="sync-voice-wave"
                                    aria-hidden="true"
                                >
                                    {Array.from(
                                        { length: VOICE_BAR_COUNT },
                                        (_, i) => (
                                            <span
                                                key={i}
                                                ref={el => {
                                                    recBarsRef.current[i] = el;
                                                }}
                                            />
                                        )
                                    )}
                                </div>
                            </div>

                            <button
                                type="button"
                                className="sync-voice-btn pause"
                                title={
                                    recPhase === "paused"
                                        ? "Resume recording"
                                        : "Pause recording"
                                }
                                aria-label={
                                    recPhase === "paused"
                                        ? "Resume recording"
                                        : "Pause recording"
                                }
                                onClick={togglePauseVoiceRecording}
                                disabled={recPhase === "discarding"}
                            >
                                {recPhase === "paused" ? (
                                    <Play key="play" size={19} />
                                ) : (
                                    <Pause key="pause" size={19} />
                                )}
                            </button>

                            <button
                                type="button"
                                className="sync-send-btn sync-voice-send"
                                title="Send voice message"
                                aria-label="Send voice message"
                                onClick={sendVoiceRecording}
                                disabled={recPhase === "discarding"}
                            >
                                <Send size={18} />
                            </button>
                        </div>
                    ) : (
                        <textarea
                            ref={composerInputRef}
                            rows={1}
                            className="sync-composer-input"
                            placeholder="Type a message..."
                            maxLength={4000}
                            value={draftText}
                            onChange={e =>
                                onTypingChange(
                                    e.target.value
                                )
                            }
                            onKeyDown={e => {
                                // কম্পিউটারে Enter = পাঠানো, Shift+Enter = নতুন লাইন। ফোনে Enter নতুন লাইন, পাঠাতে বাটন।
                                if (
                                    e.key === "Enter" &&
                                    !e.shiftKey &&
                                    !e.nativeEvent.isComposing &&
                                    window.matchMedia(
                                        "(pointer: fine)"
                                    ).matches
                                ) {
                                    e.preventDefault();
                                    onSendText(e);
                                }
                            }}
                        />
                    )}

                    {(!isRecording || holdMode) &&
                        (!draftText.trim() ? (
                            <button
                                type="button"
                                className={`sync-icon-btn sync-mic-btn ${
                                    isRecording && holdMode
                                        ? "is-holding"
                                        : ""
                                } ${
                                    holdArm === "delete"
                                        ? "arm-delete"
                                        : ""
                                } ${
                                    isRecording &&
                                    holdMode &&
                                    recPhase === "discarding"
                                        ? "is-discarding"
                                        : ""
                                }`}
                                title="Tap to record · hold to record and release to send"
                                aria-label="Record voice message"
                                onPointerDown={handleMicPointerDown}
                                onPointerMove={handleMicPointerMove}
                                onPointerUp={handleMicPointerUp}
                                onPointerCancel={handleMicPointerCancel}
                                onContextMenu={e => e.preventDefault()}
                                onClick={e => {
                                    // কিবোর্ড (Enter/Space) থেকে এলে detail === 0; টাচ/মাউস pointer হ্যান্ডলারে সামলানো
                                    if (e.detail === 0) startVoiceRecording();
                                }}
                                disabled={uploadingMedia}
                            >
                                <Mic size={20} />
                            </button>
                        ) : (
                            <button
                                type="submit"
                                className="sync-send-btn"
                                title="Send Message"
                                onPointerDown={event => event.preventDefault()}
                            >
                                <Send size={18} />
                            </button>
                        ))}
                </form>
            )}

            <AttachmentSheet
                open={showAttachSheet && canSendInActive && !isRecording}
                disabled={uploadingMedia || !canSendInActive}
                onClose={() => setShowAttachSheet(false)}
                onFilesSelected={onFilesSelected}
                onSendLocation={onSendLocation}
                onSendContact={onSendContact}
            />
        </>
    );
}
