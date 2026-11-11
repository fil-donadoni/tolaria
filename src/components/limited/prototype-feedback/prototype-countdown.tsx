// PROTOTYPE — throwaway (player-feedback 2026-11, `pv-countdown`). Never merge.
// Mounted once in the Draft Room: draws the two OVERLAY variants (A, C) and
// the flip-open of variant B (whose face-down pack itself replaces the pack
// grid inside `limited-draft-table.tsx`).
import { useEffect, useRef, useState } from "react";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import { usePrototypeVariant } from "~/components/prototype/prototype-switcher";
import { usePrototypeCountdownSeconds } from "./prototypeCountdownStore";
import PrototypeCountdownFullscreen from "./prototype-countdown-fullscreen";
import PrototypeCountdownTableIntro from "./prototype-countdown-table-intro";

const FLIP_MS = 1500;
// One rule per tile position: a staggered flip-open, rarest card first.
const FLIP_CSS = `
@keyframes prototype-flip-open {
    from { transform: perspective(900px) rotateY(90deg); opacity: 0.2; }
    to { transform: perspective(900px) rotateY(0deg); opacity: 1; }
}
[data-slot="draft-pack-grid"] > li { animation: prototype-flip-open 0.45s ease-out both; }
${Array.from({ length: 20 }, (_, i) => `[data-slot="draft-pack-grid"] > li:nth-child(${i + 1}) { animation-delay: ${i * 45}ms; }`).join("\n")}
`;

export default function PrototypeCountdown({
    event,
    round,
}: {
    event: LimitedEventView;
    round: number;
}) {
    const variant = usePrototypeVariant("pv-countdown");
    const seconds = usePrototypeCountdownSeconds();
    const wasCounting = useRef(false);
    const [flipping, setFlipping] = useState(false);
    useEffect(() => {
        const ended = wasCounting.current && seconds === null;
        wasCounting.current = seconds !== null;
        if (!ended || variant !== "B") return;
        setFlipping(true);
        const id = setTimeout(() => setFlipping(false), FLIP_MS);
        return () => clearTimeout(id);
    }, [seconds, variant]);

    if (variant === null) return null;
    if (flipping) return <style>{FLIP_CSS}</style>;
    if (seconds === null) return null;
    if (variant === "A")
        return (
            <PrototypeCountdownFullscreen
                seconds={seconds}
                round={round}
                totalRounds={event.packSlots.length}
            />
        );
    if (variant === "C")
        return (
            <PrototypeCountdownTableIntro
                seconds={seconds}
                event={event}
                round={round}
            />
        );
    return null;
}
