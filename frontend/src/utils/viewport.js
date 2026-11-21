// Keep the app height aligned with the actual visible WebView area.
// Some Android WebViews report a temporarily undersized visualViewport.height
// while the IME is animating or after a textarea submit. Prefer the larger
// layout viewport in that case so the chat stage does not collapse vertically.
const root = typeof document !== "undefined" ? document.documentElement : null;
let raf = 0;

function measure() {
    if (!root || typeof window === "undefined") return;

    const layoutHeight = window.innerHeight || 0;
    const visualHeight = window.visualViewport?.height || 0;
    const height = Math.round(Math.max(layoutHeight, visualHeight));

    if (height > 0) root.style.setProperty("--app-h", `${height}px`);
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
