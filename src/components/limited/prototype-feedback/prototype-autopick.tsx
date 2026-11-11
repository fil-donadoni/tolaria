// PROTOTYPE — throwaway (player-feedback 2026-11, `pv-autopick`). Never merge.
//
// "Highlight the card that gets taken if I don't choose." Owner decision: in
// the LAST 5 SECONDS the card the server will take on timeout — the Selected
// Card if there is one, else the seat's Default Pick (server order:
// selectedPickId → defaultPickId → bot pick) — is highlighted REGARDLESS of
// the "Show autopick" toggle. Before that nothing changes: the toggle and its
// faint ring behave exactly as today. The three variants share that trigger
// and differ only in HOW the highlight looks and behaves. Read-only: the only
// way to change the target is the existing click-to-select.
//
// None of them touches `limited-draft-pack-card.tsx`: the tile already carries
// `data-pick-id`, so each variant paints through an injected <style>.
import type { LimitedEventSeatView } from "~/hooks/useLimitedEvent";
import { usePrototypeSecondsLeft } from "./usePrototypeSecondsLeft";
import PrototypeAutopickBadge from "./prototype-autopick-badge";
import PrototypeAutopickChip from "./prototype-autopick-chip";
import PrototypeAutopickTakeover from "./prototype-autopick-takeover";

export default function PrototypeAutopick({
    variant,
    seat,
}: {
    variant: string;
    seat: LimitedEventSeatView;
}) {
    const { seconds, urgent } = usePrototypeSecondsLeft(seat.pickDeadline);
    const pack = seat.currentPack ?? [];
    const selected = pack.find((c) => c.pickId === seat.selectedPickId);
    const target =
        selected ?? pack.find((c) => c.pickId === seat.defaultPickId);
    if (seconds === null || pack.length === 0 || !urgent) return null;
    const props = {
        target: target ?? null,
        isSelection: selected !== undefined,
        seconds,
    };
    if (variant === "A") return <PrototypeAutopickBadge {...props} />;
    if (variant === "B") return <PrototypeAutopickChip {...props} />;
    if (variant === "C") return <PrototypeAutopickTakeover {...props} />;
    return null;
}
