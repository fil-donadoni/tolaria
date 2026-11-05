// Demonstrate (CR 702.144): the `getDefinition` expansion seam, the cast trigger
// through `emitSpellCastEvent` and `resolveTopOfStack`, the sequenced retarget
// offers (CR 707.10c), the wire projection, and the compiler's verdict on a
// printed and on a granted demonstrate.

import { describe, expect, it } from "vitest";
import { projectPublicState } from "../../../gameProjections";
import { validateAbilityEffectScript } from "../../../gre/effects/validate";
import { applyMayPaySubmit } from "../../../gre/pendingChoiceSubmit";
import { applyRaisedTargetFinalization } from "../../../gre/pendingTargetOrigin";
import type { GameState, StackItem } from "../../../gre/state";
import { emitSpellCastEvent, resolveTopOfStack } from "../../../gre/state";
import { oracleCard } from "../../../oracle/__tests__/oracle.fixture";
import { compileCard } from "../../../oracle/compile";
import { getDefinition, preloadDefinitions } from "../..";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../__tests__/setup.helper";
import type { CardDefinition } from "../../types";
import {
    DEMONSTRATE_ORACLE_TEXT,
    DEMONSTRATE_TRIGGER_ID,
    demonstrateTrigger,
} from "../demonstrate";

/** Registers a sorcery so `getDefinition` runs it through the real expansion
 *  chain, the seam a printed card uses. */
function registerSorcery(
    id: string,
    fields: Partial<CardDefinition>,
    staticAbilities = ["demonstrate"]
): string {
    preloadDefinitions([
        {
            id,
            name: `Synthetic ${id}`,
            rarity: "rare",
            manaCost: { X: 1 },
            types: ["Sorcery"],
            staticAbilities,
            ...fields,
        } as CardDefinition,
    ]);
    return id;
}

/** "Target creature": each player has something else to point a copy at. */
const AIMED = registerSorcery("synthetic-demonstrate-aimed", {
    targetRequirement: { type: "Creature", count: 1 },
    effects: [{ op: "destroy", target: { target: 0 } }],
});
/** "Target card from your graveyard": what a legal target is depends on who
 *  controls the copy (Healing Technique's shape). */
const RAISE = registerSorcery("synthetic-demonstrate-raise", {
    targetRequirement: {
        type: "card",
        count: 1,
        zone: "graveyard",
        controller: "you",
    },
    effects: [{ op: "moveZone", target: { target: 0 }, to: "hand" }],
});
/** No target at all: nothing to offer (Incarnation Technique's shape). */
const LOOT = registerSorcery("synthetic-demonstrate-loot", {
    effects: [{ op: "draw", player: "controller", count: 1 }],
});
const DOUBLE = registerSorcery(
    "synthetic-demonstrate-double",
    { effects: [{ op: "draw", player: "controller", count: 1 }] },
    ["demonstrate", "demonstrate"]
);
const VANILLA = registerSorcery("synthetic-demonstrate-vanilla", {}, []);
const BEAR = "synthetic-demonstrate-bear";
preloadDefinitions([
    {
        id: BEAR,
        name: "Synthetic bear",
        rarity: "common",
        manaCost: { X: 2 },
        types: ["Creature"],
        subtypes: [],
        power: 2,
        toughness: 2,
    } as CardDefinition,
]);

const permanent = (id: string, owner: string) =>
    makeInstance(BEAR, {
        id,
        controllerId: owner,
        ownerId: owner,
        zone: "battlefield",
    });
const inGraveyard = (id: string, owner: string) =>
    makeInstance(VANILLA, {
        id,
        controllerId: owner,
        ownerId: owner,
        zone: "graveyard",
    });
const inLibrary = (id: string, owner: string) =>
    makeInstance(VANILLA, {
        id,
        controllerId: owner,
        ownerId: owner,
        zone: "library",
    });

function board(overrides: {
    p1Battlefield?: string[];
    p2Battlefield?: string[];
    p1Graveyard?: string[];
    p2Graveyard?: string[];
}): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: (overrides.p1Battlefield ?? []).map((id) =>
                    permanent(id, "p1")
                ),
                graveyard: (overrides.p1Graveyard ?? []).map((id) =>
                    inGraveyard(id, "p1")
                ),
                library: [inLibrary("p1-top", "p1"), inLibrary("p1-2nd", "p1")],
            }),
            makePlayer("p2", {
                battlefield: (overrides.p2Battlefield ?? []).map((id) =>
                    permanent(id, "p2")
                ),
                graveyard: (overrides.p2Graveyard ?? []).map((id) =>
                    inGraveyard(id, "p2")
                ),
                library: [inLibrary("p2-top", "p2")],
            }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
}

