// tdm (Tarkir: Dragonstorm) — white behavior tests (ADR 0043 colour split).
//
// Elspeth, Storm Slayer (issue #3230). She is the first consumer of the
// `"token-created"` `ReplacementEventKind` (CR 111.1 / 614), so this file
// asserts the CARD: the framework itself — CR 614.5 one-shot bookkeeping, the
// controller scope, the "a permanent merely entering is not a token being
// created" negative — is proven with synthetic sources in
// `gre/__tests__/countReplacements.test.ts`.
//
// Every assertion runs through a REAL path: a loyalty ability resolved by
// `resolveTopOfStack`, or `createTokenPermanents` (the one chokepoint every
// token creation funnels through). The point of the card is that NOTHING about
// her +1 knows about her static — the doubling has to fall out of the shared
// seam, and a test that hand-built the doubled count would prove nothing.
import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup.helper";
import type { GameState, StackItem } from "../../../../gre/state";
import {
    createTokenPermanents,
    emitSpellCastEvent,
    resolveTopOfStack,
} from "../../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { getLegalTargets, pendingTargetingSource } from "../../../../gre/rules";
import { projectPublicState } from "../../../../gameProjections";
import { getDefinition, preloadDefinitions } from "../../../index";
import type { TokenSpec } from "../../../types";
import { sageOfTheSkies as sageOfTheSkiesDefinition } from "../white.cards";

// Base-owned `data/catalogue` (ADR 0157) lacks a card this PR ships.
preloadDefinitions([sageOfTheSkiesDefinition()]);

const elspeth = getDefinition("73a065e3-b530-4e62-ab3c-4f6f908184ec");
const grizzlyBears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");
// Serra Angel — {3}{W}{W}, mana value 5: the "3 or greater" side of the -3.
const serraAngel = getDefinition("f8ac5006-91bd-4803-93da-f87cf196dd2f");

const PLUS1 = "elspeth-storm-slayer-plus1";
const ZERO = "elspeth-storm-slayer-zero";
const MINUS3 = "elspeth-storm-slayer-minus3";

const SOLDIER: TokenSpec = {
    name: "Soldier",
    types: ["Creature"],
    subtypes: ["Soldier"],
    colors: ["W"],
    power: 1,
    toughness: 1,
};

function elspethOnBattlefield(loyalty = 5) {
    return makeInstance(elspeth.id, {
        id: "elspeth1",
        controllerId: "p1",
        ownerId: "p1",
        counters: { loyalty },
    });
}

/** Pushes one of Elspeth's loyalty abilities and resolves it through the real
 *  path — the loyalty COST is exercised in `game.ts`; a card test asserts the
 *  EFFECT (the Ugin / Chandra harness, `tdm/__tests__/colorless.test.ts`). */
function activate(state: GameState, abilityId: string): void {
    const source = state.players[0].battlefield.find(
        (c) => c.id === "elspeth1"
    )!;
    state.stack.push({
        ...source,
        zone: "stack",
        castById: "p1",
        abilityId,
    });
    resolveTopOfStack(state);
}

describe("Elspeth, Storm Slayer — token doubling (CR 111.1 / 614, issue #3230)", () => {
    it("her own +1 is doubled by her own static: one Soldier becomes two", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [elspethOnBattlefield()] }),
                makePlayer("p2"),
            ],
        });
        activate(state, PLUS1);
        const tokens = state.players[0].battlefield.filter((c) => c.isToken);
        expect(tokens).toHaveLength(2);
        expect(tokens.every((t) => t.subtypes.includes("Soldier"))).toBe(true);
    });

    it("doubles a token created under her controller's control by ANY effect, and leaves an opponent's tokens alone", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [elspethOnBattlefield()] }),
                makePlayer("p2"),
            ],
        });
        expect(createTokenPermanents(state, SOLDIER, "p1", 2)).toHaveLength(4);
        expect(createTokenPermanents(state, SOLDIER, "p2", 2)).toHaveLength(2);
    });
});

describe("Elspeth, Storm Slayer — loyalty abilities (issue #3230)", () => {
    it("0: puts a +1/+1 counter on each creature you control and grants them flying, visible after projection", () => {
        const mine = makeInstance(grizzlyBears.id, {
            id: "mine",
            controllerId: "p1",
            ownerId: "p1",
        });
        const theirs = makeInstance(grizzlyBears.id, {
            id: "theirs",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [elspethOnBattlefield(), mine],
                }),
                makePlayer("p2", { battlefield: [theirs] }),
            ],
        });
        activate(state, ZERO);

        const mineAfter = state.players[0].battlefield.find(
            (c) => c.id === "mine"
        )!;
        expect(mineAfter.counters).toEqual({ "+1/+1": 1 });
        expect(getEffectivePower(state, mineAfter)).toBe(3);
        expect(getEffectiveToughness(state, mineAfter)).toBe(3);
        // The opponent's creature is untouched (CR 109.5 — "you control").
        expect(
            state.players[1].battlefield.find((c) => c.id === "theirs")!
                .counters
        ).toBeUndefined();

        // SURFACE — the grant and the counter both have to survive the
        // projection, or the client renders a 2/2 ground creature.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "mine"
        )!;
        expect(slim.staticAbilities).toContain("flying");
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });

    it("-3: only an opponent's creature with mana value 3 or greater is a legal target", () => {
        const big = makeInstance(serraAngel.id, {
            id: "big",
            controllerId: "p2",
            ownerId: "p2",
        });
        const small = makeInstance(grizzlyBears.id, {
            id: "small",
            controllerId: "p2",
            ownerId: "p2",
        });
        const ownBig = makeInstance(serraAngel.id, {
            id: "ownBig",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [elspethOnBattlefield(), ownBig],
                }),
                makePlayer("p2", { battlefield: [big, small] }),
            ],
        });
        const requirement = elspeth.activatedAbilities!.find(
            (a) => a.id === MINUS3
        )!.targetRequirement!;
        const legal = getLegalTargets(
            state,
            requirement,
            pendingTargetingSource(state, "elspeth1", "ability"),
            "p1"
        );
        expect(legal.map((t) => t.id).sort()).toEqual(["big"]);
    });

    it("-3: destroys the announced creature", () => {
        const big = makeInstance(serraAngel.id, {
            id: "big",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [elspethOnBattlefield()] }),
                makePlayer("p2", { battlefield: [big] }),
            ],
        });
        const source = state.players[0].battlefield[0];
        state.stack.push({
            ...source,
            zone: "stack",
            castById: "p1",
            abilityId: MINUS3,
            targets: [{ type: "permanent", id: "big" }],
        });
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(["big"]);
    });
});

