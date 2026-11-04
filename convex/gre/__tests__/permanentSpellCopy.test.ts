// A copy of a permanent spell becomes a token as it resolves (CR 707.10f,
// CR 608.3f). The token is not "created": token-creation events, triggers and
// replacements never see it, while everything that watches a permanent entering
// does. Off the stack without resolving, the copy ceases to exist (CR 707.10a).
//
// Copies are made by a fixture that copies its target whatever it is, because
// the one shipped card that copies a permanent spell copies only itself.

import { describe, expect, it } from "vitest";
import {
    emitSpellCastEvent,
    resolveTopOfStack,
    type GameState,
    type StackItem,
} from "../state";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { preloadDefinitions, registerTokenDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import { counterspell, grizzlyBears } from "../../cards/sets/lea/index.cards";
import { containmentPriest } from "../../cards/sets/c14/white.cards";
import { wormsOfTheEarth } from "../../cards/sets/drk/black.cards";
import { voiceOfAll } from "../../cards/sets/pls/white.cards";
import {
    elspethStormSlayer,
    sageOfTheSkies,
} from "../../cards/sets/tdm/white.cards";

// Base-owned `data/catalogue` (ADR 0157) lacks a card this PR ships.
preloadDefinitions([sageOfTheSkies()]);

const COPIER_ID = "test:permanent-copy-copier";
registerTokenDefinition({
    id: COPIER_ID,
    rarity: "common",
    name: "Blind Copier",
    manaCost: {},
    types: ["Sorcery"],
    targetRequirement: { type: "spell", count: 1 },
    resolve: (ctx) => {
        const target = ctx.targets?.[0];
        if (target?.type === "spell") ctx.copyStackItem(target.id);
    },
});

const CREATED_WATCHER_ID = "test:permanent-copy-created-watcher";
const createdWatcher: CardDefinition = {
    id: CREATED_WATCHER_ID,
    rarity: "common",
    name: "Created Watcher",
    manaCost: {},
    types: ["Enchantment"],
    triggeredAbilities: [
        {
            id: "created-watch",
            oracleText: "Whenever one or more tokens are created, gain 1 life.",
            event: "TOKENS_CREATED",
            matches: (event) => event.type === "TOKENS_CREATED",
            effects: [{ op: "gainLife", player: "controller", amount: 1 }],
        },
    ],
};
registerTokenDefinition(createdWatcher);

const ENTERED_WATCHER_ID = "test:permanent-copy-entered-watcher";
const enteredWatcher: CardDefinition = {
    id: ENTERED_WATCHER_ID,
    rarity: "common",
    name: "Entered Watcher",
    manaCost: {},
    types: ["Enchantment"],
    triggeredAbilities: [
        {
            id: "entered-watch",
            oracleText: "Whenever a creature enters, gain 1 life.",
            event: "PERMANENT_ENTERED",
            matches: (event) =>
                event.type === "PERMANENT_ENTERED" &&
                event.types.includes("Creature"),
            effects: [{ op: "gainLife", player: "controller", amount: 1 }],
        },
    ],
};
registerTokenDefinition(enteredWatcher);

const COPY_WATCHER_ID = "test:permanent-copy-copy-watcher";
const copyWatcher: CardDefinition = {
    id: COPY_WATCHER_ID,
    rarity: "common",
    name: "Copy Watcher",
    manaCost: {},
    types: ["Enchantment"],
    triggeredAbilities: [
        {
            id: "copy-watch",
            oracleText: "Whenever a player copies a spell, gain 1 life.",
            event: "SPELL_COPIED",
            matches: (event) => event.type === "SPELL_COPIED",
            effects: [{ op: "gainLife", player: "controller", amount: 1 }],
        },
    ],
};
registerTokenDefinition(copyWatcher);

/** A land that is also a castable type, so it resolves through the permanent
 *  branch, the one shape Worms of the Earth stops from entering. */
const LAND_SPELL_ID = "test:permanent-copy-land-spell";
registerTokenDefinition({
    id: LAND_SPELL_ID,
    rarity: "common",
    name: "Land Spell",
    manaCost: {},
    types: ["Land", "Creature"],
    power: 1,
    toughness: 1,
});

/** "Counter target spell. Exile it instead of putting it into its owner's
 *  graveyard" — a destination that never passes through the graveyard chokepoint. */
const EXILING_COUNTER_ID = "test:permanent-copy-exiling-counter";
registerTokenDefinition({
    id: EXILING_COUNTER_ID,
    rarity: "common",
    name: "Exiling Counter",
    manaCost: {},
    types: ["Instant"],
    targetRequirement: { type: "spell", count: 1 },
    effects: [{ op: "counter", target: { target: 0 }, destination: "exile" }],
});

/** "If a token that wasn't cast would enter, exile it instead" — reaches the
 *  CR 614 exile verdict a copy must answer by ceasing to exist, and reads both
 *  facts the copy presents to the chokepoint. */
const TOKEN_EXILER_ID = "test:permanent-copy-token-exiler";
registerTokenDefinition({
    id: TOKEN_EXILER_ID,
    rarity: "common",
    name: "Token Exiler",
    manaCost: {},
    types: ["Enchantment"],
    replacementEffects: [
        {
            id: "token-exiler",
            oracleText:
                "If a token that wasn't cast would enter, exile it instead.",
            eventKind: "enters-battlefield",
            appliesTo: (event) =>
                event.kind === "enters-battlefield" &&
                event.isToken &&
                !event.wasCast,
            replace: (event) => {
                if (event.kind !== "enters-battlefield") {
                    throw new Error("unexpected event kind");
                }
                return {
                    kind: "modified",
                    event: { ...event, destination: "exile" },
                };
            },
        },
    ],
});

const permanent = (cardId: string, pid: "p1" | "p2", id: string) =>
    makeInstance(cardId, {
        id,
        controllerId: pid,
        ownerId: pid,
        zone: "battlefield",
    });

function board(p1: string[] = [], p2: string[] = []): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: p1.map((c, i) => permanent(c, "p1", `p1-${i}`)),
            }),
            makePlayer("p2", {
                battlefield: p2.map((c, i) => permanent(c, "p2", `p2-${i}`)),
            }),
        ],
    });
}

