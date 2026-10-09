// Restriction pricing (issue #5154): attack / block / untap restrictions
// carried by `staticEffects[]` are priced on the RESTRICTED side
// (`creatureRestrictionDiscount`, read by `evaluateCreature`) and credited to
// their SOURCE (`restrictionSourceWorth`, read by both the board term and
// `permanentRealisedValue`). CR 508.1c (attack), 509.1b (block), 502.3
// (untap), 303.4 (an Aura's effect applies to its host).
//
// Every assertion goes through `evaluate` / `evaluateCreature` /
// `permanentRealisedValue` — the surfaces the search and the removal lens
// read — never through a hand-built number.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { DEFAULT_EVAL_WEIGHTS } from "../ai/evalWeights";
import { restrictionSourceWorth } from "../ai/restrictionPricing";
import { creatureAttackShareRaw, creatureBlockShareRaw } from "../creatureBody";
import {
    evaluate,
    evaluateBreakdown,
    evaluateCreature,
    permanentRealisedValue,
} from "../evaluate";
import { beginLayer7Pass } from "../layers";
import type { CardInstanceState, GameState } from "../state";

const BEARS = getCardByName("Grizzly Bears").id; // 2/2 ground
const GIANT = getCardByName("Hill Giant").id; // 3/3 ground
const SPRITES = getCardByName("Scryb Sprites").id; // 1/1 flying
const MOAT = getCardByName("Moat").id; // creatures without flying can't attack
const PACIFISM = getCardByName("Pacifism").id; // enchanted creature can't attack or block
const MEEKSTONE = getCardByName("Meekstone").id; // power ≥ 3 doesn't untap
const MIGHTSTONE = getCardByName("Mightstone").id; // MV 4 artifact, no script
const SEA_SERPENT = getCardByName("Sea Serpent").id; // can't attack unless defender controls an Island

const W = DEFAULT_EVAL_WEIGHTS;

function inst(
    cardId: string,
    controllerId: string,
    id: string,
    overrides: Partial<CardInstanceState> = {}
) {
    return makeInstance(cardId, {
        controllerId,
        ownerId: controllerId,
        id,
        ...overrides,
    });
}

function board(p1: CardInstanceState[], p2: CardInstanceState[]): GameState {
    return makeState({
        players: [
            makePlayer("p1", { battlefield: p1 }),
            makePlayer("p2", { battlefield: p2 }),
        ],
    });
}

/** The body points the fitted vector takes off a creature that can neither
 *  attack nor block, at its lasting P/T and keywords. */
function fullDiscount(card: CardInstanceState): number {
    return (
        W.cannotAttackShare *
            creatureAttackShareRaw(card.power ?? 0, card.staticAbilities) +
        W.cannotBlockShare *
            creatureBlockShareRaw(card.toughness ?? 0, card.staticAbilities)
    );
}

function attackDiscount(card: CardInstanceState): number {
    return (
        W.cannotAttackShare *
        creatureAttackShareRaw(card.power ?? 0, card.staticAbilities)
    );
}

function creatureWorth(state: GameState, card: CardInstanceState): number {
    return evaluateCreature(state, card, W.latent, beginLayer7Pass(state), W);
}