describe("Sage of the Skies (CR 603.4, CR 707.10f, issue #3658)", () => {
    const sage = sageOfTheSkiesDefinition();
    const TRIGGER = "sage-of-the-skies-copy";
    /** Counterspell — the spell that counters a Sage in response. */
    const COUNTERSPELL = "0df55e3f-14de-46ef-b6b1-616618724d9e";

    function table(): GameState {
        return makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
    }

    /** `casterId` casts Grizzly Bears through the cast choke point. */
    function castFiller(state: GameState, casterId: string): void {
        const item = pushSpell(state, grizzlyBears.id, casterId);
        emitSpellCastEvent(state, item);
        state.stack.pop();
    }

    function castSage(state: GameState): StackItem {
        const item = pushSpell(state, sage.id, "p1");
        emitSpellCastEvent(state, item);
        return item;
    }

    const triggers = (state: GameState) =>
        state.stack.filter((s) => s.triggeredAbilityId === TRIGGER);

    const sagesOnBattlefield = (state: GameState) =>
        state.players[0].battlefield.filter(
            (c) => (c.card as { id: string }).id === sage.id
        );

    it("as the turn's first spell: no trigger, one nontoken Sage", () => {
        const state = table();
        castSage(state);

        expect(triggers(state)).toEqual([]);
        resolveTopOfStack(state);
        expect(sagesOnBattlefield(state).map((c) => c.isToken)).toEqual([
            undefined,
        ]);
    });

    it("an opponent's spell is not one 'you've cast'", () => {
        const state = table();
        castFiller(state, "p2");
        castSage(state);

        expect(triggers(state)).toEqual([]);
    });

    it("as the second spell: the trigger resolves into a token Sage plus the original", () => {
        const state = table();
        castFiller(state, "p1");
        const original = castSage(state);
        expect(triggers(state)).toHaveLength(1);

        // The trigger, then the copy, then the original.
        resolveTopOfStack(state);
        expect(state.stack.map((s) => s.isCopy === true)).toEqual([
            false,
            true,
        ]);
        resolveTopOfStack(state);
        resolveTopOfStack(state);

        expect(state.stack).toEqual([]);
        const sages = sagesOnBattlefield(state);
        expect(sages).toHaveLength(2);
        const token = sages.find((c) => c.isToken)!;
        const nontoken = sages.find((c) => !c.isToken)!;
        expect(nontoken.id).toBe(original.id);
        expect(getEffectivePower(state, token)).toBe(2);
        expect(getEffectiveToughness(state, token)).toBe(3);
        expect(token.staticAbilities).toEqual(["flying", "lifelink"]);
        expect(token.subtypes).toEqual(["Human", "Monk"]);
    });

    it("the token Sage crosses the wire as a token presenting Sage's own card", () => {
        const state = table();
        castFiller(state, "p1");
        castSage(state);
        resolveTopOfStack(state);
        resolveTopOfStack(state);
        resolveTopOfStack(state);

        const view = projectPublicState(state, 1, "p1");
        const token = view.players[0].battlefield.find((c) => c.isToken)!;
        expect((token.card as { id: string }).id).toBe(sage.id);
        expect(getEffectivePower(view, token)).toBe(2);
        expect(getEffectiveToughness(view, token)).toBe(3);
        expect(token.staticAbilities).toEqual(["flying", "lifelink"]);
    });

    it("the condition false on resolution: the trigger does nothing (CR 603.4)", () => {
        const state = table();
        castFiller(state, "p1");
        castSage(state);
        state.players[0].spellsCastThisTurn = 1;

        resolveTopOfStack(state);

        expect(state.stack.filter((s) => s.isCopy)).toEqual([]);
    });

    it("countered in response: still copied, from its last known information (CR 113.7a, 608.2h)", () => {
        const state = table();
        castFiller(state, "p1");
        const original = castSage(state);
        pushSpell(state, COUNTERSPELL, "p2", [
            { type: "spell", id: original.id },
        ]);

        resolveTopOfStack(state);
        expect(state.stack.some((s) => s.id === original.id)).toBe(false);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual([
            original.id,
        ]);

        resolveTopOfStack(state);
        resolveTopOfStack(state);

        expect(state.stack).toEqual([]);
        const sages = sagesOnBattlefield(state);
        expect(sages.map((c) => c.isToken)).toEqual([true]);
        expect(getEffectivePower(state, sages[0])).toBe(2);
    });
});
