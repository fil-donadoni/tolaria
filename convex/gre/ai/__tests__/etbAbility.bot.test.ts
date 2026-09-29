// An ETB Ability is spent on entering (issue #4758, PRD #4754; CONTEXT.md
// "ETB Ability"): CR 603.6a "When [this object] enters" — counted in a card's
// latent Card Value (hand, library, graveyard, playable exile) and never in
// its realized one on the battlefield, where what it did is already in the
// state it left behind.
//
// Three seams carry it, and each has its pins here:
//
//  1. the value model (`cardScriptValue.ts`): the realized reading skips an
//     ETB Ability, the latent one counts it undiscounted, and a creature
//     whose own ETB sacrifices it keeps no latent body;
//  2. the 1-ply policy probe (`policyProbeState`, the rollout policy AND the
//     Eval Pair bridge the Weight Fit reads): a cast settles the triggers its
//     resolution puts on the stack, the mover's own target announcement
//     included (CR 603.3d), so what the ETB did is in the scored state;
//  3. the Eval Pairs the issue names — the board after the right move
//     against the board after the other, through that same probe.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import type { ScenarioSpec } from "../../../debugScenarioSpec";
import type { GameState } from "../../state";
import { cloneGameState } from "../../clone";
import {
    enumerateMoves,
    enumerateRaisedTargetMoves,
    type Move,
} from "../../moves";
import { resolveTopOfStack } from "../../state";
import { evaluate } from "../../evaluate";
import { applyMoveInSearch, policyValue } from "../../search";
import { buildPositionFromSpec } from "../blade/build";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import {
    dslAbilityScriptValue,
    dslRealizedAbilityScriptValue,
    etbSelfSacrificeWeight,
} from "../cardScriptValue";
import { cardValueById, creatureValueRaw } from "../../cardValue";
import { manaValue } from "../../constants";

type SpecCard = ScenarioSpec["cards"][number];

function position(cards: SpecCard[]): GameState {
    return buildPositionFromSpec({
        cards,
        phase: "PRECOMBAT_MAIN",
        turn: 5,
        landCount: 4,
        libraryCount: 20,
    });
}

/** The 1-ply policy value of `pick` in `state` for the player to act — the
 *  exact number the rollout policy and the Eval Pair bridge read. */
function policyOf(state: GameState, pick: (m: Move) => boolean): number {
    const me = state.activePlayerId;
    const move = enumerateMoves(state, me).find(pick);
    if (!move) throw new Error("no such move in this position");
    const probe = cloneGameState(state);
    applyMoveInSearch(probe, me, move);
    return policyValue(probe, me, move, DEFAULT_EVAL_WEIGHTS, me);
}

const isPass = (m: Move) => m.kind === "pass";

function castOf(state: GameState, name: string): (m: Move) => boolean {
    const id = getCardByName(name).id;
    const inHand = state.players
        .flatMap((p) => p.hand)
        .find((c) => (c.card as { id?: string }).id === id);
    if (!inHand) throw new Error(`${name} is not in a hand`);
    return (m) => m.kind === "cast-spell" && m.cardInstanceId === inHand.id;
}

const inHand = (name: string): SpecCard => ({
    name,
    owner: "me",
    zone: "hand",
});
const onBoard = (name: string, owner: "me" | "opp"): SpecCard => ({
    name,
    owner,
    zone: "battlefield",
    summoningSick: false,
});

describe("Eval Pairs — an ETB Ability is spent on entering (issue #4758)", () => {
    it("Flametongue Kavu held beats Flametongue Kavu cast with no opposing creature (its ETB can only hit its own side)", () => {
        const s = position([
            inHand("Flametongue Kavu"),
            onBoard("Grizzly Bears", "me"),
        ]);
        expect(policyOf(s, isPass)).toBeGreaterThan(
            policyOf(s, castOf(s, "Flametongue Kavu"))
        );
    });

    it("Flametongue Kavu cast into an opposing creature worth killing beats holding it", () => {
        const s = position([
            inHand("Flametongue Kavu"),
            onBoard("Serra Angel", "opp"),
        ]);
        expect(policyOf(s, castOf(s, "Flametongue Kavu"))).toBeGreaterThan(
            policyOf(s, isPass)
        );
    });

    it("Skyclave Apparition held beats casting it with nothing to exile", () => {
        const s = position([inHand("Skyclave Apparition")]);
        expect(policyOf(s, isPass)).toBeGreaterThan(
            policyOf(s, castOf(s, "Skyclave Apparition"))
        );
    });

    it("Skyclave Apparition cast into a permanent worth exiling beats holding it", () => {
        const s = position([
            inHand("Skyclave Apparition"),
            onBoard("Hill Giant", "opp"),
        ]);
        expect(policyOf(s, castOf(s, "Skyclave Apparition"))).toBeGreaterThan(
            policyOf(s, isPass)
        );
    });
});

