import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { FLIP_ANIM_MS } from "~/lib/random-reveal-pacing";
import Coin3D from "~/components/board/coin-3d";

export { FLIP_ANIM_MS };

/** One tossed coin (CR 705.2 / ADR 0023): toss, land on `face`, then show the
 *  halo (`tone`) and the `caption` under the coin — the coin itself never
 *  carries the outcome. `onLanded` fires exactly once when the toss ends.
 *  `skipped` (the overlay's click-to-end) jumps straight to the landed state.
 *  The toss lasts `durationMs` (a Flip Sequence tosses faster each round,
 *  `tossMs`); the overlay remounts the coin per round. Under
 *  `prefers-reduced-motion` there is no toss or spin: the face fades in and the
 *  same `durationMs` pacing elapses before `onLanded`. Pure presentation; the
 *  outcome is decided server-side. */
export default function CoinFlipAnimation({
    face,
    tone,
    caption,
    durationMs = FLIP_ANIM_MS,
    skipped = false,
    onLanded,
}: {
    face: "heads" | "tails";
    tone: "good" | "bad";
    caption: string;
    durationMs?: number;
    skipped?: boolean;
    onLanded: () => void;
}) {
    const reduceMotion = useReducedMotion() ?? false;
    const [tossEnded, setTossEnded] = useState(false);
    const landed = tossEnded || skipped;
    const fired = useRef(false);

    useEffect(() => {
        const t = setTimeout(() => setTossEnded(true), durationMs);
        return () => clearTimeout(t);
    }, [durationMs]);

    // Fires exactly once, whether the toss elapsed or the click skipped it.
    useEffect(() => {
        if (!landed || fired.current) return;
        fired.current = true;
        onLanded();
    }, [landed, onLanded]);

    return (
        <div className="flex flex-col items-center gap-3">
            <Coin3D
                face={face}
                phase={landed ? "landed" : "tossing"}
                durationMs={durationMs}
                tone={tone}
                reduceMotion={reduceMotion}
            />
            <p
                data-testid="coin-caption"
                data-tone={tone}
                className={`min-h-5 pt-2 text-sm font-semibold ${
                    tone === "good" ? "text-success-strong" : "text-danger"
                }`}
            >
                {landed ? caption : ""}
            </p>
        </div>
    );
}
