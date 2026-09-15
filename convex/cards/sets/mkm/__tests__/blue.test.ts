// MKM — blue per-card behaviour tests (ADR 0043 colour split). Each describe
// block cites the CR section it exercises; assertions check external behaviour
// only, through a real engine entry point.
import { describe, it, expect } from "vitest";
import {
    resolveTopOfStack,
    getCostModifiers,
    applyCostModifiers,
    normalizeManaCost,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { effectiveMaxHandSize } from "../../../../gre/phases";
import { projectPublicState } from "../../../../gameProjections";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { getDefinition } from "../../..";

// The registry seam (ADR 0046): the card is reached by ID through
// `makeInstance`, never by importing its definition out of the set module.
const PROFT_ID = "af5b29b3-974c-4200-8df8-b072c11e1600";
/** Grizzly Bears — a vanilla 2/2 body for the counters to land on. */
const BEAR_ID = "ce2d603a-3231-4a8c-bf39-1617586ea870";
const FORENSIC_GADGETEER_ID = "97d08a15-e61c-4421-a541-c68a4f87cb74";
/** Dragon Engine (atq/colorless.ts) — Artifact Creature, "{2}: +1/+0"
 *  (non-mana, useStack: true). Cross-set fixture, same pattern as Power
 *  Artifact's own test (atq/__tests__/blue.test.ts). */
const DRAGON_ENGINE_ID = "07793a71-1106-4303-b620-e403bd378020";
/** Ancient Kavu (inv/red.ts) — a NON-artifact creature, "{2}: This creature
 *  becomes colorless until end of turn." GENERIC-only cost above the floor,
 *  so a reduction that wrongly ignored the "artifacts you control" scope
 *  would show up as a smaller number, not hide behind the floor the way a
 *  colored-pip-only or already-at-floor cost would. */
const ANCIENT_KAVU_ID = "c8ccb5d0-735b-443f-addd-8b70f5f2c60d";

function resolveTrigger(
    state: GameState,
    source: CardInstanceState,
    triggeredAbilityId: string,
    triggerEvent: StackItem["triggerEvent"],
    targets: StackItem["targets"] = []
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId,
        triggerSourceId: source.id,
        triggerEvent,
        targets,
    });
    resolveTopOfStack(state);
}

const beginCombat = (activePlayerId: string): StackItem["triggerEvent"] =>
    ({
        type: "PHASE_BEGIN" as const,
        phase: "BEGINNING_OF_COMBAT" as const,
        activePlayerId,
    }) as StackItem["triggerEvent"];

function setup(drawn: string[]) {
    const proft = makeInstance(PROFT_ID, {
        id: "proft",
        controllerId: "p1",
        ownerId: "p1",
    });
    const bear = makeInstance(BEAR_ID, {
        id: "bear",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        phase: "BEGINNING_OF_COMBAT",
        activePlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [proft, bear],
                drawnThisTurn: drawn,
            }),
            makePlayer("p2"),
        ],
    });
    return { state, proft, bear };
}

