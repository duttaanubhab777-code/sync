// স্ক্রিনের আসল উচ্চতা CSS variable (--app-h) এ রাখে।
// কেন: পুরনো Android WebView (Chrome 108 এর আগে) `100dvh` বোঝে না, তখন পুরো অ্যাপের উচ্চতা ভেঙে যায় ও স্ক্রল করা যায় না।
// এছাড়া landscape ঘোরানো ও কীবোর্ড খোলা/বন্ধ হলেও উচ্চতা ঠিক থাকে।
const root = typeof document !== "undefined" ? document.documentElement : null;
let raf = 0;

function measure() {
    if (!root) return;
    const vv = window.visualViewport;
    const h = Math.round((vv && vv.height) || window.innerHeight || 0);
    if (h > 0) root.style.setProperty("--app-h", `${h}px`);
}

function schedule() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(measure);
}

export function initViewportHeight() {
    if (!root || typeof window === "undefined") return;
    measure();
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("pageshow", schedule, { passive: true });
    // ঘোরানোর সাথে সাথে ব্রাউজার পুরনো মাপ দেয়, তাই একটু পরে আবার মাপা হয়
    window.addEventListener(
        "orientationchange",
        () => {
            schedule();
            setTimeout(measure, 120);
            setTimeout(measure, 380);
        },
        { passive: true }
    );
    if (window.visualViewport) {
        window.visualViewport.addEventListener("resize", schedule, {
            passive: true
        });
    }
}
