import React, { useEffect, useState } from "react";

const messages = [
    "Stay close. Stay in sync.",
    "Every conversation, connected.",
    "Make every moment count."
];

export default function BrandTyping() {
    const [messageIndex, setMessageIndex] = useState(0);
    const [visibleText, setVisibleText] = useState("");

    useEffect(() => {
        const currentMessage = messages[messageIndex];
        let characterIndex = 0;
        let deleting = false;
        let timer;

        const animate = () => {
            if (!deleting) {
                characterIndex += 1;
                setVisibleText(currentMessage.slice(0, characterIndex));

                if (characterIndex >= currentMessage.length) {
                    deleting = true;
                    timer = window.setTimeout(animate, 1500);
                    return;
                }
                timer = window.setTimeout(animate, 58);
                return;
            }

            characterIndex -= 1;
            setVisibleText(currentMessage.slice(0, characterIndex));

            if (characterIndex <= 0) {
                setMessageIndex(index => (index + 1) % messages.length);
                return;
            }
            timer = window.setTimeout(animate, 28);
        };

        timer = window.setTimeout(animate, 250);
        return () => window.clearTimeout(timer);
    }, [messageIndex]);

    return (
        <p className="sync-brand-typing" aria-live="off">
            <span>{visibleText}</span>
            <span className="sync-typing-caret" aria-hidden="true" />
        </p>
    );
}
