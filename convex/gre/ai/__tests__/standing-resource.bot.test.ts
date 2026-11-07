// A standing resource is priced while it is kept (issue #8294).
//
// Four readings, each exercised on its own seam:
//   1. `forcedChoiceAnswer` answers a mandatory pick its script discards
//      (CR 701.9), so the line that raises one is played out instead of scored
//      mid-resolution.
//   2. `standingCounterUses` counts the activations a permanent's own counters
//      still pay for (CR 122.1), `walkerOutlastsNextAttack` reads whether a
//      planeswalker lives to activate again (CR 120.3c), and `evaluate` prices
//      both.
//   3. `heldStormCopiesWorth` prices the copies a held storm spell would gain
//      from the spells still castable ahead of it (CR 702.40a).
//   4. `animationForfeitsBiggerAttack` reads a crew (CR 702.122a) that gives up
//      at least as much attack as the body it buys.
//
// Cards are FIXTURES; nothing under test reads a card name.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup.helper";
import { evaluate } from "../../evaluate";
import { enumerateMoves } from "../../moves";
import { advanceToDecision, applyMoveInSearch } from "../../search";
import type { CardInstanceState, GameState, PendingChoice } from "../../state";
import {
    animationForfeitsBiggerAttack,
    effectiveAbilityOf,
    isIdleCounterSpend,
} from "../abilityTiming";
import { findBladeScenario } from "../blade/registry";
import { buildBladeState } from "../blade/build";
import { seatPlayerId } from "../blade/matcher";
import { forcedChoiceAnswer } from "../choiceCandidates";
import { isDominatedNoOpMove } from "../dominance";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import { candidateFeatures } from "../verdicts/evalPairs";
import { firesStormBeforeItsSpells, heldStormCopiesWorth } from "../heldStorm";
import {
    standingCounterUses,
    standingCounterWorth,
    walkerOutlastsNextAttack,
} from "../standingCounters";

const LATENT = DEFAULT_EVAL_WEIGHTS.latent;

function mine(
    name: string,
    id: string,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return makeInstance(getCardByName(name).id, {
        controllerId: "p1",
        ownerId: "p1",
        id,
        isSummoningSick: false,
        isTapped: false,
        ...overrides,
    });
}

function stateWith(
    battlefield: CardInstanceState[],
    hand: CardInstanceState[] = [],
    phase: GameState["phase"] = "BEGINNING_OF_COMBAT"
): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield, hand }),
            makePlayer("p2", {}),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase,
    });
    return state;
}

describe("a pick its script discards is answered in the search (CR 701.9)", () => {
    const army =
        "standing resource: Liliana of the Veil holds her -2 against an army";
    const plusOne = (state: GameState, bot: string) => {
        const move = enumerateMoves(state, bot).find(
            (m) =>
                m.kind === "activate-ability" &&
                m.abilityId === "liliana-veil-plus1"
        );
        if (!move) throw new Error("+1 not offered");
        return move;
    };

    it("plays the discard out instead of stopping the walk mid-resolution", () => {
        const state = buildBladeState(findBladeScenario(army)!);
        const bot = seatPlayerId(state, "me");
        const opp = seatPlayerId(state, "opp");
        applyMoveInSearch(state, bot, plusOne(state, bot));
        for (let i = 0; i < 4 && state.stack.length > 0; i++) {
            const pid = advanceToDecision(state);
            if (!pid) break;
            applyMoveInSearch(state, pid, { kind: "pass" });
        }
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players.find((p) => p.id === opp)?.hand).toHaveLength(2);
    });

    // The search ties these two inside its rollouts (issue #8480), so the order
    // the walker's kept loyalty buys is pinned here, one ply deep. Only the sign
    // is asserted: a refit moves the gap, never its direction.
    it("ranks the plus above the minus on the opponent, one ply deep (CR 606.4)", () => {
        const state = buildBladeState(findBladeScenario(army)!);
        const bot = seatPlayerId(state, "me");
        const opp = seatPlayerId(state, "opp");
        const minusOnOpponent = enumerateMoves(state, bot).find(
            (m) =>
                m.kind === "activate-ability" &&
                m.abilityId === "liliana-veil-minus2" &&
                m.targets.some((t) => t.id === opp)
        );
        if (!minusOnOpponent) throw new Error("-2 not offered");
        expect(
            candidateFeatures(state, bot, plusOne(state, bot)).policyValue
        ).toBeGreaterThan(
            candidateFeatures(state, bot, minusOnOpponent).policyValue
        );
    });

    it("leaves a hand pick its script does not discard to the old stop", () => {
        const state = buildBladeState(findBladeScenario(army)!);
        const answer = forcedChoiceAnswer(state, {
            kind: "choose-hand-card",
            stackItemId: "absent",
            step: 0,
            choiceId: "c1",
            playerId: seatPlayerId(state, "me"),
            zone: "hand",
            count: 1,
            prompt: "pick",
        } as PendingChoice);
        expect(answer).toBeNull();
    });
});

describe("a loyalty minus that does nothing is dominated (CR 606.4)", () => {
    const angel =
        "standing resource: Liliana of the Veil keeps the Serra Angel and her loyalty";

    it("proves the minus with no creature to take, never the plus", () => {
        const state = buildBladeState(findBladeScenario(angel)!);
        const bot = seatPlayerId(state, "me");
        const read = (abilityId: string) =>
            enumerateMoves(state, bot)
                .filter(
                    (m) =>
                        m.kind === "activate-ability" &&
                        m.abilityId === abilityId
                )
                .map((m) => isDominatedNoOpMove(state, bot, m));
        expect(read("liliana-veil-minus2")).toEqual([true, true]);
        expect(read("liliana-veil-plus1")).toEqual([false]);
    });
});

