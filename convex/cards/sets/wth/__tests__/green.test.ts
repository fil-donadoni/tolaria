// Weatherlight (WTH) — green card behavior tests (ADR 0043 colour split).
// Each describe block cites the CR section it exercises.
import { describe, it, expect } from "vitest";
import { gaeasBlessing } from "../green";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    type CardInstanceState,
    type GameState,
    type StackItem,
    resolveTopOfStack,
} from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { registerTokenDefinition, getCardByName } from "../../../index";
import type { GameEvent } from "../../../types";

const FOREST = getCardByName("Forest").id;
const MILL_ABILITY = "gaeas-blessing-mill-shuffle";

/** A CARD_MILLED event for `instanceId`, owned by `owner` (issue #1055). */
const MILLED = (
    owner: string,
    instanceId: string,
    cardId?: string
): GameEvent =>
    ({
        type: "CARD_MILLED",
        ownerId: owner,
        cardInstanceId: instanceId,
        ...(cardId ? { cardId } : {}),
    }) as GameEvent;

/** Push a triggered ability onto the stack with its firing event, then resolve. */
function resolveTrigger(
    state: GameState,
    source: CardInstanceState,
    triggeredAbilityId: string,
    triggerEvent: StackItem["triggerEvent"]
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId,
        triggerSourceId: source.id,
        triggerEvent,
        targets: [],
    });
    resolveTopOfStack(state);
}

describe("Gaea's Blessing — mill self-trigger (CR 701.17 / 603.6e, issue #1055)", () => {
    it("collectTriggers fires the trigger when THIS card is milled (self-scope)", () => {
        const gaea = makeInstance(gaeasBlessing.id, {
            id: "gaea",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [gaea] }),
                makePlayer("p2"),
            ],
        });
        const fired = collectTriggers(state, [
            MILLED("p1", "gaea", gaeasBlessing.id),
        ]);
        expect(fired.some((t) => t.triggeredAbilityId === MILL_ABILITY)).toBe(
            true
        );
    });

    it("does NOT fire when a DIFFERENT card is milled (CR 603.2b self-scope)", () => {
        const gaea = makeInstance(gaeasBlessing.id, {
            id: "gaea",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [gaea] }),
                makePlayer("p2"),
            ],
        });
        const fired = collectTriggers(state, [MILLED("p1", "some-other-card")]);
        expect(fired.some((t) => t.triggeredAbilityId === MILL_ABILITY)).toBe(
            false
        );
    });

    it("resolving the trigger shuffles the owner's whole graveyard into their library", () => {
        const gaea = makeInstance(gaeasBlessing.id, {
            id: "gaea",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const junkA = makeInstance(FOREST, {
            id: "a",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const junkB = makeInstance(FOREST, {
            id: "b",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const libCard = makeInstance(FOREST, {
            id: "lib",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [gaea, junkA, junkB],
                    library: [libCard],
                }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(
            state,
            gaea,
            MILL_ABILITY,
            MILLED("p1", "gaea", gaeasBlessing.id)
        );
        // Whole graveyard moved into the library (CR 701.24 "shuffle your
        // graveyard into your library"); order is randomized, so assert as a set.
        expect(state.players[0].graveyard).toHaveLength(0);
        expect(state.players[0].library.map((c) => c.id).sort()).toEqual([
            "a",
            "b",
            "gaea",
            "lib",
        ]);
    });

    it("end-to-end: a mill emits CARD_MILLED, the engine queues the trigger, and it shuffles back (millCards choke point)", () => {
        // Ad-hoc self-mill sorcery exercising the real mill Op → millCards path.
        registerTokenDefinition({
            id: "test-gaea-self-mill",
            name: "test-gaea-self-mill",
            rarity: "common",
            manaCost: { X: 1 },
            types: ["Sorcery"],
            targetRequirement: { type: "player", count: 1 },
            effects: [{ op: "mill", player: { target: 0 }, count: 1 }],
        });
        const gaea = makeInstance(gaeasBlessing.id, {
            id: "gaea",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const junk = makeInstance(FOREST, {
            id: "junk",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { library: [gaea], graveyard: [junk] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, "test-gaea-self-mill", "p1", [
            { type: "player", id: "p1" },
        ]);
        // Mill resolves: Gaea moves library→graveyard, millCards emits
        // CARD_MILLED, and the post-resolution scan queues Gaea's trigger.
        resolveTopOfStack(state);
        expect(
            state.stack.some((s) => s.triggeredAbilityId === MILL_ABILITY)
        ).toBe(true);
        // Resolve the trigger: the whole graveyard shuffles into the library.
        resolveTopOfStack(state);
        expect(state.players[0].graveyard).toHaveLength(0);
        const libIds = state.players[0].library.map((c) => c.id);
        expect(libIds).toContain("gaea");
        expect(libIds).toContain("junk");
    });
});
