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
