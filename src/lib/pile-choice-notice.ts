// ADR 0053 (pile division) / issue #5661 — the confirmation every seat sees
// once a `pick-pile` choice is answered. Derived from the engine's one-slot
// `lastPileChoice` (no event log): a NEW key is a new pick. The first snapshot
// a board sees is only a baseline, so a reload never replays an old pick.
import type { PileChoiceNotice, Player } from "~/types/game";

export type PileNoticeTracker = {
    /** False until the first loaded snapshot has been observed. */
    primed: boolean;
    /** The last pick key seen (baseline or confirmed). */
    seenKey: string | undefined;
};

export const INITIAL_PILE_NOTICE_TRACKER: PileNoticeTracker = {
    primed: false,
    seenKey: undefined,
};

/** Advance the tracker over one snapshot. `confirm` is the pick to announce,
 *  or null — always null for the first loaded snapshot (the baseline) and for
 *  a key already seen. `tracker` is returned unchanged when nothing moved, so
 *  a caller holding it in React state can skip the update. */
export function trackPileNotice(
    tracker: PileNoticeTracker,
    loaded: boolean,
    notice: PileChoiceNotice | undefined
): { tracker: PileNoticeTracker; confirm: PileChoiceNotice | null } {
    if (!loaded) return { tracker, confirm: null };
    if (!tracker.primed) {
        return {
            tracker: { primed: true, seenKey: notice?.key },
            confirm: null,
        };
    }
    if (!notice || notice.key === tracker.seenKey) {
        return { tracker, confirm: null };
    }
    return {
        tracker: { primed: true, seenKey: notice.key },
        confirm: notice,
    };
}

/** "Alice took Pile B: Grizzly Bears, Savannah Lions" — the toast line. */
export function formatPileChoiceNotice(
    notice: PileChoiceNotice,
    players: Pick<Player, "id" | "name">[]
): string {
    const chooser =
        players.find((p) => p.id === notice.chooserId)?.name ?? "A player";
    const cards =
        notice.cardNames.length > 0 ? notice.cardNames.join(", ") : "no cards";
    return `${chooser} took Pile ${notice.pile}: ${cards}`;
}
