// PROTOTYPE — throwaway (player-feedback 2026-11, `pv-autopick=C`). Never merge.
// Variant C: the last 5 s take the pack over — every other card dims, the one
// about to be taken lifts with a "WILL BE PICKED" strip, and a banner says how
// to override (click any card = the existing select gesture, which moves the
// target with it).
import {
    prototypeTileSelector,
    type PrototypeAutopickProps,
} from "./prototypeAutopickTarget";

export default function PrototypeAutopickTakeover({
    target,
    isSelection,
    seconds,
}: PrototypeAutopickProps) {
    const tile = target ? prototypeTileSelector(target.pickId) : null;
    return (
        <div
            data-prototype="autopick-takeover"
            role="status"
            className="flex shrink-0 items-center justify-center gap-3 rounded-sm border border-danger/60 bg-danger/15 px-4 py-2 text-base text-text"
        >
            <span className="text-2xl font-bold text-danger-strong tabular-nums">
                {seconds}s
            </span>
            {target ? (
                <span>
                    <strong>{target.cardName}</strong> will be picked
                    {isSelection ? " (your selection)" : " for you"} — click any
                    other card to take that one instead.
                </span>
            ) : (
                <span>
                    Nothing selected — the Bot will pick for you. Click a card
                    to choose.
                </span>
            )}
            {tile && (
                <style>{`
[data-draft-pick-tile] {
    opacity: 0.4;
    filter: saturate(0.4);
    transition: opacity 0.25s, filter 0.25s, scale 0.25s;
}
[data-draft-pick-tile]:hover { opacity: 0.85; filter: none; }
${tile}, ${tile}:hover {
    opacity: 1;
    filter: none;
    scale: 1.1;
    z-index: 3;
    box-shadow: 0 0 0 4px var(--color-signal-pending), 0 12px 32px rgba(0, 0, 0, 0.7);
}
${tile}::after {
    content: "WILL BE PICKED";
    position: absolute;
    inset: auto 0 12% 0;
    z-index: 3;
    padding: 5px 0;
    background: var(--color-signal-pending);
    color: #1c1300;
    font: 800 13px/1.2 system-ui, sans-serif;
    letter-spacing: 0.12em;
    text-align: center;
    pointer-events: none;
}
`}</style>
            )}
        </div>
    );
}
