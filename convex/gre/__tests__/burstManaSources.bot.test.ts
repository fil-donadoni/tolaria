// Issue #3027 — a mana source's YIELD, not one mana per source.
//
// `planManaPayment` (moves.ts) used to build one `PlanSource` per untapped
// permanent and let it pay exactly ONE pip, while the castability census it
// mirrors (`getProducibleManaUnits` → `coloredCostLeftover`, rules.ts) has
// counted one unit per INDIVIDUAL mana since issue #132. Measured on
// `98ed936f4`, one untapped Black Lotus:
//
//   {U}          → [{ cardInstanceId: "lotus", manaChoiceIndex: 1 }]
//   {U}{U}       → null      ← and `getLegalActions` said "cast"
//   {1}{U}       → null
//   {U}{U}{U}    → null
//   Sol Ring {2} → null
//
// so the Bot could never cast a two-mana spell off any ritual-shaped burst
// source, and `enumerateCastMoves` silently dropped the move while the human
// was offered the Cast.
//
// The model now: the permanent is still removed from the source pool the
// instant it is used — "one permanent, one activation" stays true BY
// CONSTRUCTION, which is what the review-round-3 double-tap regression cost to
// learn — and the surplus of the activation goes to a plan-local floating pool
// every later pip is paid from first. There is no partly-spent source.
//
// The wire is unchanged: `ManaTap[]` is one entry per ACTIVATION, so a
// three-mana activation is ONE entry covering three pips.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { enumerateMoves, planManaPayment, type Move } from "../moves";
import { getLegalActions, maxAffordableX } from "../rules";
import { getPlayer } from "../state";
import { tapSourceIntoPayment, tryAutoCommitPendingCast } from "../../game";
import type { CardInstanceState, GameState } from "../state";

const LOTUS = getCardByName("Black Lotus").id; // {T}, Sac: Add three of one color
const SOL_RING = getCardByName("Sol Ring").id; // {T}: Add {C}{C}
const ISLAND = getCardByName("Island").id;
const MOX_SAPPHIRE = getCardByName("Mox Sapphire").id;
const MOX_JET = getCardByName("Mox Jet").id;
const URZA = getCardByName("Urza, Lord High Artificer").id;
const ANCESTRAL = getCardByName("Ancestral Recall").id; // {U}
const BRAIN_FREEZE = getCardByName("Brain Freeze").id; // {1}{U}
const COUNTERSPELL = getCardByName("Counterspell").id; // {U}{U}
const LORD_OF_ATLANTIS = getCardByName("Lord of Atlantis").id; // {U}{U}, no targets
const CITY_OF_BRASS = getCardByName("City of Brass").id; // {T}: Add one of any color
const FIREBALL = getCardByName("Fireball").id; // {X}{R}

function permanent(defId: string, id: string): CardInstanceState {
    return makeInstance(defId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isTapped: false,
        isSummoningSick: false,
    });
}

