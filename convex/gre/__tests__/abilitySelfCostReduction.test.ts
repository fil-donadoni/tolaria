// CR 601.2f — SELF cost reduction on an ACTIVATED ABILITY (ADR 0096, issue
// #2288).
//
// The battlefield `cost-modifier` scan finds a reduction only when some
// PERMANENT carries it. ADR 0063 opened a self-host arm for spells, because a
// spell being announced is not a permanent and so cannot carry its own
// reducer. An activated ability has the identical hole one zone over: a
// Hand-Activated Ability (CR 113.6j — its cost discards its own card, a cost
// that can't be paid on the battlefield, so the ability functions from the
// hand) is announced from a zone the scan never looks at.
//
// `ActivatedAbility.cost.selfReduction` is that arm. Declared PER ABILITY,
// never per card: the Oracle says "this ability costs {1} less to activate",
// and the motivating cards carry a second ability the reduction must not
// touch.
//
// Everything below drives the SHARED CR 601.2f authority — `getCostModifiers`
// + `applyCostModifiers`, the exact pair both `activateAbility` commit paths
// call — or the real activation entry point itself. No mirrored arithmetic.

import { describe, it, expect } from "vitest";
import { preloadDefinitions, tryGetDefinition } from "../../cards";
import type { CardDefinition, ManaCost } from "../../cards/types";
import { activateAbilityOnState } from "../../game";
import { buildBoardAbilityDemands } from "../autoTapDemands";
import { isAutoPayableManaAbilityCost } from "../constants";
import {
    applyCostModifiers,
    getCostModifiers,
    getPlayer,
    normalizeManaCost,
} from "../state";
import type { CardInstanceState, GameState } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";

const REDUCER_ID = "00000000-0000-4000-8000-000022880001";
const HAND_REDUCER_ID = "00000000-0000-4000-8000-000022880002";
const LEGEND_ID = "00000000-0000-4000-8000-000022880003";
const PLAIN_CREATURE_ID = "00000000-0000-4000-8000-000022880004";
const LEGEND_ARTIFACT_ID = "00000000-0000-4000-8000-000022880005";
const MANA_REDUCER_ID = "00000000-0000-4000-8000-000022880006";

/** "for each legendary creature you control" — ADR 0096's own example filter,
 *  and the shape the motivating channel lands print. */
const LEGENDARY_CREATURE_COUNT = {
    perCount: { X: 1 } as ManaCost,
    countFilter: { types: "Creature", supertypes: "Legendary" },
} as const;

preloadDefinitions([
    {
        // Two abilities, IDENTICAL {1}{G} costs, and only ONE of them declares
        // the reduction — the per-ability granularity ADR 0096 chose over a
        // card-level field.
        id: REDUCER_ID,
        name: "Synthetic Self-Reducing Engine",
        rarity: "rare",
        manaCost: { X: 1 },
        types: ["Artifact"],
        activatedAbilities: [
            {
                id: "reduced-gain",
                oracleText:
                    "{1}{G}: You gain 3 life. This ability costs {1} less to activate for each legendary creature you control.",
                cost: {
                    mana: { X: 1, G: 1 },
                    selfReduction: LEGENDARY_CREATURE_COUNT,
                },
                useStack: true,
                effects: [{ op: "gainLife", player: "controller", amount: 3 }],
            },
            {
                id: "plain-gain",
                oracleText: "{1}{G}: You gain 1 life.",
                cost: { mana: { X: 1, G: 1 } },
                useStack: true,
                effects: [{ op: "gainLife", player: "controller", amount: 1 }],
            },
        ],
    } as CardDefinition,
    {
        // The motivating shape: a HAND-activated ability (CR 113.6j) whose
        // source is never a permanent, so no battlefield scan can carry its
        // reducer.
        id: HAND_REDUCER_ID,
        name: "Synthetic Channel Land",
        rarity: "rare",
        types: ["Land"],
        supertypes: ["Legendary"],
        activatedAbilities: [
            {
                id: "channel-gain",
                oracleText:
                    "{2}{G}, Discard this card: You gain 3 life. This ability costs {1} less to activate for each legendary creature you control.",
                cost: {
                    mana: { X: 2, G: 1 },
                    discardThis: true,
                    selfReduction: LEGENDARY_CREATURE_COUNT,
                },
                activateFromHand: true,
                useStack: true,
                effects: [{ op: "gainLife", player: "controller", amount: 3 }],
            },
        ],
    } as CardDefinition,
    {
        id: LEGEND_ID,
        name: "Synthetic Legend",
        rarity: "rare",
        manaCost: { X: 1 },
        types: ["Creature"],
        supertypes: ["Legendary"],
        subtypes: ["Spirit"],
        power: 1,
        toughness: 1,
    } as CardDefinition,
    {
        id: PLAIN_CREATURE_ID,
        name: "Synthetic Commoner",
        rarity: "common",
        manaCost: { X: 1 },
        types: ["Creature"],
        subtypes: ["Spirit"],
        power: 1,
        toughness: 1,
    } as CardDefinition,
    {
        // Legendary, but an ARTIFACT — the wrong card type for the filter.
        id: LEGEND_ARTIFACT_ID,
        name: "Synthetic Legendary Relic",
        rarity: "rare",
        manaCost: { X: 1 },
        types: ["Artifact"],
        supertypes: ["Legendary"],
    } as CardDefinition,
    {
        // A MANA ability (`useStack: false`) that declares a reduction. ADR
        // 0096 keeps the mana-ability payment path out of scope; this exists
        // only to pin that decision down.
        id: MANA_REDUCER_ID,
        name: "Synthetic Reducing Rock",
        rarity: "rare",
        manaCost: { X: 1 },
        types: ["Artifact"],
        activatedAbilities: [
            {
                id: "reducing-rock-mana",
                oracleText: "{1}: Add {G}.",
                cost: {
                    mana: { X: 1 },
                    selfReduction: LEGENDARY_CREATURE_COUNT,
                },
                useStack: false,
                manaProduced: { G: 1 },
            },
        ],
    } as CardDefinition,
]);