/** p2's spell is on the stack; p1 copies it. Returns the original and the copy. */
function copyOfSpell(
    state: GameState,
    cardId: string
): { original: StackItem; copy: StackItem } {
    const original = pushSpell(state, cardId, "p2");
    pushSpell(state, COPIER_ID, "p1", [{ type: "spell", id: original.id }]);
    resolveTopOfStack(state);
    const copy = state.stack.find((s) => s.isCopy && !s.triggeredAbilityId);
    if (!copy) throw new Error("no copy on the stack");
    return { original, copy };
}

const battlefield = (state: GameState, index: 0 | 1) =>
    state.players[index].battlefield;

/** What reached a zone off the battlefield, the copier itself aside: it is a
 *  real card, and goes to its graveyard as it resolves. */
const offBattlefield = (state: GameState) =>
    state.players
        .flatMap((p) => [...p.graveyard, ...p.exile, ...p.hand, ...p.library])
        .filter((c) => (c.card as { id: string }).id !== COPIER_ID);

const triggersOn = (state: GameState, abilityId: string) =>
    state.stack.filter((s) => s.triggeredAbilityId === abilityId);

describe("copying a permanent spell (CR 707.10, CR 707.10f)", () => {
    it("puts a copy on the stack, and resolving it puts a token under the copier's control", () => {
        const state = board();
        const { original, copy } = copyOfSpell(state, grizzlyBears().id);

        // CR 707.10 — owned and controlled by the player who put it there.
        expect(copy.controllerId).toBe("p1");
        expect(copy.ownerId).toBe("p1");
        expect(state.stack.map((s) => s.id)).toEqual([original.id, copy.id]);

        resolveTopOfStack(state);

        const [token] = battlefield(state, 0);
        expect(token.id).toBe(copy.id);
        expect(token.isToken).toBe(true);
        expect((token as StackItem).isCopy).toBeUndefined();
        expect(token.ownerId).toBe("p1");
        expect(token.controllerId).toBe("p1");
        expect((token.card as { id: string }).id).toBe(grizzlyBears().id);
        expect(token.types).toEqual(["Creature"]);
        expect(token.subtypes).toEqual(["Bear"]);
        expect([token.power, token.toughness]).toEqual([2, 2]);
        expect(offBattlefield(state)).toEqual([]);
    });

    it("leaves the original a real spell that resolves into a nontoken permanent", () => {
        const state = board();
        const { original } = copyOfSpell(state, grizzlyBears().id);
        resolveTopOfStack(state);
        resolveTopOfStack(state);

        const [bears] = battlefield(state, 1);
        expect(bears.id).toBe(original.id);
        expect(bears.isToken).toBeUndefined();
    });

    it("carries the decisions made for the original (CR 707.10) but not its cast provenance", () => {
        const state = board();
        const original = pushSpell(state, grizzlyBears().id, "p2");
        original.chosenX = 3;
        original.dynamicHasteFromMana = true;
        original.graveyardPermissionRider = {
            sourceCardId: "source",
            abilityId: "rider",
        };
        pushSpell(state, COPIER_ID, "p1", [{ type: "spell", id: original.id }]);
        resolveTopOfStack(state);
        const copy = state.stack[state.stack.length - 1];

        expect(copy.chosenX).toBe(3);
        expect(copy.dynamicHasteFromMana).toBeUndefined();
        expect(copy.graveyardPermissionRider).toBeUndefined();
    });
});

