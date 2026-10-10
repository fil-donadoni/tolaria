// PROTOTYPE — throwaway. One-line table read-out per phase (compact tile,
// dialog subtitle).
import { EVENT_META, passDirectionFor } from "./event-mock";
import type { EventProto } from "./use-event-proto";

export function tableSummary(p: EventProto): string {
    const n = EVENT_META.seatCount;
    switch (p.phase) {
        case "waiting": {
            const humans = p.seats.filter((s) => s.kind === "human").length;
            return `${humans}/${n} seated · ${n - humans} open`;
        }
        case "drafting":
            return `Pack ${EVENT_META.draftPack} · passing ${passDirectionFor(EVENT_META.draftPack)}`;
        case "building":
            return `${p.seats.filter((s) => s.hasDeck).length}/${n} decks in`;
        case "playing":
            return `Round ${EVENT_META.currentRound} of ${EVENT_META.rounds}`;
        case "finished":
            return "Final · Morgana wins";
    }
}