function handCard(defId: string, id: string): CardInstanceState {
    return makeInstance(defId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
}

function position(
    battlefield: CardInstanceState[],
    hand: CardInstanceState[] = []
): GameState {
    const player = makePlayer("p1", { hand, battlefield });
    return {
        ...makeState({ players: [player, makePlayer("p2")] }),
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        stack: [],
    };
}

/** Every PHYSICAL permanent a plan taps — the same split `runTapPlan`
 *  (src/lib/ai/executor.ts) and `applyTapPlan` (applyMove.ts) apply. */
function tappedPermanentIds(
    plan: readonly {
        cardInstanceId: string;
        abilityId?: string;
        tapOtherIds?: string[];
    }[]
): string[] {
    const ids: string[] = [];
    for (const tap of plan) {
        if (tap.abilityId) {
            ids.push(...(tap.tapOtherIds ?? []));
            continue;
        }
        ids.push(tap.cardInstanceId);
    }
    return ids;
}

describe("burst mana sources pay more than one pip (issue #3027)", () => {
    // The measurement in the issue body, as an assertion. The {U} case already
    // passed before the fix; the other three returned null.
    it.each([
        ["{U}", { U: 1 }],
        ["{U}{U}", { U: 2 }],
        ["{1}{U}", { U: 1, X: 1 }],
        ["{U}{U}{U}", { U: 3 }],
    ])(
        "one Black Lotus pays %s with a SINGLE activation entry",
        (_label, cost) => {
            const state = position([permanent(LOTUS, "lotus")]);
            expect(planManaPayment(state, state.players[0], cost)).toEqual([
                { cardInstanceId: "lotus", manaChoiceIndex: 1 },
            ]);
        }
    );

    // The other half of the model: yield-aware must not become yield-unbounded.
    it("one Black Lotus cannot pay a FOURTH pip", () => {
        const state = position([permanent(LOTUS, "lotus")]);
        expect(planManaPayment(state, state.players[0], { U: 4 })).toBeNull();
        expect(
            planManaPayment(state, state.players[0], { U: 3, X: 1 })
        ).toBeNull();
    });

    // "three mana of ONE color" — the yield belongs to the chosen OPTION, not
    // to the source, so a Lotus never pays two different coloured pips.
    it("one Black Lotus cannot pay {U}{B} — the yield is one option's, not the source's", () => {
        const state = position([permanent(LOTUS, "lotus")]);
        expect(
            planManaPayment(state, state.players[0], { U: 1, B: 1 })
        ).toBeNull();
    });

    it("Sol Ring pays {2} off one tap and stops at {3}", () => {
        const state = position([permanent(SOL_RING, "ring")]);
        expect(planManaPayment(state, state.players[0], { X: 2 })).toEqual([
            { cardInstanceId: "ring" },
        ]);
        expect(planManaPayment(state, state.players[0], { X: 3 })).toBeNull();
    });

    // The greedy must not sacrifice a Lotus for a pip a cheaper source covers.
    // The colour-count tie-break alone does not decide this: City of Brass and
    // Black Lotus both advertise all five colours, so before the YIELD term was
    // added to the (rank, colour-count, yield) key the pick fell to "first
    // index wins" and the Lotus went first in the declaration order below. On a
    // board of one-mana sources every yield is 1, so the new term never fires
    // and ordinary selection is byte-identical.
    it("spends the one-mana source, not the Lotus, when both offer the colour", () => {
        const state = position([
            permanent(LOTUS, "lotus"),
            permanent(CITY_OF_BRASS, "city"),
        ]);
        expect(planManaPayment(state, state.players[0], { U: 1 })).toEqual([
            { cardInstanceId: "city", manaChoiceIndex: 1 },
        ]);
    });

    // The over-spend AC's mixed case: the same permanent is reachable BOTH as
    // its own plain tap and as another ability's fodder (Urza's "Tap an
    // untapped artifact you control: Add {U}"), on a board that also carries a
    // burst source. No plan may spend one physical permanent twice.
    it("never spends one permanent twice when it is reachable as a tap AND as fodder", () => {
        for (const order of [
            [MOX_SAPPHIRE, MOX_JET, URZA, LOTUS],
            [URZA, MOX_SAPPHIRE, LOTUS, MOX_JET],
            [LOTUS, URZA, MOX_JET, MOX_SAPPHIRE],
        ]) {
            const battlefield = order.map((defId, i) =>
                permanent(defId, `perm${i}`)
            );
            const state = position(battlefield);
            const costs: Record<string, number>[] = [
                { U: 2 },
                { U: 3 },
                { U: 4 },
                { U: 1, X: 3 },
                { X: 5 },
            ];
            for (const cost of costs) {
                const plan = planManaPayment(state, state.players[0], cost);
                if (plan === null) continue;
                const tapped = tappedPermanentIds(plan);
                expect(new Set(tapped).size).toBe(tapped.length);
                // CR 602.1 — a `tapOtherFilter` activation never taps its own
                // source.
                for (const tap of plan) {
                    expect(tap.tapOtherIds ?? []).not.toContain(
                        tap.cardInstanceId
                    );
                }
            }
        }
    });

    // The issue's headline position, end to end through the Bot's own move
    // enumeration: before the fix `enumerateMoves` offered the Ancestral
    // Recall cast and NOTHING else.
    it("enumerates every cast a lone Black Lotus funds", () => {
        const state = position(
            [permanent(LOTUS, "lotus")],
            [
                handCard(ANCESTRAL, "ancestral"),
                handCard(BRAIN_FREEZE, "brainFreeze"),
                handCard(COUNTERSPELL, "counterspell"),
            ]
        );
        // Counterspell needs a spell to target (CR 601.2c) — without one it is
        // correctly unenumerable for a reason that has nothing to do with
        // mana, which would make this assertion pass for the wrong reason.
        pushSpell(state, ANCESTRAL, "p2");
        const castIds = new Set(
            enumerateMoves(state, "p1")
                .filter((m: Move) => m.kind === "cast-spell")
                .map((m) => (m as { cardInstanceId: string }).cardInstanceId)
        );
        expect(castIds).toEqual(
            new Set(["ancestral", "brainFreeze", "counterspell"])
        );
    });

    // The wire AC: the plan the executor would submit is accepted by the REAL
    // server primitives, in the order `tapForPayment`'s handler fires them —
    // ONE activation covering TWO pips, with no announce-then-abort. The
    // project has no convex-test harness, so this drives the same shared
    // primitives the mutation calls (the `moves-integration.bot.test.ts`
    // precedent), not a second copy of their mechanics.
    it("the emitted plan commits the cast through the server's own tap primitives", () => {
        const state = position(
            [permanent(LOTUS, "lotus")],
            [handCard(LORD_OF_ATLANTIS, "lord")]
        );
        state.phase = "PRECOMBAT_MAIN";

        const move = enumerateMoves(state, "p1").find(
            (m): m is Extract<Move, { kind: "cast-spell" }> =>
                m.kind === "cast-spell" && m.cardInstanceId === "lord"
        );
        expect(move).toBeDefined();
        // One entry for a two-pip cost — the whole point of the yield model.
        // A per-pip plan would submit the Lotus twice and the second tap would
        // be rejected ("Cannot untap a sacrifice ability").
        expect(move!.tapPlan).toEqual([
            { cardInstanceId: "lotus", manaChoiceIndex: 1 },
        ]);

        state.pendingCast = {
            playerId: "p1",
            cardInstanceId: "lord",
            manaCost: { U: 2 },
            tappedLandIds: [],
        };
        for (const tap of move!.tapPlan) {
            const player = getPlayer(state, "p1");
            const card = player.battlefield.find(
                (c) => c.id === tap.cardInstanceId
            )!;
            tapSourceIntoPayment(
                state,
                player,
                card,
                tap.manaChoiceIndex,
                state.pendingCast!.tappedLandIds
            );
            tryAutoCommitPendingCast(state, "p1");
            if (!state.pendingCast) break;
        }

        // Committed: the spell is on the stack and nothing is still pending.
        expect(state.pendingCast).toBeUndefined();
        expect(state.stack.map((s) => s.id)).toContain("lord");
        // CR 500.4 — the third mana is simply floating, exactly as it is when a
        // human taps a Lotus for a two-mana spell.
        expect(getPlayer(state, "p1").manaPool.U).toBe(1);
        // The Lotus paid its sacrifice cost once.
        expect(
            getPlayer(state, "p1").battlefield.map((c) => c.id)
        ).not.toContain("lotus");
    });

    // The X ceiling already answered from the unit-counting census; this pins
    // that the PLANNER now reaches the same X instead of refusing it, which is
    // what `enumerateCastMoves` re-checks before emitting the move.
    it("the X ceiling a Black Lotus funds is reachable by the planner and the enumerator", () => {
        const state = position(
            [permanent(LOTUS, "lotus")],
            [handCard(FIREBALL, "fireball")]
        );
        const live = state.players[0];
        expect(getLegalActions(state, live, live.hand[0])).toContain("cast");
        // {X}{R} off three mana of one colour: X = 2.
        expect(maxAffordableX(live, live.hand[0], state)).toBe(2);
        expect(planManaPayment(state, live, { R: 1, X: 2 })).toEqual([
            { cardInstanceId: "lotus", manaChoiceIndex: 3 },
        ]);
        const announcedX = enumerateMoves(state, "p1")
            .filter(
                (m: Move) =>
                    m.kind === "cast-spell" &&
                    (m as { cardInstanceId: string }).cardInstanceId ===
                        "fireball"
            )
            .map((m) => (m as { chosenX?: number }).chosenX);
        expect(Math.max(...announcedX.map((x) => x ?? 0))).toBe(2);
    });
});
