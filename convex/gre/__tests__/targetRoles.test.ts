// CR 601.2c — a single instance of the word "target" may announce several
// objects, and an Effect Script reads them POSITIONALLY. `gre/targetRoles.ts`
// derives, from the script alone, whether those positions receive DIFFERENT
// halves of the effect and what each one receives, so the prompt can say it
// instead of leaving the caster to infer it from click order (issue #4193).
//
// The cases below are the three answers that matter: an ASYMMETRIC group gets
// labels, a SYMMETRIC one gets none (its prompt must not grow noise), and
// every shape the derivation cannot read fails CLOSED to "no labels", which is
// the pre-issue behaviour rather than a guess resolution would contradict.
import { describe, it, expect } from "vitest";
import type { EffectOp } from "../../cards/types";
import {
    announcedTargetRoles,
    announcedTargetSlotsDiffer,
} from "../targetRoles";

/** Jilt's script — CR 702.33g's count-widening kicked announcement over an
 *  ASYMMETRIC body: slot 0 is bounced, slot 1 is burned. */
const JILT: EffectOp[] = [
    { op: "moveZone", target: { target: 0 }, to: "hand" },
    {
        op: "if",
        predicate: { left: { kickerCount: true }, op: "ge", right: 1 },
        then: [{ op: "dealDamage", amount: 2, to: { target: 1 } }],
    },
] as unknown as EffectOp[];

/** Magma Burst's script — the same encoding over a SYMMETRIC body: both
 *  announced targets take 3 damage, so index order changes nothing. */
const MAGMA_BURST: EffectOp[] = [
    { op: "dealDamage", amount: 3, to: { target: 0 } },
    {
        op: "if",
        predicate: { left: { kickerCount: true }, op: "ge", right: 1 },
        then: [{ op: "dealDamage", amount: 3, to: { target: 1 } }],
    },
] as unknown as EffectOp[];

/** Barrin's Spite's script — both slots are read through a `choice` Op's
 *  candidate list and a `controllerOf`, never as an Op's own recipient. The
 *  two creatures are genuinely interchangeable (their controller picks
 *  afterwards), and no direct selector says otherwise. */
const BARRINS_SPITE: EffectOp[] = [
    {
        op: "choice",
        kind: "sacrifice-permanents",
        player: { controllerOf: { target: 0 } },
        zone: "battlefield",
        candidates: [{ target: 0 }, { target: 1 }],
        count: 1,
        prompt: "Choose which of the two creatures to sacrifice",
        bind: "$sacrificed",
        bindOther: "$spared",
    },
    { op: "sacrifice", permanents: { ref: "$sacrificed" } },
    { op: "moveZone", target: { ref: "$spared" }, to: "hand" },
] as unknown as EffectOp[];

describe("announcedTargetRoles — asymmetric announcement (CR 601.2c / 702.33g)", () => {
    it("names the half each announced target of a kicked Jilt receives", () => {
        expect(announcedTargetSlotsDiffer(JILT, 0, 2)).toBe(true);
        expect(announcedTargetRoles(JILT, 0, 2)).toEqual([
            "returned to its owner's hand",
            "dealt 2 damage",
        ]);
    });

    it("reads a gated half the same as an ungated one (the Op, not its nesting)", () => {
        // Slot 1's `dealDamage` sits inside the kicker `if`; the derivation is
        // structural and finds it wherever the script puts it.
        const flat: EffectOp[] = [
            { op: "moveZone", target: { target: 0 }, to: "hand" },
            { op: "dealDamage", amount: 2, to: { target: 1 } },
        ] as unknown as EffectOp[];
        expect(announcedTargetRoles(flat, 0, 2)).toEqual(
            announcedTargetRoles(JILT, 0, 2)
        );
    });

    it("labels a group that starts at a later slot of the flat announcement", () => {
        // CR 601.2c — an announcement's groups concatenate, so a group's slot
        // window is not always `[0, count)`.
        const twoGroups: EffectOp[] = [
            { op: "destroy", target: { target: 0 } },
            { op: "moveZone", target: { target: 1 }, to: "hand" },
            { op: "dealDamage", amount: 1, to: { target: 2 } },
        ] as unknown as EffectOp[];
        expect(announcedTargetRoles(twoGroups, 1, 2)).toEqual([
            "returned to its owner's hand",
            "dealt 1 damage",
        ]);
    });
});

describe("announcedTargetRoles — symmetric announcement prints nothing (issue #4193)", () => {
    it("gives Magma Burst's two identical halves no per-Target text", () => {
        expect(announcedTargetSlotsDiffer(MAGMA_BURST, 0, 2)).toBe(false);
        expect(announcedTargetRoles(MAGMA_BURST, 0, 2)).toBeUndefined();
    });

    it("gives a single announced target none either", () => {
        expect(announcedTargetRoles(MAGMA_BURST, 0, 1)).toBeUndefined();
        expect(announcedTargetSlotsDiffer(MAGMA_BURST, 0, 1)).toBe(false);
    });
});

describe("announcedTargetRoles — fails closed (issue #4193)", () => {
    it("refuses a script that reads a slot outside an Op's own selector", () => {
        // Barrin's Spite. Labelling these would invent a distinction the card
        // does not print.
        expect(announcedTargetSlotsDiffer(BARRINS_SPITE, 0, 2)).toBe(false);
        expect(announcedTargetRoles(BARRINS_SPITE, 0, 2)).toBeUndefined();
    });

    it("refuses an Op the phrase table does not carry", () => {
        const unknownOp: EffectOp[] = [
            { op: "moveZone", target: { target: 0 }, to: "hand" },
            { op: "tap", target: { target: 1 } },
        ] as unknown as EffectOp[];
        // The slots genuinely DIFFER — which is what the catalogue guard
        // watches — but no phrase exists for `tap.target`, so nothing is
        // printed rather than something wrong.
        expect(announcedTargetSlotsDiffer(unknownOp, 0, 2)).toBe(true);
        expect(announcedTargetRoles(unknownOp, 0, 2)).toBeUndefined();
    });

    it("refuses a moveZone whose destination has no phrase", () => {
        const odd: EffectOp[] = [
            { op: "moveZone", target: { target: 0 }, to: "command" },
            { op: "dealDamage", amount: 2, to: { target: 1 } },
        ] as unknown as EffectOp[];
        expect(announcedTargetRoles(odd, 0, 2)).toBeUndefined();
    });

    it("refuses a window with a slot no Op reads", () => {
        const onlyFirst: EffectOp[] = [
            { op: "destroy", target: { target: 0 } },
        ] as unknown as EffectOp[];
        expect(announcedTargetSlotsDiffer(onlyFirst, 0, 2)).toBe(false);
        expect(announcedTargetRoles(onlyFirst, 0, 2)).toBeUndefined();
    });

    it("refuses a card with no Effect Script at all (a resolve() card)", () => {
        expect(announcedTargetRoles(undefined, 0, 2)).toBeUndefined();
        expect(announcedTargetSlotsDiffer(undefined, 0, 2)).toBe(false);
    });
});
