// CR 611.3a / 613.1d / 205.1a — a CONDITIONAL layer-4 type line (issue
// #3237): "During your turn, as long as <this> has one or more loyalty
// counters on him, he's a 3/4 Ninja creature and has hexproof."
//
// "he's a 3/4 Ninja creature" SETS the type line (CR 205.1a — the new card
// type replaces the existing ones; the printed ruling: he "stops being a
// planeswalker during your turn"), so the one static ability is split across
// the layers it touches — `type-add` Creature + `type-remove` Planeswalker +
// `subtype-set` Ninja (layer 4, CR 613.1d), a `pt-set` (layer 7b, CR 613.4b)
// and a `keyword-grant` (layer 6, CR 613.1f) — all gated by the SAME
// source-level `condition`. CR 611.3a: a static ability's effect "applies at
// any given moment to whatever its text indicates", so the gate is re-read on
// every derivation — a turn change with no ETB, no attach and no counter event
// must turn the grant off, and the next one must turn it back on.
import { describe, it, expect } from "vitest";
import type { CardInstanceState, GameState } from "../state";
import { beginApplyingStaticEffects } from "../state";
import { checkStateBasedActions } from "../sba";
import { advancePhase } from "../phases";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import { syncLayers2to5 } from "../layers2to5";
import type { LayerStateView } from "../layers";
import type {
    CardDefinition,
    PermanentView,
    StaticEffectStateView,
} from "../../cards/types";
import { EFFECT_AFFECTS_SELF } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { withTemporaryDefinition } from "../../cards/registry";
import { projectPublicState } from "../../gameProjections";

const WALKER_ID = "test-conditional-creature-walker";

/** CR 611.3a — the source-level gate: its controller's turn, and at least one
 *  loyalty counter on it. */
const duringYourTurnWithLoyalty = (
    source: PermanentView,
    state: StaticEffectStateView
): boolean =>
    state.activePlayerId === source.controllerId &&
    (source.counters?.loyalty ?? 0) >= 1;

const walkerDefinition: CardDefinition = {
    id: WALKER_ID,
    name: "Conditional Creature Walker",
    rarity: "mythic",
    manaCost: { X: 2, U: 1, B: 1 },
    types: ["Planeswalker"],
    subtypes: ["Kaito"],
    supertypes: ["Legendary"],
    loyalty: 4,
    oracleText:
        "During your turn, as long as this has one or more loyalty counters on it, it's a 3/4 Ninja creature and has hexproof.",
    staticEffects: [
        {
            kind: "type-add",
            applies: EFFECT_AFFECTS_SELF,
            condition: duringYourTurnWithLoyalty,
            types: ["Creature"],
        },
        {
            kind: "type-remove",
            applies: EFFECT_AFFECTS_SELF,
            condition: duringYourTurnWithLoyalty,
            types: ["Planeswalker"],
        },
        {
            kind: "subtype-set",
            applies: EFFECT_AFFECTS_SELF,
            condition: duringYourTurnWithLoyalty,
            subtypes: ["Ninja"],
        },
        {
            kind: "pt-set",
            applies: EFFECT_AFFECTS_SELF,
            condition: duringYourTurnWithLoyalty,
            power: 3,
            toughness: 4,
        },
        {
            kind: "keyword-grant",
            applies: EFFECT_AFFECTS_SELF,
            condition: duringYourTurnWithLoyalty,
            keyword: "hexproof",
        },
    ],
};

function board(
    activePlayerId: string,
    loyalty: number
): { state: GameState; walker: CardInstanceState } {
    const walker = makeInstance(WALKER_ID, {
        id: "walker",
        controllerId: "p1",
        ownerId: "p1",
        counters: { loyalty },
    });
    const state = makeState({
        activePlayerId,
        priorityPlayerId: activePlayerId,
        players: [
            makePlayer("p1", { battlefield: [walker] }),
            makePlayer("p2"),
        ],
    });
    beginApplyingStaticEffects(state, walker);
    checkStateBasedActions(state);
    return { state, walker };
}

const view = (state: GameState): LayerStateView =>
    state as unknown as LayerStateView;
const asView = (card: CardInstanceState): PermanentView =>
    card as unknown as PermanentView;

