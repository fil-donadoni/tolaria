// PROTOTYPE — throwaway (player-feedback 2026-11, `pv-countdown=A`). Never merge.
// Variant A: the whole room is covered; one huge number, the pack's name and
// three tips a first-time drafter needs before the clock starts.
import {
    PROTOTYPE_TICK_CSS,
    skipPrototypeCountdown,
} from "./prototypeCountdownStore";

const TIPS = [
    "Click a card to select it. Double-click (or drag it to your pool) to pick it.",
    "Every pick is timed. If the clock runs out, your selected card is taken for you.",
    "After each pick the rest of the pack passes to the next seat — you won't see it again soon.",
];

export default function PrototypeCountdownFullscreen({
    seconds,
    round,
    totalRounds,
}: {
    seconds: number;
    round: number;
    totalRounds: number;
}) {
    return (
        <div
            data-prototype="countdown-fullscreen"
            role="dialog"
            aria-label="Draft starting"
            className="fixed inset-0 z-[1000] flex flex-col items-center justify-center gap-6 bg-surface-base/95 p-6 text-center text-text backdrop-blur-md"
        >
            <style>{PROTOTYPE_TICK_CSS}</style>
            <p className="text-sm tracking-[0.3em] text-text-muted uppercase">
                Pack {round + 1} of {totalRounds} — get ready
            </p>
            <div
                key={seconds}
                role="timer"
                className="text-[min(40vh,16rem)] leading-none font-bold text-accent-strong tabular-nums"
                style={{ animation: "prototype-count-tick 0.4s ease-out" }}
            >
                {seconds}
            </div>
            <ul className="flex max-w-xl flex-col gap-3 text-left text-base">
                {TIPS.map((tip, i) => (
                    <li key={tip} className="flex gap-3">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border-accent/50 text-sm font-semibold text-accent-strong">
                            {i + 1}
                        </span>
                        <span>{tip}</span>
                    </li>
                ))}
            </ul>
            <button
                type="button"
                onClick={skipPrototypeCountdown}
                className="rounded-sm border border-border-accent/40 px-4 py-2 text-sm tracking-wide text-text-muted uppercase transition-colors hover:text-parchment"
            >
                I'm ready — start now
            </button>
        </div>
    );
}