describe("the token is not created (CR 608.3f)", () => {
    it("fires no token-creation trigger", () => {
        const state = board([CREATED_WATCHER_ID]);
        copyOfSpell(state, grizzlyBears().id);
        resolveTopOfStack(state);

        expect(battlefield(state, 0).filter((c) => c.isToken)).toHaveLength(1);
        expect(triggersOn(state, "created-watch")).toEqual([]);
    });

    it("is ignored by a token-creation replacement effect (Elspeth, Storm Slayer)", () => {
        const state = board([elspethStormSlayer().id]);
        copyOfSpell(state, grizzlyBears().id);
        resolveTopOfStack(state);

        expect(battlefield(state, 0).filter((c) => c.isToken)).toHaveLength(1);
    });
});

describe("the token does enter the battlefield (CR 608.3f)", () => {
    it("fires an enters trigger, naming a token that was not cast (CR 707.10)", () => {
        const state = board([ENTERED_WATCHER_ID]);
        copyOfSpell(state, grizzlyBears().id);
        resolveTopOfStack(state);

        const [trigger] = triggersOn(state, "entered-watch");
        expect(trigger.triggerEvent).toMatchObject({
            type: "PERMANENT_ENTERED",
            isToken: true,
        });
        expect(trigger.triggerEvent).not.toHaveProperty("wasCast");
    });

    it("answers an 'enters' replacement effect as a token that wasn't cast (Containment Priest)", () => {
        const state = board([containmentPriest().id]);
        copyOfSpell(state, grizzlyBears().id);
        resolveTopOfStack(state);

        expect(battlefield(state, 0).filter((c) => c.isToken)).toHaveLength(1);
        expect(offBattlefield(state)).toEqual([]);
    });

    it("owes its 'as enters' choices, and still becomes a token once they are answered (CR 614.12a)", () => {
        const state = board();
        const { copy } = copyOfSpell(state, voiceOfAll().id);
        resolveTopOfStack(state);
        expect(battlefield(state, 0)).toEqual([]);

        const pending = state.pendingChoices?.[0];
        if (!pending) throw new Error("no as-enters choice");
        applyPendingChoiceSubmit(state, {
            playerId: pending.playerId,
            stackItemId: pending.stackItemId,
            step: pending.step,
            choiceId: pending.choiceId,
            cardInstanceIds: ["W"],
        });

        const [token] = battlefield(state, 0);
        expect(token.id).toBe(copy.id);
        expect(token.isToken).toBe(true);
    });
});