describe("Proft's Eidetic Memory — ETB draw (CR 121.1 / 603.6a)", () => {
    it("draws a card when it enters", () => {
        const proft = makeInstance(PROFT_ID, {
            id: "proft",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [proft],
                    library: [
                        makeInstance(BEAR_ID, {
                            id: "lib-1",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, proft, "profts-eidetic-memory-etb-draw", {
            type: "PERMANENT_ENTERED",
            instanceId: "proft",
            controllerId: "p1",
            types: ["Enchantment"],
        } as StackItem["triggerEvent"]);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["lib-1"]);
        // CR 121.1 — the draw feeds the same per-turn tally the combat trigger
        // reads, so the ETB is itself one of the "cards you've drawn".
        expect(state.players[0].drawnThisTurn).toEqual(["lib-1"]);
    });
});

describe("Proft's Eidetic Memory — no maximum hand size (CR 402.2 / 514.1)", () => {
    it("lifts the controller's cleanup discard ceiling while it is on the battlefield", () => {
        const { state } = setup([]);
        expect(effectiveMaxHandSize(state.players[0], state)).toBe(Infinity);
        // The opponent is untouched — "YOU have no maximum hand size".
        expect(effectiveMaxHandSize(state.players[1], state)).toBe(7);
    });
});

describe("Proft's Eidetic Memory — beginning-of-combat counters (CR 603.4 / 121.1)", () => {
    it("does nothing when exactly one card was drawn this turn ('MORE than one')", () => {
        const { state, proft } = setup(["d1"]);
        resolveTrigger(
            state,
            proft,
            "profts-eidetic-memory-combat",
            beginCombat("p1"),
            [{ type: "permanent", id: "bear" }]
        );
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(bear.counters?.["+1/+1"]).toBeUndefined();
    });

    it("puts (cards drawn − 1) +1/+1 counters on the target (CR 608.2h — X at resolution)", () => {
        const { state, proft } = setup(["d1", "d2", "d3", "d4"]);
        resolveTrigger(
            state,
            proft,
            "profts-eidetic-memory-combat",
            beginCombat("p1"),
            [{ type: "permanent", id: "bear" }]
        );
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(bear.counters?.["+1/+1"]).toBe(3);
        // Counters are board-visible, so they must survive the projection.
        const projected = projectPublicState(state, 0, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(slim.counters?.["+1/+1"]).toBe(3);
    });

    it("two drawn cards is the boundary — exactly one counter", () => {
        const { state, proft } = setup(["d1", "d2"]);
        resolveTrigger(
            state,
            proft,
            "profts-eidetic-memory-combat",
            beginCombat("p1"),
            [{ type: "permanent", id: "bear" }]
        );
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(bear.counters?.["+1/+1"]).toBe(1);
    });

    it("the CHECK-TIME half of the intervening if gates the trigger too (CR 603.4)", () => {
        const { state } = setup(["d1"]);
        const event = {
            type: "PHASE_BEGIN" as const,
            phase: "BEGINNING_OF_COMBAT" as const,
            activePlayerId: "p1",
        };
        const matching = (s: GameState) =>
            collectTriggers(s, [event as never]).filter(
                (t) => t.triggeredAbilityId === "profts-eidetic-memory-combat"
            );
        expect(matching(state)).toHaveLength(0);
        state.players[0].drawnThisTurn = ["d1", "d2"];
        expect(matching(state)).toHaveLength(1);
    });

    it("only on YOUR turn — the opponent's beginning of combat never fires it", () => {
        const { state } = setup(["d1", "d2", "d3"]);
        state.activePlayerId = "p2";
        const event = {
            type: "PHASE_BEGIN" as const,
            phase: "BEGINNING_OF_COMBAT" as const,
            activePlayerId: "p2",
        };
        expect(
            collectTriggers(state, [event as never]).filter(
                (t) => t.triggeredAbilityId === "profts-eidetic-memory-combat"
            )
        ).toHaveLength(0);
    });
});

describe("Forensic Gadgeteer (activated-ability cost reduction scoped to artifacts you control, CR 601.2f / 118.7, issue #1339)", () => {
    /** Mirror game.ts's `activateAbility` cost calculation, same helper shape
     *  as Power Artifact's own test (atq/__tests__/blue.test.ts). */
    function effectiveAbilityCost(
        state: GameState,
        host: CardInstanceState,
        abilityId: string
    ): Record<string, number> {
        const def = getDefinition((host.card as { id: string }).id);
        const ability = def.activatedAbilities!.find(
            (a) => a.id === abilityId
        )!;
        const cost = ability.cost.mana
            ? normalizeManaCost(ability.cost.mana)
            : {};
        applyCostModifiers(
            cost,
            getCostModifiers(state, host, "ability", ability)
        );
        return cost;
    }

    function board(hostCardId: string, hostController: "p1" | "p2") {
        const host = makeInstance(hostCardId, {
            id: "host",
            controllerId: hostController,
            ownerId: hostController,
        });
        const gadgeteer = makeInstance(FORENSIC_GADGETEER_ID, {
            id: "gadgeteer",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1Battlefield =
            hostController === "p1" ? [host, gadgeteer] : [gadgeteer];
        const p2Battlefield = hostController === "p2" ? [host] : [];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: p1Battlefield }),
                makePlayer("p2", { battlefield: p2Battlefield }),
            ],
        });
        return { state, host };
    }

    it("reduces its controller's artifact ability by {1}, floored at one mana (CR 118.7)", () => {
        const { state, host } = board(DRAGON_ENGINE_ID, "p1");
        // Dragon Engine's {2} pump ability: {2} - {1} = {1}.
        expect(effectiveAbilityCost(state, host, "dragon-engine-pump")).toEqual(
            { X: 1 }
        );
    });

    it("does NOT reduce a non-artifact permanent's ability", () => {
        const { state, host } = board(ANCIENT_KAVU_ID, "p1");
        // Unreduced {2} — the artifact-type scope excludes this creature.
        expect(
            effectiveAbilityCost(state, host, "ancient-kavu-colorless")
        ).toEqual({ X: 2 });
    });

    it("does NOT reduce an artifact ability its controller doesn't control ('artifacts YOU control')", () => {
        const { state, host } = board(DRAGON_ENGINE_ID, "p2");
        expect(effectiveAbilityCost(state, host, "dragon-engine-pump")).toEqual(
            { X: 2 }
        );
    });

    it("wire format: the reduction survives projectPublicState", () => {
        const { state, host } = board(DRAGON_ENGINE_ID, "p1");
        const projected = projectPublicState(state as GameState, 1, "p1");
        const slimHost = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(
            effectiveAbilityCost(
                projected as unknown as GameState,
                slimHost as unknown as CardInstanceState,
                "dragon-engine-pump"
            )
        ).toEqual({ X: 1 });
    });
});