describe("counters that pay their own permanent's abilities (CR 122.1)", () => {
    it("counts one use per charge the ability costs", () => {
        const jitte = mine("Umezawa's Jitte", "jitte", {
            counters: { charge: 3 },
        });
        expect(standingCounterUses(jitte)).toBe(3);
    });

    it("has nothing to price with no counter on it", () => {
        expect(standingCounterUses(mine("Umezawa's Jitte", "jitte"))).toBe(0);
    });

    it("leaves a creature's body counters to its power and toughness", () => {
        const ballista = mine("Walking Ballista", "ballista", {
            counters: { "+1/+1": 4 },
        });
        expect(standingCounterUses(ballista)).toBe(0);
    });

    it("reads a walker by whether the next attack can finish it", () => {
        const walker = (loyalty: number) =>
            mine("Liliana of the Veil", "liliana", {
                counters: { loyalty },
            });
        const elves = ["e1", "e2", "e3", "e4"].map((id) =>
            makeInstance(getCardByName("Llanowar Elves").id, {
                controllerId: "p2",
                ownerId: "p2",
                id,
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", {}),
                makePlayer("p2", { battlefield: elves }),
            ],
        });
        expect(walkerOutlastsNextAttack(state, walker(5))).toBe(true);
        expect(walkerOutlastsNextAttack(state, walker(4))).toBe(false);
        expect(standingCounterWorth(state, walker(5), LATENT)).toBeGreaterThan(
            0
        );
        expect(standingCounterWorth(state, walker(4), LATENT)).toBe(0);
    });

    it("moves the leaf by one card's worth per counter", () => {
        const withCharges = (charge: number) =>
            stateWith([
                mine("Umezawa's Jitte", "jitte", { counters: { charge } }),
            ]);
        const gap =
            evaluate(withCharges(2), "p1", DEFAULT_EVAL_WEIGHTS) -
            evaluate(withCharges(1), "p1", DEFAULT_EVAL_WEIGHTS);
        expect(gap).toBeCloseTo(
            standingCounterWorth(
                withCharges(1),
                mine("Umezawa's Jitte", "jitte", { counters: { charge: 1 } }),
                LATENT
            )
        );
        expect(gap).toBeGreaterThan(0);
    });
});

describe("a counter spent with nothing left for it to do", () => {
    const jitte = mine("Umezawa's Jitte", "jitte", { counters: { charge: 1 } });
    const ability = effectiveAbilityOf(jitte, "umezawas-jitte-modes")!;

    it("is idle after combat with an empty stack", () => {
        const state = stateWith([jitte], [], "POSTCOMBAT_MAIN");
        expect(isIdleCounterSpend(state, ability)).toBe(true);
    });

    it("is live while a fight is still ahead", () => {
        const state = stateWith([jitte], [], "DECLARE_BLOCKERS");
        expect(isIdleCounterSpend(state, ability)).toBe(false);
    });
});

describe("a held storm spell (CR 702.40a)", () => {
    const storm = () => mine("Tendrils of Agony", "storm", { zone: "hand" });
    const ritual = (id: string) => mine("Dark Ritual", id, { zone: "hand" });
    const player = (hand: CardInstanceState[]) => makePlayer("p1", { hand });
    const stormState = stateWith([]);

    it("is worth a copy per spell still castable ahead of it", () => {
        const one = heldStormCopiesWorth(
            stormState,
            player([storm(), ritual("r1")]),
            4,
            LATENT
        );
        const two = heldStormCopiesWorth(
            stormState,
            player([storm(), ritual("r1"), ritual("r2")]),
            4,
            LATENT
        );
        expect(one).toBeGreaterThan(0);
        expect(two).toBeCloseTo(one * 2);
    });

    it("gains nothing from a spell the mana cannot reach", () => {
        const hand = [storm(), mine("Serra Angel", "angel", { zone: "hand" })];
        expect(heldStormCopiesWorth(stormState, player(hand), 4, LATENT)).toBe(
            0
        );
    });

    it("reads a storm spell with nothing left to follow as ready to fire", () => {
        const card = storm();
        expect(
            firesStormBeforeItsSpells(stormState, player([card]), card, 4)
        ).toBe(false);
        expect(
            firesStormBeforeItsSpells(
                stormState,
                player([card, ritual("r1")]),
                card,
                4
            )
        ).toBe(true);
    });
});

describe("crew gives up an attack (CR 702.122a)", () => {
    const copter = mine("Smuggler's Copter", "copter");
    const crew = effectiveAbilityOf(copter, "smugglers-copter-crew")!;
    const reads = (...others: CardInstanceState[]) =>
        animationForfeitsBiggerAttack(
            stateWith([copter, ...others]),
            "p1",
            copter,
            crew
        );

    it("is pointless when the only payer swings for more than the body", () => {
        expect(reads(mine("Serra Angel", "angel"))).toBe(true);
    });

    it("is live when the payer swings for less", () => {
        expect(reads(mine("Grizzly Bears", "bears"))).toBe(false);
    });

    it("is live when a payer that could not attack anyway covers it", () => {
        expect(
            reads(
                mine("Serra Angel", "angel"),
                mine("Llanowar Elves", "elves", { isSummoningSick: true })
            )
        ).toBe(false);
    });
});