describe("restriction pricing — the restricted side (issue #5154)", () => {
    it("CR 508.1c: Moat on the opponent's side grounds each non-flier below itself; a flier is unchanged", () => {
        const bears = inst(BEARS, "p1", "bears");
        const giant = inst(GIANT, "p1", "giant");
        const sprites = inst(SPRITES, "p1", "sprites");
        const open = board([bears, giant, sprites], []);
        const moated = board(
            [bears, giant, sprites],
            [inst(MOAT, "p2", "moat")]
        );
        for (const c of [bears, giant]) {
            expect(creatureWorth(moated, c)).toBeCloseTo(
                creatureWorth(open, c) - attackDiscount(c),
                6
            );
        }
        expect(creatureWorth(moated, sprites)).toBe(
            creatureWorth(open, sprites)
        );
        // Through `evaluate`: the grounded board is worth strictly less to its
        // owner than the same board with no Moat across the table — by more
        // than the Moat's own body and presence (the Bot's creatures lost
        // their attack share AND the Moat earns it back).
        const moatBody = permanentRealisedValue(
            board([], [inst(MOAT, "p2", "moat")]),
            inst(MOAT, "p2", "moat"),
            W
        );
        expect(evaluate(open, "p1") - evaluate(moated, "p1")).toBeGreaterThan(
            moatBody
        );
        // The lens prices the Moat at exactly what its removal moves on the
        // per-permanent terms: the Moat's own `permanents` credit plus the
        // creatures' recovery. (Per-player aggregates — colour coverage
        // reads the Moat as white evidence — are deliberately not the lens's.)
        const moat = moated.players[1].battlefield[0];
        const withMoat = evaluateBreakdown(moated, "p1");
        const without = evaluateBreakdown(open, "p1");
        expect(
            without.self.creatures -
                withMoat.self.creatures +
                (withMoat.opp.permanents - without.opp.permanents)
        ).toBeCloseTo(permanentRealisedValue(moated, moat, W), 6);
    });

    it("CR 303.4 / 509.1b: Pacifism takes the host's attack and block shares, and the Aura is worth exactly what it took — on the board term and on the removal lens (one number)", () => {
        const giant = inst(GIANT, "p1", "giant");
        const oppBears = inst(BEARS, "p2", "opp-bears");
        const pacifism = inst(PACIFISM, "p2", "pacifism", {
            attachedTo: "giant",
        });
        const free = board([giant], [oppBears]);
        const pacified = board([giant], [oppBears, pacifism]);
        const taken = fullDiscount(giant);
        expect(taken).toBeGreaterThan(0);

        // The host loses both shares.
        expect(creatureWorth(pacified, giant)).toBeCloseTo(
            creatureWorth(free, giant) - taken,
            6
        );
        // The Aura's standing worth is that same number…
        const pass = beginLayer7Pass(pacified);
        expect(restrictionSourceWorth(pacified, pacifism, W, pass)).toBeCloseTo(
            taken,
            6
        );
        // …on the board term: p2's `permanents` moves by presence + body +
        // that number, p1's `creatures` by what the host lost…
        const auraBody = permanentRealisedValue(
            board([], [inst(PACIFISM, "p2", "loose")]),
            inst(PACIFISM, "p2", "loose"),
            W
        );
        const before = evaluateBreakdown(free, "p2");
        const after = evaluateBreakdown(pacified, "p2");
        expect(after.self.permanents - before.self.permanents).toBeCloseTo(
            auraBody + taken,
            6
        );
        expect(after.opp.creatures - before.opp.creatures).toBeCloseTo(
            -taken,
            6
        );
        // …and on the removal lens, which prices the Aura at the margin its
        // removal MOVES: the source's credit plus the host's recovery — the
        // same number `evaluateBreakdown` says the Aura's arrival moved.
        expect(permanentRealisedValue(pacified, pacifism, W)).toBeCloseTo(
            auraBody + 2 * taken,
            6
        );
        expect(permanentRealisedValue(pacified, pacifism, W)).toBeCloseTo(
            after.self.permanents -
                before.self.permanents +
                (before.opp.creatures - after.opp.creatures),
            6
        );
    });

    it("CR 509.1b: with no opposing creature there is nothing to block — only the attack share is lost", () => {
        const giant = inst(GIANT, "p1", "giant");
        const pacifism = inst(PACIFISM, "p2", "pacifism", {
            attachedTo: "giant",
        });
        const free = board([giant], []);
        const pacified = board([giant], [pacifism]);
        expect(creatureWorth(pacified, giant)).toBeCloseTo(
            creatureWorth(free, giant) - attackDiscount(giant),
            6
        );
    });

    it("CR 502.3: a creature Meekstone holds TAPPED loses both shares; untapped, or below the power line, it is whole", () => {
        const meekstone = inst(MEEKSTONE, "p2", "meekstone");
        const giantUp = inst(GIANT, "p1", "giant-up");
        const giantDown = inst(GIANT, "p1", "giant-down", { isTapped: true });
        const bearsDown = inst(BEARS, "p1", "bears", { isTapped: true });
        const open = board([giantUp, giantDown, bearsDown], []);
        const locked = board([giantUp, giantDown, bearsDown], [meekstone]);
        expect(creatureWorth(locked, giantUp)).toBe(
            creatureWorth(open, giantUp)
        );
        expect(creatureWorth(locked, bearsDown)).toBe(
            creatureWorth(open, bearsDown)
        );
        expect(creatureWorth(locked, giantDown)).toBeCloseTo(
            creatureWorth(open, giantDown) - fullDiscount(giantDown),
            6
        );
        expect(
            restrictionSourceWorth(
                locked,
                meekstone,
                W,
                beginLayer7Pass(locked)
            )
        ).toBeCloseTo(fullDiscount(giantDown), 6);
    });

    it("CR 508.1c: a creature's OWN attack restriction discounts it once — never again as its own source", () => {
        const serpent = inst(SEA_SERPENT, "p1", "serpent");
        const noIsland = board([serpent], [inst(BEARS, "p2", "bears")]);
        const island = board(
            [serpent],
            [
                inst(BEARS, "p2", "bears"),
                inst(getCardByName("Island").id, "p2", "island"),
            ]
        );
        expect(creatureWorth(noIsland, serpent)).toBeCloseTo(
            creatureWorth(island, serpent) - attackDiscount(serpent),
            6
        );
        expect(
            restrictionSourceWorth(
                noIsland,
                serpent,
                W,
                beginLayer7Pass(noIsland)
            )
        ).toBe(0);
    });
});

