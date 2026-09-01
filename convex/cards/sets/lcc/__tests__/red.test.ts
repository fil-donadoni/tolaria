// LCC (Lost Caverns of Ixalan Commander) — red card behavior tests (ADR 0043
// colour split). Each describe block cites the CR section it exercises.
//
// Broadside Bombardiers (issue #2375) is the card that shipped Boast
// (CR 702.142). Its two halves are tested where each actually lives:
//   * the KEYWORD's activation-timing rule (CR 702.142a) on the server's
//     authoritative throw. Its two other surfaces are asserted where their
//     suites live: the BOT enumerator in `red.bot.test.ts` (importing
//     `gre/moves` from a plain `*.test.ts` puts a bot-only module in the app
//     suite — `bot-suite-boundary.test.ts`), and the CLIENT affordance in
//     `src/lib/__tests__/boastActivationAffordance.test.ts` (a file in the
//     convex project may not import `src/**`);
//   * the DAMAGE amount, which reads the cost-sacrificed permanent's mana value
//     as last known information (CR 608.2h) off the stack item's
//     `additionalSacrificeSnapshot`, driven through the REAL cost-payment path
//     rather than a hand-stamped snapshot.
// The `sacrificed` EffectValue member's own grammar coverage (0-cost artifact,
// X-cost last-cast mv, `plus` default, `read: "power"`, missing snapshot) lives
// with the interpreter, per the per-Op regime.

import { describe, it, expect } from "vitest";
import { broadsideBombardiers } from "../red";
import { grizzlyBears } from "../../lea/green";
import { hillGiant } from "../../lea/red";
import { blackLotus } from "../../lea/colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { assertActivationTimingLegal } from "../../../../game";
import { applyActivationCostsForSearch } from "../../../../gre/applyMove";
import { buildActivatedAbilityStackItem } from "../../../../gre/activationCommit";
import { resolveTopOfStack } from "../../../../gre/state";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../../gre/state";

const BOAST_ID = "broadside-bombardiers-boast-damage";
const boast = broadsideBombardiers.activatedAbilities!.find(
    (a) => a.id === BOAST_ID
)!;

/** Broadside Bombardiers on p1's battlefield, plus one sacrificeable victim
 *  (Grizzly Bears, mana value 2 — a non-trivial value, so a snapshot that
 *  silently resolves to 0 is visibly wrong). */
function board(sourceOverrides: Partial<CardInstanceState> = {}) {
    const source = makeInstance(broadsideBombardiers.id, {
        id: "bombardiers",
        controllerId: "p1",
        ownerId: "p1",
        ...sourceOverrides,
    });
    const victim = makeInstance(grizzlyBears.id, {
        id: "victim",
        controllerId: "p1",
        ownerId: "p1",
    });
    const p1 = makePlayer("p1", { battlefield: [source, victim] });
    const state = makeState({
        players: [p1, makePlayer("p2")],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "POSTCOMBAT_MAIN",
    });
    return { state, source, victim };
}

describe("Broadside Bombardiers — Boast (CR 702.142a) activation timing, issue #2375", () => {
    // CR 702.142a — "Activate only if this creature attacked this turn and only
    // once each turn." Both clauses, plus the turn rollover that clears them,
    // against the server's authoritative throw.
    it("assertActivationTimingLegal: illegal before attacking, legal after, illegal a second time, legal again next turn", () => {
        const { state, source } = board();

        // Never attacked — CR 702.142a's first clause.
        expect(() => assertActivationTimingLegal(state, source, boast)).toThrow(
            /attacked this turn/i
        );

        // Attacked this turn (the flag `gre/combat.ts` stamps at
        // declare-attackers, CR 508.1) — legal.
        source.hasAttackedThisTurn = true;
        expect(() =>
            assertActivationTimingLegal(state, source, boast)
        ).not.toThrow();

        // CR 702.142a's second clause (CR 602.5b) — once each turn.
        source.activationsThisTurn = { [BOAST_ID]: 1 };
        expect(() => assertActivationTimingLegal(state, source, boast)).toThrow(
            /once each turn/i
        );

        // Next turn: CLEANUP (CR 514.2) clears both the attack flag and the
        // activation tally. Attacking again re-opens the ability.
        source.activationsThisTurn = {};
        source.hasAttackedThisTurn = undefined;
        expect(() => assertActivationTimingLegal(state, source, boast)).toThrow(
            /attacked this turn/i
        );
        source.hasAttackedThisTurn = true;
        expect(() =>
            assertActivationTimingLegal(state, source, boast)
        ).not.toThrow();
    });
});