describe("an ETB Ability in flight is credited once (issue #4758)", () => {
    // The window between entering and resolving: the trigger is spent from
    // the permanent's realized worth and not yet in the state it leaves
    // behind. Every probe that stops short of resolution scores it.

    /** Cast `name`, resolve the spell, and announce its ETB's target with the
     *  first legal selection — the trigger is then on the stack, unresolved. */
    function inFlight(cards: SpecCard[], name: string): GameState {
        const s = position(cards);
        const me = s.activePlayerId;
        const cast = enumerateMoves(s, me).find(castOf(s, name))!;
        applyMoveInSearch(s, me, cast);
        resolveTopOfStack(s);
        const announce = enumerateRaisedTargetMoves(s, me)[0];
        if (announce) applyMoveInSearch(s, me, announce);
        return s;
    }

    function withoutStack(s: GameState): GameState {
        const bare = cloneGameState(s);
        bare.stack = [];
        return bare;
    }

    it("a targeted ETB on the stack is worth its script to its controller", () => {
        const s = inFlight(
            [inHand("Flametongue Kavu"), onBoard("Serra Angel", "opp")],
            "Flametongue Kavu"
        );
        expect(s.stack).toHaveLength(1);
        expect(s.stack[0].targets?.length).toBe(1);
        const me = s.activePlayerId;
        expect(evaluate(s, me)).toBeGreaterThan(evaluate(withoutStack(s), me));
    });

    it("an ETB announced with no legal target is worth nothing", () => {
        const s = inFlight(
            [inHand("Skyclave Apparition")],
            "Skyclave Apparition"
        );
        expect(s.stack).toHaveLength(1);
        expect(s.stack[0].targets?.length ?? 0).toBe(0);
        const me = s.activePlayerId;
        expect(evaluate(s, me)).toBe(evaluate(withoutStack(s), me));
    });

    it("Eval Pair: Ravenous Rats cast into an opponent holding cards beats holding it — its discard waits on the opponent's pick", () => {
        const s = position([
            inHand("Ravenous Rats"),
            { name: "Grizzly Bears", owner: "opp", zone: "hand" },
            { name: "Hill Giant", owner: "opp", zone: "hand" },
        ]);
        expect(policyOf(s, castOf(s, "Ravenous Rats"))).toBeGreaterThan(
            policyOf(s, isPass)
        );
    });
});

describe("value model — latent vs realized faces (issue #4758)", () => {
    it("the realized reading leaves an ETB Ability out; the latent one counts it", () => {
        const ftk = getCardByName("Flametongue Kavu");
        expect(dslRealizedAbilityScriptValue(ftk)).toBe(0);
        expect(dslAbilityScriptValue(ftk)).toBeGreaterThan(0);
    });

    it("a 'whenever another creature you control enters' ability stays realized", () => {
        const guide = getCardByName("Guide of Souls");
        expect(guide.triggeredAbilities?.[0].etbAbility).toBe(false);
        expect(dslRealizedAbilityScriptValue(guide)).toBeGreaterThan(0);
    });

    it("a self ETB that schedules a delayed trigger stays realized — its consequence is still pending (Dash)", () => {
        const ragavan = getCardByName("Ragavan, Nimble Pilferer");
        const dash = ragavan.triggeredAbilities?.find(
            (t) => t.id === "dash-haste-and-return"
        );
        expect(dash?.etbAbility).toBe(false);
    });

    it("a creature whose own ETB sacrifices it keeps no latent body; one that can pay to keep it does", () => {
        const phlage = getCardByName("Phlage, Titan of Fire's Fury");
        expect(etbSelfSacrificeWeight(phlage)).toBe(1);
        expect(cardValueById(phlage.id)).toBeCloseTo(
            dslAbilityScriptValue(phlage)
        );
        const dreadnought = getCardByName("Phyrexian Dreadnought");
        expect(etbSelfSacrificeWeight(dreadnought)).toBe(0);
        // An evoke sacrifice is decided by how the card is cast — undecided in
        // hand, so it takes the gate's weight.
        expect(etbSelfSacrificeWeight(getCardByName("Solitude"))).toBe(0.5);
    });

    it("a creature's latent script value is bounded like a non-creature's (issue #1508's cap)", () => {
        const oracle = getCardByName("Thassa's Oracle");
        const body =
            0.85 *
            creatureValueRaw(
                oracle.power ?? 0,
                oracle.toughness ?? 0,
                manaValue(oracle.manaCost),
                oracle.staticAbilities ?? []
            );
        expect(dslAbilityScriptValue(oracle)).toBeGreaterThan(300);
        expect(cardValueById(oracle.id)).toBeCloseTo(body + 300);
    });
});