describe("a copy that leaves the stack without resolving ceases to exist (CR 707.10a)", () => {
    it("countered: nothing reaches any zone", () => {
        const state = board();
        const { copy } = copyOfSpell(state, grizzlyBears().id);
        pushSpell(state, counterspell().id, "p2", [
            { type: "spell", id: copy.id },
        ]);
        resolveTopOfStack(state);

        expect(state.stack.some((s) => s.id === copy.id)).toBe(false);
        // The Counterspell itself is the only card that reached a zone.
        expect(offBattlefield(state).map((c) => c.card)).toEqual([
            expect.objectContaining({ id: counterspell().id }),
        ]);
        expect(battlefield(state, 0)).toEqual([]);
    });

    it("countered with exile as the destination: nothing reaches exile", () => {
        const state = board();
        const { copy } = copyOfSpell(state, grizzlyBears().id);
        pushSpell(state, EXILING_COUNTER_ID, "p2", [
            { type: "spell", id: copy.id },
        ]);
        resolveTopOfStack(state);

        expect(state.stack.some((s) => s.id === copy.id)).toBe(false);
        expect(state.players.flatMap((p) => p.exile)).toEqual([]);
    });

    it("a land copy Worms of the Earth stops from entering reaches no graveyard", () => {
        const state = board([wormsOfTheEarth().id]);
        const { copy } = copyOfSpell(state, LAND_SPELL_ID);
        resolveTopOfStack(state);

        expect(state.stack.some((s) => s.id === copy.id)).toBe(false);
        expect(offBattlefield(state)).toEqual([]);
    });

    it("exiled instead of entering: nothing reaches exile", () => {
        const state = board([TOKEN_EXILER_ID]);
        const { copy } = copyOfSpell(state, grizzlyBears().id);
        resolveTopOfStack(state);

        expect(state.stack.some((s) => s.id === copy.id)).toBe(false);
        expect(battlefield(state, 0).map((c) => c.id)).not.toContain(copy.id);
        expect(offBattlefield(state)).toEqual([]);
    });
});

describe("a copy is not cast (CR 707.10)", () => {
    it("moves no tally and fires no 'when you cast this spell' trigger of its own", () => {
        const state = board();
        const p2 = state.players[1];
        p2.spellsCastThisTurn = 1;
        const original = pushSpell(state, sageOfTheSkies().id, "p2");
        emitSpellCastEvent(state, original);
        const castTrigger = triggersOn(state, "sage-of-the-skies-copy");
        expect(castTrigger).toHaveLength(1);
        const tallies = () => ({
            table: state.spellsCastThisTurn,
            p1: state.players[0].spellsCastThisTurn,
            p2: state.players[1].spellsCastThisTurn,
        });
        const before = tallies();

        // The trigger copies the spell; the copy is on the stack and has not
        // triggered again.
        resolveTopOfStack(state);
        expect(state.stack.filter((s) => s.isCopy)).toHaveLength(1);
        expect(triggersOn(state, "sage-of-the-skies-copy")).toEqual([]);
        expect(tallies()).toEqual(before);
    });

    it("the copy a card's cast trigger makes emits SPELL_COPIED, not as a keyword's cast-copy", () => {
        const state = board([COPY_WATCHER_ID]);
        state.players[1].spellsCastThisTurn = 1;
        const original = pushSpell(state, sageOfTheSkies().id, "p2");
        emitSpellCastEvent(state, original);
        resolveTopOfStack(state);

        const [watched] = triggersOn(state, "copy-watch");
        expect(watched.triggerEvent).toMatchObject({
            type: "SPELL_COPIED",
            copierId: "p2",
            originalSpellInstanceId: original.id,
            fromCastCopyTrigger: false,
        });
    });
});
