/**
 * Loyalty as a resource in the leaf evaluation (issue #2491, ADR 0107, CR 606.4).
 *
 * Before this term a planeswalker scored as a generic non-creature permanent:
 * the flat board-presence bonus plus its `cardValue`. Loyalty counters carried
 * no weight, so a `-6` ultimate cost the bot nothing unless it landed exactly
 * on 0, and a `+1` gained nothing beyond its own effect. With the enumerator
 * now offering loyalty abilities, the two would have been separated by rollout
 * noise.
 *
 * Every assertion here goes through the REAL reducer (`evaluateBreakdown` /
 * `loyaltyRealizationRatio`), and the per-walker CEILING table is written by
 * hand from the printed numbers rather than recomputed from the implementation
 * — a table derived from the code under test proves nothing.
 */

import { describe, expect, it } from "vitest";
import {
    loyaltyRatioFor,
    loyaltyRealizationRatio,
    loyaltySpendCeiling,
    maxLoyaltySpend,
} from "../ai/loyaltyValue";
import { cardValue, evaluateBreakdown } from "../evaluate";
import { buildStateFromScenario } from "../scenarioBuilder";
import { createInitialGameState, type PlayerInput } from "../setup";
import { getCardByName, registeredDefinitions } from "../../cards";
import { projectPublicState } from "../../gameProjections";
import type { CardDefinition } from "../../cards/types";
import type { CardInstanceState, GameState } from "../state";
import type { ScenarioSpec } from "../../debugScenarioSpec";

/** The ceiling every shipped walker must compute, written from the printed
 *  starting loyalty and the printed loyalty costs — NOT from the formula in
 *  `loyaltyValue.ts`. `ceiling = max(startingLoyalty, biggest -N) + 1`. */
const EXPECTED_CEILING: Record<string, number> = {
    // start 4, spends 3/7 → max(4,7)+1
    "Chandra, Torch of Defiance": 8,
    // start 3, spends 2/6
    "Dack Fayden": 7,
    // start 3, spends 1/4
    "Garruk Wildspeaker": 5,
    // start 3, spends 2/5
    "Grist, the Hunger Tide": 6,
    // start 3, spends 1/12
    "Jace, the Mind Sculptor": 13,
    // start 3, spends 2/6
    "Liliana of the Veil": 7,
    // start 3, spends 2 — the starting count is the larger bound
    "Minsc & Boo, Timeless Heroes": 4,
    // start 5, spend 2 — starting count again
    "Narset, Parter of Veils": 6,
    // start 4, spend 5
    "Oko, Thief of Crowns": 6,
    // start 3, spends 2/6
    "Sorin, Lord of Innistrad": 7,
    // start 4, spends 3/8
    "Teferi, Hero of Dominaria": 9,
    // start 4, spend 3 — starting count again
    "Teferi, Time Raveler": 5,
    // start 3, spends 1/7
    "Wrenn and Six": 8,
};

function player(id: string): PlayerInput {
    const filler = getCardByName("Forest");
    return {
        id,
        name: id,
        bgColor: "#000000",
        deck: {
            id: `deck-${id}`,
            name: "test",
            format: "freeform",
            cards: Array.from({ length: 60 }, () => ({
                cardId: filler.id,
                cardName: filler.name,
            })),
        },
    };
}

function build(spec: ScenarioSpec): GameState {
    return buildStateFromScenario(
        createInitialGameState([player("p1"), player("p2")], 0x2491),
        spec
    );
}

