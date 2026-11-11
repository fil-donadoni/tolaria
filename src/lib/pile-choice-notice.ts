// ADR 0053 (pile division) / issue #5661 — the confirmation every seat sees
// once a `pick-pile` choice is answered. Derived from the engine's one-slot
// `lastPileChoice` (no event log): a NEW key is a new pick. The first snapshot
// a board sees is only a baseline, so a reload never replays an old pick.
import type {
    ChoiceAnnouncement,
    PileChoiceNotice,
    Player,
} from "~/types/game";

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
export function trackPileNotice<T extends { key: string } = PileChoiceNotice>(
    tracker: PileNoticeTracker,
    loaded: boolean,
    notice: T | undefined
): { tracker: PileNoticeTracker; confirm: T | null } {
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

/** "(A, B)" for a non-empty name list, else "". */
function nameSuffix(names: string[] | undefined): string {
    return names && names.length > 0 ? ` (${names.join(", ")})` : "";
}

/** Issue #8956 — "Alice named Island" / "Alice scried 2: 1 on top, 1 on the
 *  bottom" / "Alice surveilled 3: 2 into the graveyard (A, B), 1 on top". The
 *  opponent's copy carries counts only (the projection strips the library
 *  names); the chooser's own copy adds them. */
export function formatChoiceAnnouncement(
    notice: ChoiceAnnouncement,
    players: Pick<Player, "id" | "name">[]
): string {
    const chooser =
        players.find((p) => p.id === notice.chooserId)?.name ?? "A player";
    if (notice.kind === "named-card") {
        return `${chooser} named ${notice.cardName ?? "a card"}`;
    }
    const looked = notice.looked ?? 0;
    const onTop = notice.onTop ?? 0;
    const second = notice.second ?? 0;
    const top = `${onTop} on top${nameSuffix(notice.chooserNames?.top)}`;
    if (notice.secondZone === "graveyard") {
        return `${chooser} surveilled ${looked}: ${second} into the graveyard${nameSuffix(notice.graveyardNames)}, ${top}`;
    }
    return `${chooser} scried ${looked}: ${top}, ${second} on the bottom${nameSuffix(notice.chooserNames?.bottom)}`;
}
