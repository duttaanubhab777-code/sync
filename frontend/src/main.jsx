import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { BrowserRouter } from "react-router-dom";
import { store } from "./store/index.js";
import App from "./App.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
        <Provider store={store}>
            <BrowserRouter>
                <App />
            </BrowserRouter>
        </Provider>
    </React.StrictMode>
);

// index.html এর boot splash (লোগো + অ্যানিমেশন)।
// - PWA ও Android অ্যাপ দুটোতেই অ্যাপ খোলার সময় অন্তত SPLASH_MIN_MS দেখায়
// - একই সেশনে (যেমন রিলোড) আবার দেখায় না, সরাসরি অ্যাপে যায়
// - React mount না হলেও position:fixed ওভারলে যেন আটকে না থাকে, তাই failsafe আছে
const SPLASH_MIN_MS = 2400;
const SPLASH_MAX_MS = 6000;
const SPLASH_KEY = "sync_splash_seen";

let splashSeen = false;
try {
    splashSeen = sessionStorage.getItem(SPLASH_KEY) === "1";
    sessionStorage.setItem(SPLASH_KEY, "1");
} catch {
    // storage বন্ধ থাকলে প্রতিবার splash দেখাবে, সমস্যা নেই
}

let splashHidden = false;
const hideBootSplash = () => {
    if (splashHidden) return;
    splashHidden = true;
    const boot = document.getElementById("boot");
    if (!boot) return;
    boot.classList.add("is-gone");
    setTimeout(() => boot.remove(), 600);
};

if (splashSeen) {
    requestAnimationFrame(() => requestAnimationFrame(hideBootSplash));
} else {
    // পেজ লোড শুরুর সময় থেকে গুনে মোট SPLASH_MIN_MS পূর্ণ করা
    const elapsed = typeof performance !== "undefined" ? performance.now() : 0;
    setTimeout(hideBootSplash, Math.max(0, SPLASH_MIN_MS - elapsed));
}
setTimeout(hideBootSplash, SPLASH_MAX_MS);