function shippedPlaneswalkers(): CardDefinition[] {
    const out: CardDefinition[] = [];
    for (const def of registeredDefinitions()) {
        if (!def.types.includes("Planeswalker")) continue;
        if (!def.activatedAbilities?.some((a) => a.cost.loyalty !== undefined))
            continue;
        out.push(def);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** A board holding exactly one non-land permanent for `me` — the named card,
 *  optionally at an explicit loyalty. `undefined` leaves the board empty. */
function boardSpec(card?: string, loyalty?: number): ScenarioSpec {
    return {
        cards: card
            ? [
                  {
                      name: card,
                      owner: "me",
                      zone: "battlefield",
                      ...(loyalty !== undefined
                          ? { counters: { loyalty } }
                          : {}),
                  },
              ]
            : [],
        phase: "PRECOMBAT_MAIN",
        turn: 5,
        landCount: 3,
        libraryCount: 20,
    };
}

/** `me`'s `permanents` term, through the real evaluation reducer. */
function permanentsTerm(state: GameState): number {
    return evaluateBreakdown(state, state.players[0].id).self.permanents;
}

function onlyPermanent(state: GameState, name: string): CardInstanceState {
    const def = getCardByName(name);
    const card = state.players[0].battlefield.find(
        (c) => (c.card as { id?: string }).id === def.id
    );
    if (!card) throw new Error(`${name} not on the battlefield`);
    return card;
}

describe("the loyalty ceiling (CR 606.4)", () => {
    it("computes, per shipped walker, max(startingLoyalty, biggest -N) + 1", () => {
        const walkers = shippedPlaneswalkers();
        expect(walkers.length).toBe(Object.keys(EXPECTED_CEILING).length);
        for (const def of walkers) {
            expect(EXPECTED_CEILING[def.name]).toBeDefined();
            expect([def.name, loyaltySpendCeiling(def)]).toEqual([
                def.name,
                EXPECTED_CEILING[def.name],
            ]);
        }
    });

    it("leaves no walker with a zero-gradient `+1` — one more counter at starting loyalty is always worth something", () => {
        for (const def of shippedPlaneswalkers()) {
            const start = def.loyalty!;
            expect([def.name, loyaltyRatioFor(start + 1, def)]).toEqual([
                def.name,
                (start + 1) / start,
            ]);
            expect(loyaltyRatioFor(start + 1, def)).toBeGreaterThan(
                loyaltyRatioFor(start, def)
            );
        }
    });
});

describe("no baseline shift at starting loyalty (issue #2491)", () => {
    it("scores every shipped walker exactly as an unscaled non-creature permanent", () => {
        // The CONTROL: an ordinary non-creature, non-land permanent. Its
        // contribution to the `permanents` term is the flat board-presence
        // bonus plus its `cardValue`, which is what pins the bonus down
        // without the term's own constant being exported.
        const empty = permanentsTerm(build(boardSpec()));
        const controlState = build(boardSpec("Jayemdae Tome"));
        const boardPresenceBonus =
            permanentsTerm(controlState) -
            empty -
            cardValue(
                controlState,
                onlyPermanent(controlState, "Jayemdae Tome")
            );

        for (const def of shippedPlaneswalkers()) {
            // No explicit counters: the scenario builder seeds the printed
            // starting loyalty (CR 306.5b), which is the position every
            // existing blade entry / eval baseline was measured in.
            const state = build(boardSpec(def.name));
            const walker = onlyPermanent(state, def.name);
            expect(walker.counters?.loyalty).toBe(def.loyalty);
            expect([def.name, loyaltyRealizationRatio(walker)]).toEqual([
                def.name,
                1,
            ]);
            expect([def.name, permanentsTerm(state) - empty]).toEqual([
                def.name,
                boardPresenceBonus + cardValue(state, walker),
            ]);
        }
    });
});

describe("loyalty prices the walker (CR 606.4 / 704.5i)", () => {
    const LILIANA = "Liliana of the Veil";

    it("a spent counter is a measurable, correctly-signed material loss", () => {
        const full = build(boardSpec(LILIANA, 3));
        const spent = build(boardSpec(LILIANA, 1));
        expect(permanentsTerm(spent)).toBeLessThan(permanentsTerm(full));
    });

    it("a banked counter is a measurable gain", () => {
        const full = build(boardSpec(LILIANA, 3));
        const ticked = build(boardSpec(LILIANA, 4));
        expect(permanentsTerm(ticked)).toBeGreaterThan(permanentsTerm(full));
    });

    it("counters ABOVE the ceiling are dead weight and stop paying", () => {
        const def = getCardByName(LILIANA);
        const ceiling = EXPECTED_CEILING[LILIANA];
        expect(loyaltyRatioFor(ceiling, def)).toBe(
            loyaltyRatioFor(ceiling + 40, def)
        );
    });

    it("death at 0 falls out arithmetically — ratio 0, no special case", () => {
        expect(loyaltyRatioFor(0, getCardByName(LILIANA))).toBe(0);
    });

    it("is identical either side of the wire projection", () => {
        // SURFACE assertion through the real reducer: the ratio reads
        // `card.card.id` (stripped to `{ id }` by the projection) and
        // `counters`, so a projection that dropped either would score the
        // client-side Brain's leaf differently from the server's.
        const state = build(boardSpec(LILIANA, 1));
        const fat = onlyPermanent(state, LILIANA);
        expect(loyaltyRealizationRatio(fat)).toBeCloseTo(1 / 3, 10);
        const projected = projectPublicState(state, 1, state.players[0].id);
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === fat.id
        )!;
        expect(loyaltyRealizationRatio(slim)).toBeCloseTo(1 / 3, 10);
    });
});

describe("a VARIABLE (-X) loyalty cost never clamps (CR 606.6)", () => {
    // `cost.loyalty` is typed as a plain number today, so no shipped card can
    // express this — which is exactly why the rule is pinned now: CR 606.6
    // bounds X at the permanent's current loyalty, so such a walker can spend
    // EVERY counter and none is ever dead weight. Constructed fixture; the
    // cast is deliberate and documents the type gap.
    const variableCostWalker = {
        loyalty: 5,
        activatedAbilities: [
            { cost: { loyalty: 1 } },
            { cost: { loyalty: "-X" } },
        ],
    } as unknown as {
        loyalty?: number;
        activatedAbilities?: readonly { cost: { loyalty?: number } }[];
    };

    it("reports an unbounded max spend and an unbounded ceiling", () => {
        expect(maxLoyaltySpend(variableCostWalker)).toBe(Infinity);
        expect(loyaltySpendCeiling(variableCostWalker)).toBe(Infinity);
    });

    it("keeps scaling past any fixed ceiling a numeric cost would have imposed", () => {
        expect(loyaltyRatioFor(5, variableCostWalker)).toBe(1);
        expect(loyaltyRatioFor(50, variableCostWalker)).toBe(10);
        expect(loyaltyRatioFor(500, variableCostWalker)).toBe(100);
    });
});
