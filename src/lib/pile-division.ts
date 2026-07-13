// Resolves a pile-division choice's card ids (Fact or Fiction, ADR 0053) to the
// face-up `CardInstance`s the picker renders. The divided cards live in
// whichever zone the divide targeted — the divider's exposed `libraryPeek` for
// a library divide (Fact or Fiction), the public battlefield for a permanent
// divide (Do or Die), the graveyard for a graveyard divide. Gathering across
// every visible zone keeps the picker zone-agnostic, so one component serves the
// whole `divideIntoPiles` family.
import type { CardInstance, PendingChoice } from "~/types/game";

/** The visible zones a divided card can currently sit in on the projected
 *  state. `hand`/`exile`/`battlefield` may carry nulls (opponent-hidden slots);
 *  those are skipped. */
type ZonedPlayer = {
    battlefield?: (CardInstance | null)[];
    graveyard?: (CardInstance | null)[];
    exile?: (CardInstance | null)[];
    hand?: (CardInstance | null)[];
    libraryPeek?: CardInstance[];
    librarySearch?: CardInstance[];
    revealedHand?: CardInstance[];
};

export function resolvePileDivisionCards(
    players: readonly ZonedPlayer[],
    choice: PendingChoice
): CardInstance[] {
    const ids =
        choice.kind === "pick-pile"
            ? [...(choice.pileA ?? []), ...(choice.pileB ?? [])]
            : (choice.candidateIds ?? []);

    const byId = new Map<string, CardInstance>();
    for (const p of players) {
        const zones = [
            p.battlefield,
            p.graveyard,
            p.exile,
            p.hand,
            p.libraryPeek,
            p.librarySearch,
            p.revealedHand,
        ];
        for (const zone of zones) {
            if (!zone) continue;
            for (const c of zone) if (c) byId.set(c.id, c);
        }
    }

    return ids
        .map((id) => byId.get(id))
        .filter((c): c is CardInstance => c !== undefined);
}