describe("restriction pricing — the source's standing worth (issue #5154)", () => {
    it("the removal lens ranks an opposing Moat above a plain 4-MV artifact when the Bot's board is grounded, and level with it when nothing is", () => {
        const moat = inst(MOAT, "p2", "moat");
        const stone = inst(MIGHTSTONE, "p2", "stone");
        const grounded = board(
            [
                inst(BEARS, "p1", "b1"),
                inst(BEARS, "p1", "b2"),
                inst(BEARS, "p1", "b3"),
            ],
            [moat, stone]
        );
        expect(permanentRealisedValue(grounded, moat, W)).toBeGreaterThan(
            permanentRealisedValue(grounded, stone, W)
        );
        const airborne = board(
            [inst(SPRITES, "p1", "s1"), inst(SPRITES, "p1", "s2")],
            [moat, stone]
        );
        expect(permanentRealisedValue(airborne, moat, W)).toBe(
            permanentRealisedValue(airborne, stone, W)
        );
    });

    it("a lock is worth what it takes from the opponent MINUS what it takes from its controller", () => {
        const moat = inst(MOAT, "p1", "moat");
        const own1 = inst(BEARS, "p1", "own1");
        const own2 = inst(BEARS, "p1", "own2");
        const theirs = inst(BEARS, "p2", "theirs");
        const state = board([moat, own1, own2], [theirs]);
        expect(
            restrictionSourceWorth(state, moat, W, beginLayer7Pass(state))
        ).toBeCloseTo(
            attackDiscount(theirs) -
                attackDiscount(own1) -
                attackDiscount(own2),
            6
        );
    });

    it("two sources on one creature split it counterfactually: each earns only what its removal would free", () => {
        const giant = inst(GIANT, "p1", "giant");
        const bears = inst(BEARS, "p1", "bears");
        const moat = inst(MOAT, "p2", "moat");
        const pacifism = inst(PACIFISM, "p2", "pacifism", {
            attachedTo: "giant",
        });
        // A flier across the table: the block axis needs an attacker to be
        // measured against, and a flier is not grounded by its own Moat.
        const theirs = inst(SPRITES, "p2", "theirs");
        const state = board([giant, bears], [moat, pacifism, theirs]);
        const pass = beginLayer7Pass(state);
        // Removing the Moat frees the Bears only — the Giant stays pacified.
        expect(restrictionSourceWorth(state, moat, W, pass)).toBeCloseTo(
            attackDiscount(bears),
            6
        );
        // Removing the Pacifism frees the Giant's BLOCK share only — the Moat
        // still grounds it.
        expect(restrictionSourceWorth(state, pacifism, W, pass)).toBeCloseTo(
            fullDiscount(giant) - attackDiscount(giant),
            6
        );
        // The Giant itself is priced at its whole loss.
        const open = board([giant, bears], [theirs]);
        expect(creatureWorth(state, giant)).toBeCloseTo(
            creatureWorth(open, giant) - fullDiscount(giant),
            6
        );
    });
});
