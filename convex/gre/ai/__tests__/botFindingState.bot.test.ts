// Bot Findings — derived status, blade-card join and Classes ranking
// (ADR 0141 § 3, issue #4177). `.bot.test.ts`: the subject lives under
// `convex/gre/ai/` (`bot-suite-boundary.test.ts`).
import { describe, it, expect } from "vitest";
import {
    computeFindingStatus,
    mustBladeEntryFor,
    rankFindingClasses,
    type BladeCardIndex,
} from "../botFindingState";

describe("computeFindingStatus — ADR 0141 § 3's table, exhaustive over all five states", () => {
    it("open: no proof, not played", () => {
        expect(
            computeFindingStatus({
                outcome: "ignored",
                classHasMustBladeEntry: false,
            })
        ).toBe("open");
    });

    it("class-fixed: the class has a must blade entry, the card still not played", () => {
        expect(
            computeFindingStatus({
                outcome: "frozen",
                classHasMustBladeEntry: true,
            })
        ).toBe("class-fixed");
    });

    it("played-unproven: the card plays, its class carries no proof yet", () => {
        expect(
            computeFindingStatus({
                outcome: "played",
                classHasMustBladeEntry: false,
            })
        ).toBe("played-unproven");
    });

    it("resolved: the card plays AND its class carries a must blade entry", () => {
        expect(
            computeFindingStatus({
                outcome: "played",
                classHasMustBladeEntry: true,
            })
        ).toBe("resolved");
    });

    it("harness-bound: a no-progress cause short-circuits the blade proof, on an UNplayed row", () => {
        expect(
            computeFindingStatus({
                outcome: "ignored",
                cause: "no-progress",
                classHasMustBladeEntry: true,
            })
        ).toBe("harness-bound");
    });

    it("played wins over a STALE harness cause — the sweep never patches `cause` when a row starts playing", () => {
        expect(
            computeFindingStatus({
                outcome: "played",
                cause: "no-progress",
                classHasMustBladeEntry: false,
            })
        ).toBe("played-unproven");
        expect(
            computeFindingStatus({
                outcome: "played",
                cause: "position-unmodelled",
                classHasMustBladeEntry: true,
            })
        ).toBe("resolved");
    });

    it("harness-bound: a position-unmodelled cause short-circuits too", () => {
        expect(
            computeFindingStatus({
                outcome: "ignored",
                cause: "position-unmodelled",
                classHasMustBladeEntry: false,
            })
        ).toBe("harness-bound");
    });

    it("a never-chosen cause is NOT harness-bound — only the two harness causes are", () => {
        expect(
            computeFindingStatus({
                outcome: "ignored",
                cause: "never-chosen",
                classHasMustBladeEntry: false,
            })
        ).toBe("open");
    });
});

describe("mustBladeEntryFor — a must entry's mere presence IS the green proof", () => {
    const INDEX: BladeCardIndex = {
        "Lightning Bolt": [
            { label: "bolt to the face", tier: "must", needsSetup: false },
        ],
        "Prodigal Sorcerer": [
            {
                label: "tapper stretch position",
                tier: "stretch",
                needsSetup: true,
            },
        ],
    };

    it("returns the must entry's label when a named card carries one", () => {
        expect(mustBladeEntryFor(["Lightning Bolt"], INDEX)).toBe(
            "bolt to the face"
        );
    });

    it("returns undefined when every entry for the named cards is stretch-only", () => {
        expect(mustBladeEntryFor(["Prodigal Sorcerer"], INDEX)).toBeUndefined();
    });

    it("returns undefined when no named card appears in the index at all", () => {
        expect(
            mustBladeEntryFor(["Some Unindexed Card"], INDEX)
        ).toBeUndefined();
    });

    it("checks every named card, not just the first", () => {
        expect(
            mustBladeEntryFor(["Prodigal Sorcerer", "Lightning Bolt"], INDEX)
        ).toBe("bolt to the face");
    });
});

describe("rankFindingClasses — lexicographic on priority Targets, corpus tie-break, key last", () => {
    const PRIORITY = ["premodern-metagame", "vintage-cube"];

    it("ranks the class with more cards on the higher-priority Target first", () => {
        const a = {
            key: "b-key",
            cardCount: 1,
            targetCounts: [{ target: "premodern-metagame", count: 1 }],
        };
        const b = {
            key: "a-key",
            cardCount: 5,
            targetCounts: [{ target: "vintage-cube", count: 5 }],
        };
        expect(rankFindingClasses([b, a], PRIORITY)).toEqual([a, b]);
    });

    it("falls back to corpus count (cardCount) when every priority Target ties", () => {
        const small = {
            key: "small",
            cardCount: 2,
            targetCounts: [],
        };
        const big = {
            key: "big",
            cardCount: 9,
            targetCounts: [],
        };
        expect(rankFindingClasses([small, big], PRIORITY)).toEqual([
            big,
            small,
        ]);
    });

    it("breaks a full tie on the key, ascending — a total order", () => {
        const z = { key: "z-key", cardCount: 3, targetCounts: [] };
        const a = { key: "a-key", cardCount: 3, targetCounts: [] };
        expect(rankFindingClasses([z, a], PRIORITY)).toEqual([a, z]);
    });

    it("treats an absent Target as zero, never throwing on a missing entry", () => {
        const named = {
            key: "named",
            cardCount: 1,
            targetCounts: [{ target: "vintage-cube", count: 1 }],
        };
        const bare = { key: "bare", cardCount: 1, targetCounts: [] };
        expect(rankFindingClasses([bare, named], PRIORITY)).toEqual([
            named,
            bare,
        ]);
    });
});
