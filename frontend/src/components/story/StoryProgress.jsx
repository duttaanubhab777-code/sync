import React, {
    forwardRef,
    useImperativeHandle,
    useLayoutEffect,
    useRef
} from "react";

// স্টোরির উপরের প্রগ্রেস বার।
// প্রতি ফ্রেমে React re-render না করে, সরাসরি DOM-এ scaleX বসানো হয় → একদম মসৃণ (60fps)।
const StoryProgress = forwardRef(function StoryProgress(
    { count, index },
    ref
) {
    const fills = useRef([]);

    // স্টোরি বদলালে আগের সব inline প্রগ্রেস মুছে ফেলা (done/active ক্লাসই বাকিটা সামলায়)
    useLayoutEffect(() => {
        fills.current.forEach(el => {
            if (el) el.style.transform = "";
        });
    }, [index, count]);

    useImperativeHandle(
        ref,
        () => ({
            set(p) {
                const el = fills.current[index];
                if (el) {
                    const v = Math.max(0, Math.min(1, Number(p) || 0));
                    el.style.transform = `scaleX(${v})`;
                }
            }
        }),
        [index]
    );

    return (
        <div className="sync-story-progress-row" aria-hidden="true">
            {Array.from({ length: count }, (_, i) => (
                <div
                    key={i}
                    className={`sync-sv-seg ${
                        i < index ? "done" : i === index ? "active" : ""
                    }`}
                >
                    <i
                        ref={el => {
                            fills.current[i] = el;
                        }}
                    />
                </div>
            ))}
        </div>
    );
});

export default StoryProgress;
