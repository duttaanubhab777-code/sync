# Background upload + offline-safe sending

## নতুন ফাইল
- frontend/src/services/outbox.js — background queue (IndexedDB-তে ফাইল রাখে, অ্যাপ বন্ধ হলেও resume করে)
- frontend/src/hooks/useUploadQueue.js
- frontend/src/components/chat/UploadBubbleOverlay.jsx — বাবলের ওপর % / "Waiting for network…" / Retry
- frontend/src/components/chat/CompressingCard.jsx — ভিডিও compress কার্ড ("Send original")

## বদলানো ফাইল
- services/media.js — retry + resume, offline-এ অপেক্ষা, stall detect, বড় ফাইলে chunk upload, ভিডিও সীমা 100MB
- services/socket.js — ack timeout, অফলাইন queue ডিভাইসে সেভ, reconnect দ্রুত
- store/chatSlice.js — retry/remove reducer, চ্যাট রিফ্রেশে pending মেসেজ হারায় না, duplicate আটকানো
- pages/ChatPage.jsx — আপলোড এখন queue দিয়ে, composer আটকায় না
- components/AppLayout.jsx, hooks/useSignOut.js — outbox চালু/রিসেট
- components/UploadProgressCard.jsx — "waiting" অবস্থা
- styles/upload-card.css
- mobile/scripts/customize-android.sh — UploadKeepAliveService (foreground service) + permission
