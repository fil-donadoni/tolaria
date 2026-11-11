// PROTOTYPE — throwaway (player-feedback 2026-11, `pv-countdown=B`). Never merge.
// Variant B: nothing covers the room. The pack is dealt FACE-DOWN in the very
// grid it will occupy, a chip counts down, and at 0 the cards flip open in
// place (`prototype-countdown.tsx` plays the flip).
import { cardBase } from "~/lib/cardSizing";
import CardBack from "~/components/cards/card-back";
import {
    PROTOTYPE_TICK_CSS,
    skipPrototypeCountdown,
} from "./prototypeCountdownStore";

// Same base the real pack grid scales from (`limited-draft-pack.tsx`).
const CARD_BASE = cardBase("7.5rem", "17vw", "9dvh");

export default function PrototypeCountdownFaceDownPack({
    count,
    zoom,
    seconds,
}: {
    count: number;
    zoom: number;
    seconds: number;
}) {
    return (
        <div data-prototype="countdown-face-down" className="relative">
            <style>{PROTOTYPE_TICK_CSS}</style>
            <ul
                className="grid gap-3"
                style={{
                    gridTemplateColumns: `repeat(auto-fill, minmax(calc(${CARD_BASE} * ${zoom}), 1fr))`,
                }}
            >
                {Array.from({ length: count }, (_, i) => (
                    <li key={i} className="aspect-5/7 opacity-90">
                        <CardBack />
                    </li>
                ))}
            </ul>
            <div className="pointer-events-none absolute inset-x-0 top-6 flex justify-center">
                <button
                    type="button"
                    onClick={skipPrototypeCountdown}
                    className="pointer-events-auto flex items-center gap-3 rounded-full border border-border-accent/60 bg-surface-base/95 py-2 pr-5 pl-2 text-text shadow-2xl"
                >
                    <span
                        key={seconds}
                        role="timer"
                        className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-strong/20 text-2xl font-bold text-accent-strong tabular-nums"
                        style={{
                            animation: "prototype-count-tick 0.4s ease-out",
                        }}
                    >
                        {seconds}
                    </span>
                    <span className="text-left text-sm leading-tight">
                        <span className="block font-semibold">
                            Your pack opens in {seconds}s
                        </span>
                        <span className="block text-text-muted">
                            {count} cards · click to open now
                        </span>
                    </span>
                </button>
            </div>
        </div>
    );
}
