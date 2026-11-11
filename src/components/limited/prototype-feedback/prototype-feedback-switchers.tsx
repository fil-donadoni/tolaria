// PROTOTYPE — throwaway (player-feedback 2026-11). Never merge.
//
// Three prototyped answers to a new player's Draft Room feedback, each on its
// own URL param, all on the existing `/limited/$eventId/draft` route:
//   ?pv-countdown=A|B|C  — a countdown before the first pick
//   ?pv-autopick=A|B|C   — last 5 s: highlight the card the clock will take
//   ?pv-zoom=A|B|C       — bigger default card size + a findable zoom control
// Extra: ?pv-urgent=1 forces the "last 5 s" state of pv-autopick.
import { useEffect, useRef } from "react";
import {
    PrototypeSwitcher,
    setPrototypeVariant,
    usePrototypeVariant,
} from "~/components/prototype/prototype-switcher";
import { startPrototypeCountdown } from "./prototypeCountdownStore";

const HELPER_STYLE: React.CSSProperties = {
    padding: "4px 10px",
    borderRadius: 999,
    background: "#ff00aa",
    color: "white",
    font: "600 12px/1.2 system-ui, sans-serif",
    boxShadow: "0 4px 16px rgba(0,0,0,.5)",
};

export default function PrototypeFeedbackSwitchers({
    firstPick,
}: {
    /** Pick 1 of pack 1 — the only moment the real countdown would run. */
    firstPick: boolean;
}) {
    const countdown = usePrototypeVariant("pv-countdown");
    const urgent = usePrototypeVariant("pv-urgent");
    // Runs on arrival at pick 1, and again whenever the variant is switched
    // (so flipping A → B → C replays it without touching the button).
    const mounted = useRef(false);
    useEffect(() => {
        const first = !mounted.current;
        mounted.current = true;
        if (countdown === null) return;
        if (first && !firstPick) return;
        startPrototypeCountdown();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [countdown]);

    if (!import.meta.env.DEV) return null;
    return (
        <>
            <PrototypeSwitcher
                title="Zoom"
                param="pv-zoom"
                slot={0}
                primary
                variants={[
                    { key: "A", label: "Toolbar −/+ by the timer" },
                    { key: "B", label: "Fit-all / Large / Read" },
                    { key: "C", label: "Hover-enlarge + ⌘wheel" },
                ]}
            />
            <PrototypeSwitcher
                title="Autopick"
                param="pv-autopick"
                slot={1}
                variants={[
                    { key: "A", label: "Badge + ring on the card" },
                    { key: "B", label: "Timer chip → card" },
                    { key: "C", label: "Dim the rest, lift the card" },
                ]}
            />
            <PrototypeSwitcher
                title="Countdown"
                param="pv-countdown"
                slot={2}
                variants={[
                    { key: "A", label: "Full-screen get ready" },
                    { key: "B", label: "Face-down pack" },
                    { key: "C", label: "Table intro" },
                ]}
            />
            <div
                style={{
                    position: "fixed",
                    left: 12,
                    bottom: 12 + 3 * 44,
                    zIndex: 2147483000,
                    display: "flex",
                    gap: 6,
                }}
            >
                <button
                    type="button"
                    style={{ ...HELPER_STYLE, opacity: countdown ? 1 : 0.5 }}
                    disabled={countdown === null}
                    onClick={() => startPrototypeCountdown()}
                >
                    ↻ Replay countdown
                </button>
                <button
                    type="button"
                    style={HELPER_STYLE}
                    aria-pressed={urgent !== null}
                    onClick={() =>
                        setPrototypeVariant("pv-urgent", urgent ? null : "1")
                    }
                >
                    Force last-5s: {urgent ? "ON" : "off"}
                </button>
            </div>
        </>
    );
}
