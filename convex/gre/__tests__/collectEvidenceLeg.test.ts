// Collect evidence (CR 701.59a / 701.59b) — the leg's pure helpers, over
// printed fodder only (no card that needs the leg), so the guard runs on any
// tree. The end-to-end path on Detective's Phoenix is `collectEvidence.test.ts`.

import { describe, it, expect } from "vitest";
import {
    canCollectEvidence,
    collectEvidenceSatisfied,
    totalManaValue,
    withCollectEvidenceExile,
} from "../collectEvidence";
import { makeInstance } from "../../cards/__tests__/setup.helper";
import {
    ancestralRecall,
    disenchant,
    grizzlyBears,
    lightningBolt,
} from "../../cards/sets/lea/index.cards";

// Bears 2 + Disenchant 2 + Bolt 1 + Recall 1 = 6.
const pile = [
    makeInstance(grizzlyBears().id, { id: "bears", zone: "graveyard" }),
    makeInstance(disenchant().id, { id: "disenchant", zone: "graveyard" }),
    makeInstance(lightningBolt().id, { id: "bolt", zone: "graveyard" }),
    makeInstance(ancestralRecall().id, { id: "recall", zone: "graveyard" }),
];

describe("collect evidence N — the leg (CR 701.59a / 701.59b)", () => {
    it("sums printed mana value", () => {
        expect(totalManaValue(pile)).toBe(6);
    });

    it("can collect evidence 6 from exactly 6, not 7 (CR 701.59b)", () => {
        expect(canCollectEvidence(pile, 6, "none")).toBe(true);
        expect(canCollectEvidence(pile, 7, "none")).toBe(false);
    });

    it("never counts the excluded cast card (CR 601.2a)", () => {
        expect(canCollectEvidence(pile, 6, "recall")).toBe(false);
    });

    it("a pick must reach the threshold and name at least one card", () => {
        expect(collectEvidenceSatisfied(pile, 6)).toBe(true);
        expect(collectEvidenceSatisfied(pile.slice(0, 3), 6)).toBe(false);
        expect(collectEvidenceSatisfied([], 0)).toBe(false);
    });

    it("folds into the picker UNPICKED, and refuses an unpayable leg", () => {
        expect(
            withCollectEvidenceExile(
                pile,
                { collectEvidence: 6 },
                "x",
                undefined
            )
        ).toEqual({ count: 1, minTotalManaValue: 6, excludeInstanceId: "x" });
        expect(() =>
            withCollectEvidenceExile(
                pile,
                { collectEvidence: 7 },
                "x",
                undefined
            )
        ).toThrow(/collect evidence 7/);
        expect(
            withCollectEvidenceExile(pile, {}, "x", undefined)
        ).toBeUndefined();
    });
});