/** The cast's own choke point: the spell, then its cast triggers above it. */
function cast(
    state: GameState,
    cardId: string,
    targets: StackItem["targets"] = []
): StackItem {
    const spell = pushSpell(state, cardId, "p1", targets);
    spell.zone = "stack";
    emitSpellCastEvent(state, spell);
    return spell;
}

/** Resolves the trigger on top and answers its "you may copy it". */
function resolveTriggerAnswering(state: GameState, accept: boolean): void {
    resolveTopOfStack(state);
    expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
    expect(state.pendingChoices?.[0]?.playerId).toBe("p1");
    applyMayPaySubmit(state, { playerId: "p1", accept });
}

const copies = (state: GameState) => state.stack.filter((s) => s.isCopy);

function answerRetarget(state: GameState, selected: string[]): void {
    const pt = state.pendingTarget!;
    pt.selected = selected.map((id) => ({ type: "permanent", id }));
    expect(applyRaisedTargetFinalization(state, pt)).toBe(true);
}

describe("Demonstrate — the keyword expansion (CR 702.144a)", () => {
    it("declaring the keyword yields the cast trigger through getDefinition", () => {
        const abilities = getDefinition(LOOT).triggeredAbilities ?? [];
        expect(abilities.map((t) => t.id)).toEqual([DEMONSTRATE_TRIGGER_ID]);
        expect(abilities[0].oracleText).toBe(DEMONSTRATE_ORACLE_TEXT);
        expect(abilities[0].functionsFromStack).toBe(true);
    });

    it("the injected script passes the validator", () => {
        expect(
            validateAbilityEffectScript(demonstrateTrigger(), "Demonstrate")
        ).toEqual([]);
    });

    it("each declared instance is its own trigger", () => {
        const state = board({});
        cast(state, DOUBLE);
        expect(
            state.stack.filter(
                (s) => s.triggeredAbilityId === DEMONSTRATE_TRIGGER_ID
            )
        ).toHaveLength(2);
    });

    it("a card without the keyword is untouched", () => {
        expect(getDefinition(VANILLA).triggeredAbilities ?? []).toEqual([]);
    });
});

describe("Demonstrate — the cast trigger (CR 702.144a)", () => {
    it("goes on the stack above the spell and asks the caster, never auto-copies", () => {
        const state = board({});
        cast(state, LOOT);
        expect(state.stack.map((s) => s.triggeredAbilityId)).toEqual([
            undefined,
            DEMONSTRATE_TRIGGER_ID,
        ]);
        resolveTopOfStack(state);
        expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
        expect(state.pendingChoices?.[0]?.playerId).toBe("p1");
        expect(copies(state)).toEqual([]);
    });

    it("declining copies nothing: the opponent's copy hangs on the caster's", () => {
        const state = board({});
        const spell = cast(state, LOOT);
        resolveTriggerAnswering(state, false);
        expect(copies(state)).toEqual([]);
        expect(state.stack.map((s) => s.id)).toEqual([spell.id]);
    });

    it("accepting makes one copy each, and the opponent's resolves first", () => {
        const state = board({});
        const spell = cast(state, LOOT);
        resolveTriggerAnswering(state, true);
        expect(state.stack[0].id).toBe(spell.id);
        expect(state.stack.slice(1).map((s) => s.controllerId)).toEqual([
            "p1",
            "p2",
        ]);
        expect(state.stack.slice(1).every((s) => s.isCopy)).toBe(true);
        expect(state.pendingTarget).toBeUndefined();
    });

    it("each copy resolves for its own controller, and none re-triggers", () => {
        const state = board({});
        cast(state, LOOT);
        resolveTriggerAnswering(state, true);
        resolveTopOfStack(state);
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["p2-top"]);
        expect(state.players[0].hand).toEqual([]);
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["p1-top"]);
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id)).toEqual([
            "p1-top",
            "p1-2nd",
        ]);
        expect(state.stack).toEqual([]);
    });

    it("countered in response, the spell is still copied from its snapshot", () => {
        const state = board({});
        const spell = cast(state, LOOT);
        state.stack.splice(
            state.stack.findIndex((s) => s.id === spell.id),
            1
        );
        resolveTriggerAnswering(state, true);
        expect(state.stack.map((s) => s.controllerId)).toEqual(["p1", "p2"]);
        expect(state.stack.every((s) => s.isCopy)).toBe(true);
    });
});

