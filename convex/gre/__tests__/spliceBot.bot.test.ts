// Bot reachability for Splice onto Arcane (CR 702.47, issue #2394).
//
// `.claude/rules/gre-development.md` § Bot reachability: a mechanic correct in
// the GRE and correct in the UI can still be one the Bot never plays, and
// nothing catalogue-wide catches it. Splice has TWO seams that fail silently,
// and they are separate code paths:
//
//   • ENUMERATION — `enumerateCastMoves` (`moves.ts`) must offer one
//     `cast-spell` Move per reveal the caster could pay for. The cost entries
//     are SYNTHESIZED from the caster's hand (`spliceAugmentedDefinition`), so
//     an enumerator reading the PRINTED definition sees no splice at all: no
//     freeze, no red test, the Bot simply casts every Arcane spell unspliced
//     forever.
//   • CHARGE AND MERGE — each sandbox must pay the splice cost it announced AND
//     resolve the spell with the gained text. Miss the charge and the spliced
//     Move looks free; miss the merge and the Bot pays {2}{R}{R} and evaluates
//     a board where nothing happened — a systematic UNDERvaluation of the one
//     Move that makes the card good. There are TWO sandboxes,
//     `applyMoveForSearch` (`applyMove.ts`, greedy/dominance) and
//     `applyMoveInSearch` (`search.ts`, the ISMCTS tree), so each is asserted
//     on its own: driving only the greedy one leaves the tree's charge free to
//     be deleted with the suite still green.
//
// The third seam, VALUATION (`OP_VALUERS` / `OP_BENEFICENCE`), needs nothing
// new: a spliced cast's extra value is the value of Through the Breach's own
// Ops, which are Sneak Attack's and already censused.

import { describe, it, expect } from "vitest";
import { enumerateMoves } from "../moves";
import { applyMoveForSearch } from "../applyMove";
import { applyMoveInSearch } from "../search";
import { getPlayer, resolveTopOfStack, type GameState } from "../state";
import type { Move } from "../moves";
import { spliceCostId } from "../splice";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { getCardByName } from "../../cards";
import { lavaSpike, throughTheBreach } from "../../cards/sets/chk/red";
import { grizzlyBears } from "../../cards/sets/lea";

const MOUNTAIN = getCardByName("Mountain").id;
const SPIKE = "spike";
const BREACH = "breach";
const BEARS = "bears";

/** A board where p1 holds Lava Spike (Arcane), Through the Breach and a
 *  creature, with `lands` untapped Mountains. {R} casts the Spike;
 *  {R} + {2}{R}{R} = five mana casts it with the reveal. */
