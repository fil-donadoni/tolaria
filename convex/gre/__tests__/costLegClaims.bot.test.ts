// The runtime companion to `COST_LEG_CLAIMS` (issue #3007, slice of #2998
// Gap 2).
//
// The TOTALITY of the table is enforced by `tsc`, not here — that is the whole
// design: `Record<keyof ActivatedAbility["cost"], CostLegClaim>` reds on a new
// cost key at compile time, where a `satisfies readonly (keyof …)[]` list (the
// `NEVER_AUTO_PAYABLE_COST_LEGS` this replaces) stayed green. A runtime
// assertion would only fire in a suite somebody remembered to run.
//
// What is left for runtime is everything `tsc` cannot see:
//
//   • a claim naming a function that no longer exists — the stale-row check,
//     the same failure `opValuerCoverage.bot.test.ts` catches for valuers, and
//     it is not hypothetical: two of the twenty-one rows named a plausible
//     symbol that was never there (`canActivateLoyaltyAbility`,
//     `applyActivationCostReduction`) and this test is what found them;
//   • a `hole` row with no sibling issue behind it;
//   • the derived `NEVER_AUTO_PAYABLE_COST_LEGS` still saying what the
//     hand-maintained list said, so the derivation is a refactor and not a
//     behaviour change.
//
// It does NOT prove board-state reachability — that the enumerator yields a
// legal, payable Move for a leg on a real board. That needs a canned position
// per shape and is deliberately out of scope (issue #3007 § Out of scope).

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
    COST_LEG_CLAIMS,
    NEVER_AUTO_PAYABLE_COST_LEGS,
    type CostLegClaim,
} from "../costLegClaims";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

const entries = Object.entries(COST_LEG_CLAIMS) as [string, CostLegClaim][];

describe("COST_LEG_CLAIMS — the activation-cost leg census (issue #3007)", () => {
    it("every claim names a file that exists and a symbol that is still in it", () => {
        const stale: string[] = [];
        for (const [leg, claim] of entries) {
            const path = REPO_ROOT + claim.paidBy.file;
            if (!existsSync(path)) {
                stale.push(`${leg}: no such file ${claim.paidBy.file}`);
                continue;
            }
            if (!readFileSync(path, "utf8").includes(claim.paidBy.symbol)) {
                stale.push(
                    `${leg}: ${claim.paidBy.file} no longer contains ${claim.paidBy.symbol}`
                );
            }
        }
        expect(
            stale,
            "these cost-leg claims point at code that has moved or been renamed. " +
                "A claim naming a symbol nobody can find is worse than no claim: " +
                "it reads as an adjudication and proves nothing. Re-read the leg " +
                "and name where it is ACTUALLY paid."
        ).toEqual([]);
    });

    it("every claim carries a reason, and no reason is a placeholder", () => {
        for (const [leg, claim] of entries) {
            expect(claim.why.length, `${leg} has no reason`).toBeGreaterThan(
                40
            );
            expect(
                /^(handled|ok|done|n\/a|todo)\b/i.test(claim.why.trim()),
                `${leg}'s reason is a placeholder — say which code pays the leg and why that is the whole answer`
            ).toBe(false);
            // CR citations are the house style for an engine claim, and the
            // vendored-CR linter (`bun run cr:lint`, in `check:guards`) can only
            // check an id it can see.
            expect(
                claim.why.includes("CR "),
                `${leg}'s reason cites no CR rule`
            ).toBe(true);
        }
    });

    it("a declared hole names the sibling issue that tracks it", () => {
        for (const [leg, claim] of entries) {
            if (!claim.hole) continue;
            expect(
                /^#\d+$/.test(claim.hole),
                `${leg} declares a hole but its tracking reference is not an issue number`
            ).toBe(true);
        }
    });

    // The derivation replaced a hand-maintained array. This pins that it
    // derives the SAME set, so the change is a refactor of where the truth
    // lives and not a silent widening of what the automatic planner may spend.
    it("derives exactly the legs the hand-maintained list named — `tap`, `tapOtherFilter` and `mana` are the only auto-payable ones (CR 602.1)", () => {
        expect([...NEVER_AUTO_PAYABLE_COST_LEGS].sort()).toEqual(
            [
                "cyclingCost",
                "discardAtRandom",
                "discardFilter",
                "discardLastDrawn",
                "discardThis",
                "exileFromGraveyard",
                "exileThis",
                "life",
                "loyalty",
                "manaEqualToCounterCount",
                "manaEqualToEnchantedCreatureCost",
                "removeCounter",
                "returnUnblockedAttacker",
                "sacrifice",
                "sacrificeFilter",
                "sacrificeFilterCount",
                "selfReduction",
                "xFromTargetSpellMv",
            ].sort()
        );
        const autoPayable = entries
            .filter(([, c]) => c.autoPayable)
            .map(([leg]) => leg)
            .sort();
        expect(autoPayable).toEqual(["mana", "tap", "tapOtherFilter"]);
    });
});
