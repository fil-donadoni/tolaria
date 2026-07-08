import { Eye } from "lucide-react";

/** ADR 0026 / PRD #338 (slice 3) — the Arena-style "an opponent knows this
 *  card" eye icon. Rendered per-card, ONLY on the specific cards in the viewer's
 *  own hand that at least one opponent legitimately knows (derived
 *  `seenByOpponent` flag) — never generically on the whole hand. Purely
 *  presentational; pointer-events are off so it never intercepts the card's
 *  click/drag gestures. */
export default function SeenByOpponentBadge() {
    return (
        <div
            data-seen-by-opponent="true"
            className="absolute top-1 left-1 z-30 pointer-events-none rounded-full bg-black/70 p-1 ring-1 ring-white/30 drop-shadow-[0_0_2px_rgba(0,0,0,0.9)]"
            title="An opponent knows this card"
            aria-label="An opponent knows this card"
        >
            <Eye className="w-3.5 h-3.5 text-amber-300" />
        </div>
    );
}