function board(cardIds: string[], controllerId: string): CardInstanceState[] {
    return cardIds.map((id, i) =>
        makeInstance(id, {
            id: `${controllerId}-${i}-${id.slice(-2)}`,
            controllerId,
            ownerId: controllerId,
        })
    );
}

/** `p1` holds the reducing engine plus `mine`; `p2` holds `theirs`. */
function setup(opts: {
    mine?: string[];
    theirs?: string[];
    pool?: Record<string, number>;
    handSource?: boolean;
}): { state: GameState; source: CardInstanceState } {
    const source = makeInstance(
        opts.handSource ? HAND_REDUCER_ID : REDUCER_ID,
        {
            id: "src",
            controllerId: "p1",
            ownerId: "p1",
            zone: opts.handSource ? "hand" : "battlefield",
        }
    );
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: board(opts.mine ?? [], "p1").concat(
                    opts.handSource ? [] : [source]
                ),
                hand: opts.handSource ? [source] : [],
                manaPool: opts.pool ?? {},
            }),
            makePlayer("p2", {
                battlefield: board(opts.theirs ?? [], "p2"),
            }),
        ],
    });
    return { state, source };
}

/** The charged total for `abilityId` on `source`, through the SAME collector +
 *  apply pair `activateAbility` runs. */
function chargedCost(
    state: GameState,
    source: CardInstanceState,
    abilityId: string
): Record<string, number> {
    const def = source.card as { id: string };
    const ability = preloadedAbility(def.id, abilityId);
    const cost = normalizeManaCost(ability.cost.mana ?? {});
    applyCostModifiers(
        cost,
        getCostModifiers(state, source, "ability", ability)
    );
    return cost;
}

function preloadedAbility(cardId: string, abilityId: string) {
    // Read the ability the same way every engine consumer does — off the
    // registered definition, not off a literal re-declared in the test.
    const def = getRegisteredDefinition(cardId);
    const ability = def.activatedAbilities?.find((a) => a.id === abilityId);
    if (!ability) throw new Error(`no ability ${abilityId} on ${cardId}`);
    return ability;
}

function getRegisteredDefinition(cardId: string): CardDefinition {
    // `preloadDefinitions` registers into the same registry `tryGetDefinition`
    // reads, which is what `getCostModifiers` itself consults.
    const def = tryGetDefinition(cardId);
    if (!def) throw new Error(`definition ${cardId} not registered`);
    return def;
}

