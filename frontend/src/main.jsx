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

// index.html এর boot splash: React mount হলে fade-out করে DOM থেকে সরিয়ে দেয়,
// না হলে position:fixed ওভারলে পুরো অ্যাপ ঢেকে রাখে।
const hideBootSplash = () => {
    const boot = document.getElementById("boot");
    if (!boot) return;
    boot.classList.add("is-gone");
    setTimeout(() => boot.remove(), 400);
};

requestAnimationFrame(() => requestAnimationFrame(hideBootSplash));
// নিরাপত্তা: কোনো কারণে উপরেরটা না চললেও ৩ সেকেন্ডে সরে যাবে
setTimeout(hideBootSplash, 3000);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("/service-worker.js").catch(error => {
            console.error("Sync service worker registration failed:", error);
        });
    });
}
