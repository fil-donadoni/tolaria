// Issue #8956 — the one-line text of a named-card / scry-split announcement,
// and the once-per-key baseline rule it shares with the pile pick.
import { describe, it, expect } from "vitest";
import {
    INITIAL_PILE_NOTICE_TRACKER,
    formatChoiceAnnouncement,
    trackPileNotice,
} from "~/lib/pile-choice-notice";
import type { ChoiceAnnouncement } from "~/types/game";

const players = [
    { id: "p1", name: "Alice" },
    { id: "p2", name: "Bob" },
];
const base = { key: "1:s:0:c", seq: 1, chooserId: "p1" };

describe("formatChoiceAnnouncement", () => {
    it("reads a named card", () => {
        const n: ChoiceAnnouncement = {
            ...base,
            kind: "named-card",
            cardName: "Island",
        };
        expect(formatChoiceAnnouncement(n, players)).toBe("Alice named Island");
    });

    it("reads a scry as counts only when the library names are stripped", () => {
        const n: ChoiceAnnouncement = {
            ...base,
            kind: "top-split",
            looked: 2,
            onTop: 1,
            second: 1,
            secondZone: "library-bottom",
        };
        expect(formatChoiceAnnouncement(n, players)).toBe(
            "Alice scried 2: 1 on top, 1 on the bottom"
        );
    });

    it("names the graveyard cards of a surveil and the count left on top", () => {
        const n: ChoiceAnnouncement = {
            ...base,
            kind: "top-split",
            looked: 3,
            onTop: 1,
            second: 2,
            secondZone: "graveyard",
            graveyardNames: ["Island", "Forest"],
        };
        expect(formatChoiceAnnouncement(n, players)).toBe(
            "Alice surveilled 3: 2 into the graveyard (Island, Forest), 1 on top"
        );
    });

    it("adds the chooser's own library names", () => {
        const n: ChoiceAnnouncement = {
            ...base,
            kind: "top-split",
            looked: 2,
            onTop: 1,
            second: 1,
            secondZone: "library-bottom",
            chooserNames: { top: ["Island"], bottom: ["Forest"] },
        };
        expect(formatChoiceAnnouncement(n, players)).toBe(
            "Alice scried 2: 1 on top (Island), 1 on the bottom (Forest)"
        );
    });
});

// CR 601.2b / 602.2b — the announced value of X, written at cast commit.
describe("formatChoiceAnnouncement — chosen X", () => {
    it("reads a spell cast with X", () => {
        const n: ChoiceAnnouncement = {
            ...base,
            chooserId: "p2",
            kind: "chosen-x",
            cardName: "Fireball",
            xValue: 4,
        };
        expect(formatChoiceAnnouncement(n, players)).toBe(
            "Bob cast Fireball with X = 4"
        );
    });

    it("reads an ability activated with X = 0", () => {
        const n: ChoiceAnnouncement = {
            ...base,
            kind: "chosen-x",
            cardName: "Aladdin's Lamp",
            xValue: 0,
            isAbility: true,
        };
        expect(formatChoiceAnnouncement(n, players)).toBe(
            "Alice activated Aladdin's Lamp with X = 0"
        );
    });

    it("announces one cast once: a re-render or reconnect never replays it", () => {
        const cast: ChoiceAnnouncement = {
            key: "3:fireball-1:x:chosen-x",
            seq: 3,
            chooserId: "p2",
            kind: "chosen-x",
            cardName: "Fireball",
            xValue: 4,
        };
        const baseline = trackPileNotice(
            INITIAL_PILE_NOTICE_TRACKER,
            true,
            undefined
        );
        const shown = trackPileNotice(baseline.tracker, true, cast);
        expect(shown.confirm).toBe(cast);
        // Re-render on the same snapshot.
        expect(trackPileNotice(shown.tracker, true, cast).confirm).toBeNull();
        // Reconnect: a fresh tracker treats the standing cast as baseline.
        expect(
            trackPileNotice(INITIAL_PILE_NOTICE_TRACKER, true, cast).confirm
        ).toBeNull();
    });
});

describe("announcement baseline (reload never replays)", () => {
    const note: ChoiceAnnouncement = { ...base, kind: "named-card" };
    it("treats the first loaded snapshot as a baseline, then announces a new key once", () => {
        const first = trackPileNotice(INITIAL_PILE_NOTICE_TRACKER, true, note);
        expect(first.confirm).toBeNull();
        const same = trackPileNotice(first.tracker, true, note);
        expect(same.confirm).toBeNull();
        const next = { ...note, key: "2:s:0:c" };
        expect(trackPileNotice(same.tracker, true, next).confirm).toBe(next);
    });
});

// Issue #10224 — a name locked in by the OPPOSING seat (or the Bot) arrives in
// a LATER snapshot than the baseline one and must yield exactly one confirm.
describe("named-card announcement from the opposing seat", () => {
    const named: ChoiceAnnouncement = {
        key: "2:s:0:c",
        seq: 2,
        chooserId: "p2",
        kind: "named-card",
        cardName: "Plains",
    };

    it("confirms once when it shows up after the baseline snapshot", () => {
        const baseline = trackPileNotice(
            INITIAL_PILE_NOTICE_TRACKER,
            true,
            undefined
        );
        expect(baseline.confirm).toBeNull();
        const later = trackPileNotice(baseline.tracker, true, named);
        expect(later.confirm).toBe(named);
        expect(formatChoiceAnnouncement(named, players)).toBe(
            "Bob named Plains"
        );
        const again = trackPileNotice(later.tracker, true, named);
        expect(again.confirm).toBeNull();
    });
});
