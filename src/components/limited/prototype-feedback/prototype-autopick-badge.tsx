// PROTOTYPE — throwaway (player-feedback 2026-11, `pv-autopick=A`). Never merge.
// Variant A: mark the card itself, nothing else moves. In the last 5 s the
// card the clock will take gets a pulsing amber ring and a live
// "AUTO-PICK IN 3s" badge on its face; the rest of the pack is untouched.
import {
    prototypeTileSelector,
    type PrototypeAutopickProps,
} from "./prototypeAutopickTarget";

export default function PrototypeAutopickBadge({
    target,
    isSelection,
    seconds,
}: PrototypeAutopickProps) {
    if (!target) return null;
    const tile = prototypeTileSelector(target.pickId);
    const label = `AUTO-PICK IN ${seconds}s${isSelection ? "" : " · suggested"}`;
    return (
        <style data-prototype="autopick-badge">{`
@keyframes prototype-autopick-pulse {
    from { outline-color: var(--color-signal-pending); outline-offset: 1px; }
    to { outline-color: transparent; outline-offset: 5px; }
}
${tile} {
    outline: 4px solid var(--color-signal-pending);
    outline-offset: 1px;
    z-index: 2;
    animation: prototype-autopick-pulse 0.6s ease-in-out infinite alternate;
}
${tile}::after {
    content: "${label}";
    position: absolute;
    top: 8%;
    left: 50%;
    transform: translateX(-50%);
    z-index: 3;
    padding: 3px 10px;
    border-radius: 999px;
    background: var(--color-signal-pending);
    color: #1c1300;
    font: 800 13px/1.2 system-ui, sans-serif;
    letter-spacing: 0.04em;
    white-space: nowrap;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.6);
    pointer-events: none;
}
`}</style>
    );
}
