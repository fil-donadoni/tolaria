// The cast-commit LIFE seam (CR 601.2b / 119.4 / 118.8 — issue #2379).
//
// A cast pays ONE life total, assembled at the point the spell commits. There
// are two commit paths in `convex/game.ts` and they were NOT computing the same
// thing: `finalizeTargetSelection` (the TARGETED commit) folded the card's own
// `additionalCosts.payXLife` / `payLife`, and `announceCast`'s NO-TARGET commit
// folded nothing at all. A non-targeting spell with a life additional cost was
// therefore gated as affordable at announcement and then never charged —
// **Toxic Deluge** (`c13/black.ts`, `payXLife: true`, no `targetRequirement`)
// has been free of its X life for as long as it has shipped.
//
// The fix is a shared seam, `additionalCostLifePayment`, called from both. This
// file is that seam's permanent test, in two halves:
//
//  1. **Behaviour** — the seam prices the REAL catalogue definitions: Toxic
//     Deluge's `payXLife` at the announced X, Bitter Triumph's chosen `oneOf`
//     life leg at 3, and 0 for a card with no additional cost at all.
//  2. **Source guard** — every cast-commit life total in `game.ts` folds
//     through the seam. `announceCast` is a Convex mutation and this project
//     has no harness that can call one (ADR 0001), which is exactly why the
//     missing term survived: it is reachable from a test only through the seams
//     it calls, so the seam has to be the thing the guard pins. Same pattern
//     and same reason as `castManaSpentCapture.test.ts`'s
//     "every cast-commit site pays through `payCastManaCost`".
//
// Deleting the seam call from EITHER commit path — which is precisely the edit
// that shipped the Toxic Deluge bug — fails the guard below.

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
    additionalCostLifePayment,
    resolveAdditionalCosts,
} from "../gre/additionalCost";
import { toxicDeluge } from "../cards/sets/c13";
import { bitterTriumph } from "../cards/sets/lci";
import { lightningBolt } from "../cards/sets/lea";

const GAME_TS = path.resolve(__dirname, "..", "game.ts");

describe("additionalCostLifePayment — the life a cast owes for its own additional cost (CR 601.2b / 119.4)", () => {
    it("prices Toxic Deluge's 'pay X life' at the announced X", () => {
        // The card that was going uncharged. `payXLife` has no `oneOf`, so the
        // flatten is the identity and the spec the commit reads is the printed
        // one.
        const spec = resolveAdditionalCosts(
            toxicDeluge.additionalCosts,
            undefined
        );
        expect(additionalCostLifePayment(spec, 3)).toBe(3);
        expect(additionalCostLifePayment(spec, 0)).toBe(0);
        // CR 601.2b — X is announced; an absent X is 0 life, never NaN.
        expect(additionalCostLifePayment(spec, undefined)).toBe(0);
    });

    it("prices the CHOSEN oneOf life leg, and charges nothing for the discard leg", () => {
        const life = resolveAdditionalCosts(
            bitterTriumph.additionalCosts,
            "pay-3-life"
        );
        expect(additionalCostLifePayment(life, undefined)).toBe(3);
        const discard = resolveAdditionalCosts(
            bitterTriumph.additionalCosts,
            "discard"
        );
        expect(additionalCostLifePayment(discard, undefined)).toBe(0);
    });

    it("charges nothing for a card with no additional cost", () => {
        expect(lightningBolt.additionalCosts).toBeUndefined();
        expect(additionalCostLifePayment(undefined, 5)).toBe(0);
    });
});

/** Every cast-commit LIFE total in `game.ts`, as `{ name, line, expr }`.
 *
 *  A cast's life total is the one sum that folds `phyrexianPayment.payLife`
 *  (CR 107.4f) — the Phyrexian term is universal to a cast, present on both
 *  commit paths and on nothing else in the file, which makes it the honest
 *  discriminator for "this declaration is a cast-commit life total". Walking
 *  BACK from it to the opening `const <name> =` keeps the scan indifferent to
 *  how prettier wraps the expression. */
function castCommitLifeSums(
    lines: string[]
): { name: string; line: number; expr: string }[] {
    const out: { name: string; line: number; expr: string }[] = [];
    for (let i = 0; i < lines.length; i++) {
        if (!/phyrexianPayment\.payLife/.test(lines[i])) continue;
        let start = i;
        while (start >= 0 && !/const (\w+) =/.test(lines[start])) start -= 1;
        if (start < 0) continue;
        const name = /const (\w+) =/.exec(lines[start])![1];
        let end = i;
        while (end < lines.length && !/;\s*$/.test(lines[end])) end += 1;
        out.push({
            name,
            line: start + 1,
            expr: lines.slice(start, end + 1).join("\n"),
        });
    }
    return out;
}

describe("game.ts cast-commit life totals all fold through the shared seam (issue #2379)", () => {
    it("both commit paths call additionalCostLifePayment", () => {
        const lines = fs.readFileSync(GAME_TS, "utf8").split("\n");
        const sums = castCommitLifeSums(lines);
        // Two commit paths: `finalizeTargetSelection` (targeted) and
        // `announceCast`'s no-target branch. A THIRD is not forbidden — it
        // just has to make the same decision explicitly, here.
        expect(sums.map((s) => s.name)).toEqual([
            "payLife",
            "phyrexianPayLife",
        ]);
        const offenders = sums.filter(
            (s) => !s.expr.includes("additionalCostLifePayment(")
        );
        expect(
            offenders.map((s) => `convex/game.ts:${s.line} → const ${s.name}`),
            "a cast-commit life total that does not fold the card's own " +
                "additional-cost life through `additionalCostLifePayment` " +
                "charges the caster nothing for it (the Toxic Deluge bug, " +
                "#2379). Fold the seam in."
        ).toEqual([]);
    });

    it("no commit path re-inlines the payXLife term beside the seam", () => {
        // The bug was two hand-written copies of one cost drifting apart. The
        // seam only helps while it is the ONLY place the term is written, so
        // the inline ternary that used to sit in both sums must not come back.
        const src = fs.readFileSync(GAME_TS, "utf8");
        expect(
            src.includes("payXLife === true ? "),
            "the `payXLife` life term belongs in `additionalCostLifePayment` " +
                "alone — an inline copy is how the two commit paths diverged."
        ).toBe(false);
    });
});