describe("cost.selfReduction on an activated ability (CR 601.2f, ADR 0096)", () => {
    it("scales with the count: 0 → printed, 1 → one generic less, 3 → three less", () => {
        const none = setup({ mine: [] });
        expect(chargedCost(none.state, none.source, "reduced-gain")).toEqual({
            X: 1,
            G: 1,
        });

        const one = setup({ mine: [LEGEND_ID] });
        // {1}{G} minus one generic → {G}: the generic slot is deleted, never
        // left as a zero.
        expect(chargedCost(one.state, one.source, "reduced-gain")).toEqual({
            G: 1,
        });

        const three = setup({ mine: [LEGEND_ID, LEGEND_ID, LEGEND_ID] });
        expect(chargedCost(three.state, three.source, "reduced-gain")).toEqual({
            G: 1,
        });
    });

    it("never reduces a coloured pip away, at any count", () => {
        const many = setup({
            mine: [LEGEND_ID, LEGEND_ID, LEGEND_ID, LEGEND_ID, LEGEND_ID],
        });
        // Five matches against a {1}{G} cost: the generic goes, the {G} stays.
        expect(chargedCost(many.state, many.source, "reduced-gain")).toEqual({
            G: 1,
        });
    });

    it("counts only the reduction's OWN player's permanents (CR 601.2f 'you control')", () => {
        const opponentOnly = setup({ theirs: [LEGEND_ID, LEGEND_ID] });
        expect(
            chargedCost(opponentOnly.state, opponentOnly.source, "reduced-gain")
        ).toEqual({ X: 1, G: 1 });
    });

    it("discriminates on the filter: a legendary ARTIFACT is not a legendary creature", () => {
        const wrongType = setup({ mine: [LEGEND_ARTIFACT_ID] });
        expect(
            chargedCost(wrongType.state, wrongType.source, "reduced-gain")
        ).toEqual({ X: 1, G: 1 });
    });

    it("discriminates on the supertype: a NONlegendary creature is not counted (CR 205.4a)", () => {
        const wrongSupertype = setup({ mine: [PLAIN_CREATURE_ID] });
        expect(
            chargedCost(
                wrongSupertype.state,
                wrongSupertype.source,
                "reduced-gain"
            )
        ).toEqual({ X: 1, G: 1 });
    });

    it("is scoped to the declaring ABILITY — the card's other ability is unreduced", () => {
        const { state, source } = setup({ mine: [LEGEND_ID] });
        expect(chargedCost(state, source, "reduced-gain")).toEqual({ G: 1 });
        // Same card, same board, same printed {1}{G}: no reduction.
        expect(chargedCost(state, source, "plain-gain")).toEqual({
            X: 1,
            G: 1,
        });
    });

    it("applies to a HAND-activated ability, whose source is not a permanent (CR 113.6j)", () => {
        const { state, source } = setup({
            handSource: true,
            mine: [LEGEND_ID, LEGEND_ID],
        });
        // {2}{G} minus two → {G}. Nothing on the battlefield carries this
        // reducer; the arm reads it off the announced ability itself.
        expect(chargedCost(state, source, "channel-gain")).toEqual({ G: 1 });
    });
});

describe("cost.selfReduction — the real activation charges the reduced total", () => {
    it("commits inline off a pool that covers the REDUCED cost but not the printed one", () => {
        const { state, source } = setup({
            mine: [LEGEND_ID],
            pool: { G: 1 },
        });
        const lifeBefore = getPlayer(state, "p1").life;

        // {G} alone cannot pay the printed {1}{G}; it exactly pays the reduced
        // {G}. A commit here IS the reduction being charged.
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: source.id,
            abilityId: "reduced-gain",
        });
        expect(state.stack).toHaveLength(1);
        expect(state.pendingActivation).toBeUndefined();
        // The whole {G} went to the cost (the pool keeps a spent key at 0).
        expect(getPlayer(state, "p1").manaPool.G ?? 0).toBe(0);
        expect(getPlayer(state, "p1").life).toBe(lifeBefore);
    });

    it("still parks a payment phase when the reduced cost is NOT covered", () => {
        const { state, source } = setup({ mine: [], pool: { G: 1 } });
        // No legendary creature → the printed {1}{G} stands and {G} is short.
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: source.id,
            abilityId: "reduced-gain",
        });
        expect(state.stack).toHaveLength(0);
        expect(state.pendingActivation?.manaCost).toEqual({ X: 1, G: 1 });
    });
});

describe("cost.selfReduction — auto-tap reserves the reduced cost (issue #2288)", () => {
    const timing = {
        phase: "PRECOMBAT_MAIN" as const,
        isControllersTurn: true,
    };

    it("a board-ability Demand carries the REDUCED cost, not the printed one", () => {
        const { state } = setup({ mine: [LEGEND_ID] });
        const player = getPlayer(state, "p1");
        const demands = buildBoardAbilityDemands(
            state,
            player.battlefield,
            timing
        );
        const reduced = demands.find((d) => d.id.endsWith("#reduced-gain"));
        const plain = demands.find((d) => d.id.endsWith("#plain-gain"));
        expect(reduced?.cost).toEqual({ G: 1 });
        // The unreduced sibling proves the Demand builder reads the reduction
        // per ability rather than per permanent.
        expect(plain?.cost).toEqual({ X: 1, G: 1 });
    });

    it("reserves the printed cost when nothing matches the filter", () => {
        const { state } = setup({ mine: [] });
        const player = getPlayer(state, "p1");
        const demands = buildBoardAbilityDemands(
            state,
            player.battlefield,
            timing
        );
        expect(
            demands.find((d) => d.id.endsWith("#reduced-gain"))?.cost
        ).toEqual({ X: 1, G: 1 });
    });
});

describe("cost.selfReduction — the mana-ability path is unchanged (ADR 0096)", () => {
    it("a useStack:false ability declaring a reduction is not auto-payable (fails closed)", () => {
        const ability = preloadedAbility(MANA_REDUCER_ID, "reducing-rock-mana");
        // The automatic mana-ability planner funds `cost.mana` RAW. ADR 0096
        // leaves that path unreduced on purpose, so the leg is classified as
        // never-auto-payable rather than silently funded at the printed price.
        expect(isAutoPayableManaAbilityCost(ability.cost)).toBe(false);
        // The sibling stack ability, same card family, stays auto-payable —
        // the exclusion is the reduction leg, not mana abilities at large.
        expect(
            isAutoPayableManaAbilityCost({ mana: { X: 1 }, tap: true })
        ).toBe(true);
    });
});