function board(lands: number): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(lavaSpike.id, {
                        id: SPIKE,
                        zone: "hand",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                    makeInstance(throughTheBreach.id, {
                        id: BREACH,
                        zone: "hand",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                    makeInstance(grizzlyBears.id, {
                        id: BEARS,
                        zone: "hand",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
                battlefield: Array.from({ length: lands }, (_, i) =>
                    makeInstance(MOUNTAIN, {
                        id: `mtn${i}`,
                        zone: "battlefield",
                        controllerId: "p1",
                        ownerId: "p1",
                    })
                ),
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

/** Every enumerated Lava Spike cast, split by whether it reveals the Breach. */
function spikeCasts(state: GameState): {
    plain: Move | undefined;
    spliced: Move | undefined;
} {
    const casts = enumerateMoves(state, "p1").filter(
        (m) => m.kind === "cast-spell" && m.cardInstanceId === SPIKE
    );
    const paysSplice = (m: Move) =>
        m.kind === "cast-spell" &&
        (m.kickerPayments?.[spliceCostId(BREACH)] ?? 0) > 0;
    return {
        plain: casts.find((m) => !paysSplice(m)),
        spliced: casts.find(paysSplice),
    };
}

/** Lands tapped for the cast — the only observable of what a Move was CHARGED
 *  in a sandbox that pays out of untapped permanents rather than a pool. */
function tapped(state: GameState): number {
    return getPlayer(state, "p1").battlefield.filter((c) => c.isTapped).length;
}

/** The `choose-hand-card` decision the SPLICED text raises, which is how the
 *  search sees the gained effect at all: the kind already has a candidate
 *  generator (`CHOICE_CANDIDATE_GENERATORS`), so it becomes an in-tree decision
 *  node rather than a freeze — the reason splice needed no new choice seam. */
function spliceChoice(
    state: GameState
): { candidateIds?: string[] } | undefined {
    return (state.pendingChoices ?? []).find(
        (c) => c.kind === "choose-hand-card"
    ) as { candidateIds?: string[] } | undefined;
}

describe("Splice onto Arcane — Bot reachability (CR 702.47, issue #2394)", () => {
    it("ENUMERATES a spliced cast beside the plain one", () => {
        const { plain, spliced } = spikeCasts(board(5));
        expect(plain, "the ordinary unspliced cast disappeared").toBeDefined();
        expect(
            spliced,
            "no Move reveals Through the Breach — the Bot can never splice"
        ).toBeDefined();
        // CR 702.47b — the reveal is paid exactly once; a second payment of the
        // same card is not a Move the enumerator may offer.
        expect(
            spliced!.kind === "cast-spell"
                ? spliced!.kickerPayments![spliceCostId(BREACH)]
                : undefined
        ).toBe(1);
    });

    it("does NOT enumerate the reveal when the extra mana is not there", () => {
        // CR 702.47a — the splice cost is paid ON TOP of {R}, so one Mountain
        // pays for the Spike alone. The plain cast survives; the spliced one is
        // dropped by the ordinary mana-affordability pass every cost axis uses.
        const { plain, spliced } = spikeCasts(board(1));
        expect(plain).toBeDefined();
        expect(spliced).toBeUndefined();
    });

    it("offers no reveal at all once the splice card is not in hand", () => {
        // The control for the enumeration assertion above: the option list is
        // derived from the HAND, so removing the card must remove the Move —
        // otherwise the first test would pass on an enumerator that offers a
        // splice unconditionally.
        const state = board(5);
        const p1 = getPlayer(state, "p1");
        p1.hand = p1.hand.filter((c) => c.id !== BREACH);
        expect(spikeCasts(state).spliced).toBeUndefined();
    });

    it("the GREEDY sandbox (applyMoveForSearch) CHARGES the reveal and RUNS the gained text", () => {
        const state = board(5);
        const { plain, spliced } = spikeCasts(state);

        const afterPlain = applyMoveForSearch(state, "p1", plain!);
        const afterSpliced = applyMoveForSearch(state, "p1", spliced!);

        // CHARGE — the reveal cost four more mana, so four more lands are
        // tapped in the spliced world than in the plain one.
        expect(tapped(afterSpliced) - tapped(afterPlain)).toBe(4);
        // MERGE — CR 702.47c: the stack item carries the text it gained, and
        // the spliced world is parked on the `choose-hand-card` that text
        // raises while the plain world has no choice at all. That pairing is
        // what fails if the sandbox drops `splicedCardIds`: the Bot would pay
        // four extra mana for a board identical to the plain one.
        expect(afterSpliced.stack[0]?.splicedCardIds).toEqual([
            throughTheBreach.id,
        ]);
        expect(afterPlain.stack[0]?.splicedCardIds).toBeUndefined();
        expect(spliceChoice(afterSpliced)?.candidateIds).toEqual([BEARS]);
        expect(spliceChoice(afterPlain)).toBeUndefined();
    });

    it("the ISMCTS sandbox (applyMoveInSearch) CHARGES the reveal and RUNS the gained text", () => {
        // The tree's own apply path, which mutates in place — so each move gets
        // its own clone of the SAME board. Cloning also keeps the comparison
        // from being a state against itself (proof-of-failure shape 2).
        const state = board(5);
        const { plain, spliced } = spikeCasts(state);

        const plainWorld = structuredClone(state);
        applyMoveInSearch(plainWorld, "p1", plain!);
        const splicedWorld = structuredClone(state);
        applyMoveInSearch(splicedWorld, "p1", spliced!);

        expect(tapped(splicedWorld) - tapped(plainWorld)).toBe(4);
        expect(splicedWorld.stack[0]?.splicedCardIds).toEqual([
            throughTheBreach.id,
        ]);
        expect(plainWorld.stack[0]?.splicedCardIds).toBeUndefined();
        // Unlike the greedy sandbox, the tree leaves the spell ON the stack and
        // resolves it as a later node, so the gained text is proved by
        // resolving here: the merged script raises its choice, the printed one
        // finishes with none.
        resolveTopOfStack(splicedWorld);
        resolveTopOfStack(plainWorld);
        expect(spliceChoice(splicedWorld)?.candidateIds).toEqual([BEARS]);
        expect(spliceChoice(plainWorld)).toBeUndefined();
    });
});