describe("CR 611.3a conditional layer-4 type line (issue #3237)", () => {
    it("during its controller's turn it is a 3/4 Ninja creature with hexproof and no longer a planeswalker", () => {
        withTemporaryDefinition(walkerDefinition, () => {
            const { state, walker } = board("p1", 4);
            // CR 205.1a — the set type line replaces the printed one.
            expect(walker.types).toEqual(["Creature"]);
            expect(walker.subtypes).toEqual(["Ninja"]);
            expect(walker.staticAbilities).toContain("hexproof");
            expect(getEffectivePower(view(state), asView(walker))).toBe(3);
            expect(getEffectiveToughness(view(state), asView(walker))).toBe(4);
        });
    });

    it("during the opponent's turn none of the grant applies", () => {
        withTemporaryDefinition(walkerDefinition, () => {
            const { walker } = board("p2", 4);
            expect(walker.types).toEqual(["Planeswalker"]);
            expect(walker.subtypes).toEqual(["Kaito"]);
            expect(walker.staticAbilities ?? []).not.toContain("hexproof");
        });
    });

    it("the turn change alone — no ETB, no counter event — toggles the grant off and back on (CR 611.3a)", () => {
        withTemporaryDefinition(walkerDefinition, () => {
            const { state, walker } = board("p1", 4);
            expect(walker.types).toContain("Creature");

            // End p1's turn through the real phase machine: CLEANUP → the
            // next turn's beginning phase, opponent active.
            state.phase = "CLEANUP";
            advancePhase(state);
            expect(state.activePlayerId).toBe("p2");
            checkStateBasedActions(state);
            expect(walker.types).toEqual(["Planeswalker"]);
            expect(walker.subtypes).toEqual(["Kaito"]);
            expect(walker.staticAbilities ?? []).not.toContain("hexproof");

            state.phase = "CLEANUP";
            advancePhase(state);
            expect(state.activePlayerId).toBe("p1");
            checkStateBasedActions(state);
            expect(walker.types).toEqual(["Creature"]);
            expect(walker.subtypes).toEqual(["Ninja"]);
            expect(walker.staticAbilities).toContain("hexproof");
        });
    });

    it("losing its last loyalty counter mid-turn stops it being a creature", () => {
        withTemporaryDefinition(walkerDefinition, () => {
            const { state, walker } = board("p1", 1);
            expect(walker.types).toEqual(["Creature"]);
            walker.counters = { ...walker.counters, loyalty: 0 };
            // The condition reads the live counter, so it is a planeswalker
            // again, and the 0-loyalty SBA (CR 704.5i) puts it into the
            // graveyard.
            checkStateBasedActions(state);
            const p1 = state.players[0];
            expect(p1.battlefield.find((c) => c.id === "walker")).toBe(
                undefined
            );
            expect(p1.graveyard.some((c) => c.id === "walker")).toBe(true);
        });
    });

    it("off its controller's turn, a creature made so by ANOTHER effect does not get the 3/4 (CR 611.3a)", () => {
        withTemporaryDefinition(walkerDefinition, () => {
            const { state, walker } = board("p2", 4);
            // An unrelated indefinite layer-4 effect animates it on the
            // opponent's turn: it is a creature, so it has P/T (CR 208.3),
            // and the gated base-P/T set must not be what it reads.
            state.continuousEffects = [
                {
                    id: "ce-animate",
                    layer: 4,
                    timestamp: 900,
                    expiry: { kind: "indefinite", controllerId: "p2" },
                    affected: { kind: "instances", instanceIds: ["walker"] },
                    payload: { kind: "type-change", add: ["Creature"] },
                    characteristicDefining: false,
                },
            ];
            syncLayers2to5(state);
            expect(walker.types).toContain("Creature");
            expect(getEffectivePower(view(state), asView(walker))).toBe(0);
            expect(getEffectiveToughness(view(state), asView(walker))).toBe(0);
        });
    });

    it("the wire projection carries the conditional creature-ness both ways", () => {
        withTemporaryDefinition(walkerDefinition, () => {
            const mine = board("p1", 4).state;
            const slimMine = projectPublicState(mine, 1, "p1").players[0]
                .battlefield[0];
            expect(slimMine.types).toEqual(["Creature"]);
            expect(slimMine.subtypes).toEqual(["Ninja"]);

            const theirs = board("p2", 4).state;
            const slimTheirs = projectPublicState(theirs, 1, "p1").players[0]
                .battlefield[0];
            expect(slimTheirs.types).toEqual(["Planeswalker"]);
            expect(slimTheirs.subtypes).toEqual(["Kaito"]);
        });
    });
});
