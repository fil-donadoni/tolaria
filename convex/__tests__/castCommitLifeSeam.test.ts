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
// file is that seam's permanent test, in three parts:
//
//  1. **Unit** — the seam prices the REAL catalogue definitions: Toxic
//     Deluge's `payXLife` at the announced X, Bitter Triumph's chosen `oneOf`
//     life leg at 3, and 0 for a card with no additional cost at all.
//  2. **Full path** — the headline bug fix itself, driven through the
//     `announceCast` mutation: Toxic Deluge announced for X = 3 with the mana
//     already floating takes the no-target IMMEDIATE-commit branch, and the
//     caster's life goes 20 → 17. This project has no `convex-test` package,
//     so the established seam for `game.ts` integration coverage is a stub
//     `MutationCtx` driving the REGISTERED mutation's own `_handler`
//     (`gameMutationHarness.ts`, as `upToXTargetCastLegality.test.ts` and
//     `delveCastCost.test.ts` do) — never a hand-rolled reimplementation of
//     `announceCast`'s body, which would share the bug's premise.
//  3. **Source guard** — every cast-commit life total in `game.ts` folds
//     through the seam, read off `game.ts`'s source. It earns its place beside
//     part 2 rather than substituting for it: part 2 proves the no-target
//     commit CHARGES the cost, part 3 proves neither path (nor a future third
//     one) silently stops folding the seam. Same pattern as
//     `castManaSpentCapture.test.ts`'s "every cast-commit site pays through
//     `payCastManaCost`".
//
// Deleting the seam call from the no-target commit — precisely the edit that
// shipped the Toxic Deluge bug — fails BOTH part 2 (life stays 20) and part 3.

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
    additionalCostLifePayment,
    resolveAdditionalCosts,
} from "../gre/additionalCost";
import { announceCast } from "../game";
import { toxicDeluge } from "../cards/sets/c13";
import { bitterTriumph } from "../cards/sets/lci";
import { lightningBolt } from "../cards/sets/lea";
import { swamp } from "../cards/sets/lea/colorless";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness";

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

type AnnounceCastArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    chosenX?: number;
};

/** p1 holds `cardId`, with six untapped Swamps AND `{B}{B}{B}` already
 *  floating. The floating pool is what matters: `announceCast` commits the
 *  cast in ONE mutation when the pool already covers the cost, which is the
 *  immediate-commit branch that pays the life — the deferred (`pendingCast`)
 *  branch would park instead and pay at `tapForPayment`. */
function floatingManaBoard(cardId: string) {
    const spell = makeInstance(cardId, {
        id: "spell",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const lands = Array.from({ length: 6 }, (_, i) =>
        makeInstance(swamp.id, {
            id: `swamp-${i}`,
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        })
    );
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [spell],
                battlefield: lands,
                manaPool: { W: 0, U: 0, B: 3, R: 0, G: 0, C: 0 },
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

describe("announceCast — the NO-TARGET commit charges the card's own 'pay X life' additional cost (CR 601.2b / 119.4, issue #2379)", () => {
    it("Toxic Deluge for X = 3: the spell reaches the stack and the caster's life goes 20 → 17", async () => {
        // The shipped bug, end to end. Toxic Deluge has NO `targetRequirement`,
        // so its cast commits here rather than in `finalizeTargetSelection` —
        // and this branch folded no additional-cost life at all, so the spell
        // used to land on the stack with the caster still at 20.
        const harness = makeMutationCtx("p1", [
            gameStateSeed(floatingManaBoard(toxicDeluge.id)),
        ]);
        expect(harness.state().players[0].life).toBe(20);

        await runMutation<AnnounceCastArgs, void>(
            announceCast as unknown as Handler<AnnounceCastArgs, void>,
            harness.ctx,
            {
                gameId: "game-1" as Id<"games">,
                playerId: "p1",
                cardInstanceId: "spell",
                chosenX: 3,
            }
        );

        const after = harness.state();
        // Committed, not parked: the cast is on the stack, out of hand.
        expect(after.stack).toHaveLength(1);
        expect(after.stack[0].card.id).toBe(toxicDeluge.id);
        expect(after.pendingCast).toBeUndefined();
        expect(after.players[0].hand).toHaveLength(0);
        // CR 119.4 — and the additional cost was actually PAID: the payment
        // is subtracted from the caster's life total.
        expect(after.players[0].life).toBe(17);
    });

    it("Toxic Deluge for X = 0: nothing is charged (CR 601.2b — X may be announced as zero)", async () => {
        const harness = makeMutationCtx("p1", [
            gameStateSeed(floatingManaBoard(toxicDeluge.id)),
        ]);

        await runMutation<AnnounceCastArgs, void>(
            announceCast as unknown as Handler<AnnounceCastArgs, void>,
            harness.ctx,
            {
                gameId: "game-1" as Id<"games">,
                playerId: "p1",
                cardInstanceId: "spell",
                chosenX: 0,
            }
        );

        const after = harness.state();
        expect(after.stack).toHaveLength(1);
        expect(after.players[0].life).toBe(20);
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