describe("Broadside Bombardiers — boast damage reads the cost-sacrificed permanent's mana value (CR 608.2h), issue #2375", () => {
    /** Pays the activation's costs through the SEARCH cost path — the same
     *  path the bot's ISMCTS sandbox uses — then pushes the ability's stack
     *  item through the shared commit authority, exactly as `search.ts` does.
     *  Returns the resolved damage victim's life. */
    function boastAt(
        state: GameState,
        source: CardInstanceState,
        victimId: string
    ) {
        const costOut: {
            additionalSacrificeSnapshot?: StackItem["additionalSacrificeSnapshot"];
        } = {};
        const paid = applyActivationCostsForSearch(
            state,
            "p1",
            {
                kind: "activate-ability",
                cardInstanceId: source.id,
                abilityId: BOAST_ID,
                targets: [{ type: "player", id: "p2" }],
                confirmTargets: false,
                tapPlan: [],
                costPicks: { sacrificeIds: [victimId] },
            },
            costOut
        );
        expect(paid).toBe(true);
        state.stack.push(
            buildActivatedAbilityStackItem(source, {
                castById: "p1",
                abilityId: BOAST_ID,
                targets: [{ type: "player", id: "p2" }],
                ...(costOut.additionalSacrificeSnapshot
                    ? {
                          additionalSacrificeSnapshot:
                              costOut.additionalSacrificeSnapshot,
                      }
                    : {}),
            })
        );
        resolveTopOfStack(state);
        return costOut;
    }

    // The card's own line: "2 plus the sacrificed permanent's mana value".
    // Grizzly Bears is mana value 2, so 4 damage.
    it("deals 2 plus the sacrificed creature's mana value, with the snapshot stamped by the search's own cost path", () => {
        const { state, source } = board();
        source.hasAttackedThisTurn = true;

        const costOut = boastAt(state, source, "victim");

        // The seam this closes: the search used to remove the victim without
        // ever recording it, so the ability resolved for NOTHING in the very
        // tree that scores the move.
        expect(costOut.additionalSacrificeSnapshot?.mv).toBe(2);
        expect(state.players[0].battlefield.map((c) => c.id)).not.toContain(
            "victim"
        );
        expect(state.players[0].graveyard.map((c) => c.id)).toContain("victim");
        expect(state.players[1].life).toBe(20 - 4);
    });

    // A 0-cost artifact is the boundary the `plus` literal must survive: the
    // read is falsy, the printed 2 is not.
    it("still deals the printed 2 when the sacrificed permanent's mana value is 0", () => {
        const { state, source } = board();
        source.hasAttackedThisTurn = true;
        const lotus = makeInstance(blackLotus.id, {
            id: "lotus",
            controllerId: "p1",
            ownerId: "p1",
        });
        state.players[0].battlefield.push(lotus);

        const costOut = boastAt(state, source, "lotus");

        expect(costOut.additionalSacrificeSnapshot?.mv).toBe(0);
        expect(state.players[1].life).toBe(20 - 2);
    });

    // A larger mana value scales the damage — the amount is READ, not a
    // constant that happens to match the 2-drop above.
    it("scales with the sacrificed permanent's mana value", () => {
        const { state, source } = board();
        source.hasAttackedThisTurn = true;
        const giant = makeInstance(hillGiant.id, {
            id: "giant",
            controllerId: "p1",
            ownerId: "p1",
        });
        state.players[0].battlefield.push(giant);

        const costOut = boastAt(state, source, "giant");

        expect(costOut.additionalSacrificeSnapshot?.mv).toBe(4);
        expect(state.players[1].life).toBe(20 - 6);
    });
});