describe("Demonstrate — choosing new targets, one player at a time (CR 707.10c)", () => {
    const targets = [{ type: "permanent" as const, id: "theirs" }];

    function aimed(): GameState {
        const state = board({
            p1Battlefield: ["mine"],
            p2Battlefield: ["theirs"],
        });
        cast(state, AIMED, targets);
        resolveTriggerAnswering(state, true);
        return state;
    }

    it("the caster answers first, with the opponent's offer waiting behind it", () => {
        const state = aimed();
        const [mine, theirs] = copies(state);
        expect(state.pendingTarget?.kind).toBe("copy-retarget");
        expect(state.pendingTarget?.playerId).toBe("p1");
        expect(state.pendingTarget?.cardInstanceId).toBe(mine.id);
        expect(state.queuedCopyRetargets).toEqual([theirs.id]);
    });

    it("answering the first raises the second, before anyone has priority", () => {
        const state = aimed();
        const [mine, theirs] = copies(state);
        answerRetarget(state, ["mine"]);
        expect(mine.targets).toEqual([{ type: "permanent", id: "mine" }]);
        expect(state.pendingTarget?.playerId).toBe("p2");
        expect(state.pendingTarget?.cardInstanceId).toBe(theirs.id);
        expect(state.queuedCopyRetargets).toBeUndefined();
    });

    it("answering the last writes its targets and opens the priority round", () => {
        const state = aimed();
        const [, theirs] = copies(state);
        answerRetarget(state, ["theirs"]);
        answerRetarget(state, ["mine"]);
        expect(theirs.targets).toEqual([{ type: "permanent", id: "mine" }]);
        expect(state.pendingTarget).toBeUndefined();
        expect(state.priorityPlayerId).toBe("p1");
    });

    it("a queued offer crosses the wire to the player who will answer next", () => {
        const state = aimed();
        const projected = projectPublicState(state, 1, "p2");
        const opponentsCopy = copies(state)[1];
        expect(
            projected.stack.find((s) => s.id === opponentsCopy.id)?.controllerId
        ).toBe("p2");
        expect(projected.pendingTarget?.playerId).toBe("p1");
        // The client Brain answers from this view, so the queue must survive it.
        expect(projected.queuedCopyRetargets).toEqual([opponentsCopy.id]);
    });

    it("a copy with no other legal target keeps its own and asks nobody", () => {
        const state = board({ p1Graveyard: ["only-card"] });
        cast(state, RAISE, [
            { type: "graveyard-card", id: "only-card", playerId: "p1" },
        ]);
        resolveTriggerAnswering(state, true);
        expect(copies(state).map((s) => s.controllerId)).toEqual(["p1", "p2"]);
        expect(state.pendingTarget).toBeUndefined();
        expect(state.queuedCopyRetargets).toBeUndefined();
    });

    it("the opponent's copy offers THEIR graveyard, not the caster's", () => {
        const state = board({
            p1Graveyard: ["my-card"],
            p2Graveyard: ["their-card"],
        });
        cast(state, RAISE, [
            { type: "graveyard-card", id: "my-card", playerId: "p1" },
        ]);
        resolveTriggerAnswering(state, true);
        const [, theirs] = copies(state);
        expect(state.pendingTarget?.playerId).toBe("p2");
        expect(state.pendingTarget?.cardInstanceId).toBe(theirs.id);
        const pt = state.pendingTarget!;
        pt.selected = [
            { type: "graveyard-card", id: "their-card", playerId: "p2" },
        ];
        applyRaisedTargetFinalization(state, pt);
        resolveTopOfStack(state);
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["their-card"]);
    });

    it("the opponent's copy, left aimed at the caster's graveyard, does nothing (CR 608.2b)", () => {
        const state = board({ p1Graveyard: ["my-card"] });
        cast(state, RAISE, [
            { type: "graveyard-card", id: "my-card", playerId: "p1" },
        ]);
        resolveTriggerAnswering(state, true);
        resolveTopOfStack(state);
        expect(state.players[1].hand).toEqual([]);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual([
            "my-card",
        ]);
    });
});

describe("Demonstrate — the compiler's verdict (ADR 0105)", () => {
    it("releases a printed demonstrate, carrying the keyword the seam expands", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Synthetic demonstrate",
                typeLine: "Sorcery",
                manaCost: "{4}{B}",
                power: undefined,
                toughness: undefined,
                oracleText: `${DEMONSTRATE_ORACLE_TEXT}\nDraw a card.`,
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(outcome.definition.staticAbilities).toEqual(["demonstrate"]);
    });

    it("keeps a granted demonstrate in quarantine: a grant never reaches the expander", () => {
        const outcome = compileCard(
            oracleCard({
                typeLine: "Enchantment",
                manaCost: "{4}{W}{W}",
                power: undefined,
                toughness: undefined,
                oracleText: "Creatures you control have demonstrate.",
            })
        );
        expect(outcome.state).toBe("quarantine");
        if (outcome.state !== "quarantine") return;
        expect(outcome.reasons.map((r) => r.kind)).toEqual([
            "ungrantable-keyword",
        ]);
    });
});
