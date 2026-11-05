// Cipher (CR 702.99, issue #4017).
//
// CR 702.99a — "If this spell is represented by a card, you may exile this card
// encoded on a creature you control" and "For as long as this card is encoded on
// that creature, that creature has 'Whenever this creature deals combat damage to
// a player, you may copy the encoded card and you may cast the copy without paying
// its mana cost.'"
// CR 702.99c — it stays encoded through a change of controller or of creature-ness,
// as long as the card stays exiled and the creature on the battlefield.
//
// Driven through `resolveTopOfStack`, the real combat damage step, the submit seam
// a client's pick takes, `compactState` and `projectPublicState`. The Bot's side is
// `cipher.bot.test.ts`.

import { describe, expect, it } from "vitest";
import { registerTokenDefinition } from "../../cards";
import { expandCipher } from "../../cards/abilities/cipher";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import type { CardDefinition, EffectOp } from "../../cards/types";
import { projectPublicState } from "../../gameProjections";
import { isDefinitionLevelKeyword } from "../../oracle/lowerStatic";
import { validateEffectScript } from "../effects/validate";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { applyAllCombatDamage, buildAutoDamageAssignments } from "../phases";
import { checkStateBasedActions } from "../sba";
import { compactState, expandState } from "../serialize";
import {
    clearExileLinksToEnteringSource,
    getPlayer,
    moveCard,
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../state";

const DRAW_CIPHER = "test:cipher-draw";
registerTokenDefinition({
    id: DRAW_CIPHER,
    rarity: "common",
    name: "Test Cipher Draw",
    manaCost: { U: 1 },
    types: ["Sorcery"],
    staticAbilities: ["cipher"],
    effects: [{ op: "draw", player: "controller", count: 1 }],
});
const TARGETED_CIPHER = "test:cipher-targeted";
registerTokenDefinition({
    id: TARGETED_CIPHER,
    rarity: "common",
    name: "Test Cipher Targeted",
    manaCost: { B: 1 },
    types: ["Sorcery"],
    staticAbilities: ["cipher"],
    targetRequirement: { type: "Creature", count: 1 },
    effects: [{ op: "destroy", target: { target: 0 } }],
});
const PLAIN_SORCERY = "test:cipher-plain";
registerTokenDefinition({
    id: PLAIN_SORCERY,
    rarity: "common",
    name: "Test No Cipher",
    manaCost: { U: 1 },
    types: ["Sorcery"],
    effects: [{ op: "draw", player: "controller", count: 1 }],
});
/** Casts p1's exiled "encoded" card under a permission of its own (CR 608.2g). */
const EXILE_CASTER = "test:cipher-exile-caster";
registerTokenDefinition({
    id: EXILE_CASTER,
    rarity: "common",
    name: "Test Cipher Exile Caster",
    manaCost: {},
    types: ["Sorcery"],
    resolve: (ctx) => {
        const [exiled] = ctx.getExileCards("p1");
        if (!exiled) return;
        ctx.castChosenSpell("p1", exiled.id, "p1", {
            sourceZone: "exile",
            free: true,
        });
    },
});
const CREATURE = "test:cipher-creature";
registerTokenDefinition({
    id: CREATURE,
    rarity: "common",
    name: "Test Cipher Creature",
    manaCost: { G: 1 },
    types: ["Creature"],
    power: 2,
    toughness: 2,
});

function creature(
    id: string,
    controllerId: string,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return makeInstance(CREATURE, {
        id,
        controllerId,
        ownerId: controllerId,
        zone: "battlefield",
        power: 2,
        toughness: 2,
        ...overrides,
    });
}

function library(ownerId: string): CardInstanceState[] {
    return Array.from({ length: 5 }, (_, i) =>
        makeInstance(PLAIN_SORCERY, {
            id: `${ownerId}-lib-${i}`,
            ownerId,
            controllerId: ownerId,
            zone: "library",
        })
    );
}

function board(
    p1Battlefield: CardInstanceState[],
    p2Battlefield: CardInstanceState[] = []
): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: p1Battlefield,
                library: library("p1"),
            }),
            makePlayer("p2", {
                battlefield: p2Battlefield,
                library: library("p2"),
            }),
        ],
    });
}

/** Answers the head choice through the seam `submitResolutionChoice` drives. */
function answer(state: GameState, ids: string[]): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: ids,
    });
}

/** p1 resolves `cardId` and, when `encodeOn` names a creature, encodes it there. */
function resolveAndEncode(
    state: GameState,
    encodeOn: string,
    cardId: string = DRAW_CIPHER,
    casterId = "p1"
): StackItem {
    const item = pushSpell(state, cardId, casterId);
    resolveTopOfStack(state);
    answer(state, [encodeOn]);
    return item;
}

/** A confirmed combat in which `attackers` attack p2, undefended. */
function attack(state: GameState, attackers: CardInstanceState[]): void {
    for (const a of attackers) a.isAttacking = true;
    state.phase = "COMBAT_DAMAGE";
    state.combat = {
        attackerIds: attackers.map((a) => a.id),
        confirmed: true,
        blockerAssignments: {},
        blockersConfirmed: true,
    };
}

function dealDamage(state: GameState): void {
    applyAllCombatDamage(
        state,
        buildAutoDamageAssignments(state, "regular"),
        "regular"
    );
}

const exileIds = (state: GameState, playerId: string): string[] =>
    getPlayer(state, playerId).exile.map((c) => c.id);

const graveyardIds = (state: GameState, playerId: string): string[] =>
    getPlayer(state, playerId).graveyard.map((c) => c.id);

const encodedTrigger = (state: GameState): StackItem | undefined =>
    state.stack.find((s) => s.delayedPayload?.encodedCard !== undefined);

describe("Cipher: the spell ability (CR 702.99a)", () => {
    it("exiles the card encoded on the chosen creature, after the spell's own effects", () => {
        const bear = creature("bear", "p1");
        const state = board([bear]);
        const item = pushSpell(state, DRAW_CIPHER, "p1");

        resolveTopOfStack(state);
        // The script's own Ops ran first: the draw is done by the time it asks.
        expect(getPlayer(state, "p1").hand).toHaveLength(1);
        const offer = state.pendingChoices![0];
        expect(offer.kind).toBe("choose-permanents");
        expect(offer.playerId).toBe("p1");
        expect(offer.count).toEqual({ min: 0, max: 1 });

        answer(state, ["bear"]);

        expect(state.stack).toHaveLength(0);
        expect(graveyardIds(state, "p1")).toEqual([]);
        const exiled = getPlayer(state, "p1").exile.find(
            (c) => c.id === item.id
        );
        expect(exiled?.encodedOn?.permanentId).toBe("bear");
        expect(exiled?.zone).toBe("exile");
    });

    it("goes to the graveyard when the player declines the 'you may'", () => {
        const state = board([creature("bear", "p1")]);
        const item = pushSpell(state, DRAW_CIPHER, "p1");

        resolveTopOfStack(state);
        answer(state, []);

        expect(graveyardIds(state, "p1")).toEqual([item.id]);
        expect(exileIds(state, "p1")).toEqual([]);
    });

    it("asks nothing with no creature to encode on", () => {
        const state = board([]);
        const item = pushSpell(state, DRAW_CIPHER, "p1");

        resolveTopOfStack(state);

        expect(state.pendingChoices ?? []).toEqual([]);
        expect(graveyardIds(state, "p1")).toEqual([item.id]);
    });

    it("offers only a creature the caster controls, and chooses rather than targets", () => {
        const state = board(
            [creature("mine", "p1"), makeInstance(PLAIN_SORCERY, { id: "x" })],
            [creature("theirs", "p2")]
        );
        pushSpell(state, DRAW_CIPHER, "p1");

        resolveTopOfStack(state);

        expect(() => answer(state, ["theirs"])).toThrow();
        expect(() => answer(state, ["x"])).toThrow();
        answer(state, ["mine"]);
        expect(state.stack).toHaveLength(0);
    });

    it("a creature the caster stole is one they control; the card stays its owner's", () => {
        const stolen = creature("stolen", "p1", { ownerId: "p2" });
        const state = board([stolen]);
        const item = pushSpell(state, DRAW_CIPHER, "p1");
        item.ownerId = "p2";

        resolveTopOfStack(state);
        answer(state, ["stolen"]);

        // Filed in its owner's exile pile, encoded on the caster's creature.
        expect(exileIds(state, "p2")).toEqual([item.id]);
    });

    it("a copy of the spell is not represented by a card: no offer, and it ceases to exist", () => {
        const state = board([creature("bear", "p1")]);
        const item = pushSpell(state, DRAW_CIPHER, "p1");
        item.isCopy = true;

        resolveTopOfStack(state);

        expect(state.pendingChoices ?? []).toEqual([]);
        expect(getPlayer(state, "p1").hand).toHaveLength(1);
        expect(graveyardIds(state, "p1")).toEqual([]);
        expect(exileIds(state, "p1")).toEqual([]);
    });

    it("a spell whose only target is gone does not resolve, so nothing is encoded (CR 608.2b)", () => {
        const state = board([creature("bear", "p1")]);
        const item = pushSpell(state, TARGETED_CIPHER, "p1", [
            { type: "permanent", id: "gone" },
        ]);

        resolveTopOfStack(state);

        expect(state.pendingChoices ?? []).toEqual([]);
        expect(graveyardIds(state, "p1")).toEqual([item.id]);
    });

    it("encoding beats a buyback's return to hand: the card never goes to a graveyard", () => {
        const state = board([creature("bear", "p1")]);
        const item = pushSpell(state, DRAW_CIPHER, "p1");
        item.buybackPaid = true;
        const handBefore = getPlayer(state, "p1").hand.length;

        resolveTopOfStack(state);
        answer(state, ["bear"]);

        expect(exileIds(state, "p1")).toEqual([item.id]);
        // Only the draw reached the hand.
        expect(getPlayer(state, "p1").hand).toHaveLength(handBefore + 1);
        expect(getPlayer(state, "p1").hand.some((c) => c.id === item.id)).toBe(
            false
        );
    });

    it("encoding beats rebound: no recast is scheduled for a card that is encoded", () => {
        const state = board([creature("bear", "p1")]);
        const item = pushSpell(state, DRAW_CIPHER, "p1");
        item.reboundFromHand = true;

        resolveTopOfStack(state);
        answer(state, ["bear"]);

        expect(state.delayedTriggers ?? []).toEqual([]);
        expect(
            getPlayer(state, "p1").exile.find((c) => c.id === item.id)
                ?.encodedOn?.permanentId
        ).toBe("bear");
    });

    it("declining leaves a buyback's return to hand standing", () => {
        const state = board([creature("bear", "p1")]);
        const item = pushSpell(state, DRAW_CIPHER, "p1");
        item.buybackPaid = true;

        resolveTopOfStack(state);
        answer(state, []);

        expect(getPlayer(state, "p1").hand.some((c) => c.id === item.id)).toBe(
            true
        );
    });
});

describe("Cipher: the granted trigger (CR 702.99a)", () => {
    it("combat damage to a player fires a trigger; the copy is cast free and the card stays encoded", () => {
        const bear = creature("bear", "p1");
        const state = board([bear]);
        const item = resolveAndEncode(state, "bear");
        const handBefore = getPlayer(state, "p1").hand.length;

        attack(state, [bear]);
        dealDamage(state);

        const trigger = encodedTrigger(state)!;
        expect(trigger.controllerId).toBe("p1");
        expect(trigger.delayedPayload?.encodedCard).toEqual([item.id]);

        resolveTopOfStack(state);
        const offer = state.pendingChoices![0];
        expect(offer.playerId).toBe("p1");
        expect(offer.subjectCardId).toBe(DRAW_CIPHER);
        answer(state, ["cast"]);

        // CR 707.12 — on the stack as a spell, cast and a copy, not the card.
        const spell = state.stack[state.stack.length - 1];
        expect(spell.isCopy).toBe(true);
        expect(spell.id).not.toBe(item.id);
        expect((spell.card as { id?: string }).id).toBe(DRAW_CIPHER);
        expect(spell.castFromZone).toBe("exile");
        expect(getPlayer(state, "p1").spellsCastThisTurn).toBeGreaterThan(0);
        const encoded = getPlayer(state, "p1").exile.find(
            (c) => c.id === item.id
        );
        expect(encoded?.encodedOn?.permanentId).toBe("bear");

        resolveTopOfStack(state);
        expect(getPlayer(state, "p1").hand).toHaveLength(handBefore + 1);
        // CR 707.10a — it ceases to exist, and CR 702.99a's "represented by a
        // card" keeps it from asking to encode itself.
        expect(state.pendingChoices ?? []).toEqual([]);
        expect(state.stack).toHaveLength(0);
        expect(exileIds(state, "p1")).toEqual([item.id]);
        expect(graveyardIds(state, "p1")).toEqual([]);
    });

    it("declining the offer casts nothing and creates no lasting copy", () => {
        const bear = creature("bear", "p1");
        const state = board([bear]);
        const item = resolveAndEncode(state, "bear");

        attack(state, [bear]);
        dealDamage(state);
        resolveTopOfStack(state);
        answer(state, ["decline"]);

        expect(state.stack).toHaveLength(0);
        expect(exileIds(state, "p1")).toEqual([item.id]);
    });

    it("the same creature connecting again casts it again", () => {
        const bear = creature("bear", "p1");
        const state = board([bear]);
        resolveAndEncode(state, "bear");
        const handBefore = getPlayer(state, "p1").hand.length;

        for (let swing = 1; swing <= 2; swing++) {
            attack(state, [bear]);
            dealDamage(state);
            resolveTopOfStack(state);
            answer(state, ["cast"]);
            resolveTopOfStack(state);
            expect(getPlayer(state, "p1").hand).toHaveLength(
                handBefore + swing
            );
        }
    });

    it("does not trigger on combat damage to a creature", () => {
        const bear = creature("bear", "p1");
        const blocker = creature("blocker", "p2", { power: 0, toughness: 9 });
        const state = board([bear], [blocker]);
        resolveAndEncode(state, "bear");

        attack(state, [bear]);
        state.combat!.blockerAssignments = { blocker: ["bear"] };
        state.combat!.blockedAttackerIds = ["bear"];
        blocker.isBlocking = true;
        dealDamage(state);

        expect(encodedTrigger(state)).toBeUndefined();
    });

    it("a creature with no encoded card fires nothing, beside one that has one", () => {
        const bear = creature("bear", "p1");
        const other = creature("other", "p1");
        const state = board([bear, other]);
        resolveAndEncode(state, "bear");

        attack(state, [other]);
        dealDamage(state);

        expect(encodedTrigger(state)).toBeUndefined();
    });

    it("two encoded cards trigger separately, each naming its own card", () => {
        const bear = creature("bear", "p1");
        const state = board([bear]);
        const first = resolveAndEncode(state, "bear");
        const second = resolveAndEncode(state, "bear");

        attack(state, [bear]);
        dealDamage(state);

        // CR 603.3b — two of the controller's triggers: they order them.
        const order = state.pendingChoices![0];
        expect(order.kind).toBe("trigger-order");
        const named = (state.pendingTriggerBatch ?? [])
            .flatMap((t) => t.delayedPayload?.encodedCard ?? [])
            .sort();
        expect(named).toEqual([first.id, second.id].sort());
    });

    it("whoever controls the creature at the damage controls the trigger, and owns the copy (CR 112.2a)", () => {
        const bear = creature("bear", "p1");
        const state = board([bear]);
        const item = resolveAndEncode(state, "bear");

        // CR 702.99c — p2 takes the creature; the card stays encoded on it.
        const p1 = getPlayer(state, "p1");
        p1.battlefield = p1.battlefield.filter((c) => c.id !== "bear");
        bear.controllerId = "p2";
        getPlayer(state, "p2").battlefield.push(bear);
        state.activePlayerId = "p2";

        state.phase = "COMBAT_DAMAGE";
        bear.isAttacking = true;
        state.combat = {
            attackerIds: ["bear"],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: true,
        };
        dealDamage(state);

        expect(encodedTrigger(state)?.controllerId).toBe("p2");
        resolveTopOfStack(state);
        expect(state.pendingChoices![0].playerId).toBe("p2");
        answer(state, ["cast"]);

        const spell = state.stack[state.stack.length - 1];
        expect(spell.castById).toBe("p2");
        expect(spell.isCopy).toBe(true);
        // The card itself never moved: it is in its owner's exile.
        expect(exileIds(state, "p1")).toEqual([item.id]);
        expect(exileIds(state, "p2")).toEqual([]);
    });

    it("the creature stopping being a creature leaves it encoded (CR 702.99c)", () => {
        const bear = creature("bear", "p1");
        const state = board([bear]);
        const item = resolveAndEncode(state, "bear");

        bear.types = ["Artifact"];
        checkStateBasedActions(state);

        expect(
            getPlayer(state, "p1").exile.find((c) => c.id === item.id)
                ?.encodedOn?.permanentId
        ).toBe("bear");
    });

    it("a creature killed by the combat that connected still fires (CR 603.2 / 113.7a)", () => {
        const bear = creature("bear", "p1", {
            power: 3,
            toughness: 1,
            staticAbilities: ["trample"],
        });
        const blocker = creature("blocker", "p2", { power: 1, toughness: 1 });
        const state = board([bear], [blocker]);
        const item = resolveAndEncode(state, "bear");

        attack(state, [bear]);
        state.combat!.blockerAssignments = { blocker: ["bear"] };
        state.combat!.blockedAttackerIds = ["bear"];
        blocker.isBlocking = true;
        dealDamage(state);

        expect(
            getPlayer(state, "p1").battlefield.some((c) => c.id === "bear")
        ).toBe(false);
        expect(encodedTrigger(state)?.delayedPayload?.encodedCard).toEqual([
            item.id,
        ]);
    });

    it("the trigger on the stack survives the creature leaving (CR 113.7a)", () => {
        const bear = creature("bear", "p1");
        const state = board([bear]);
        resolveAndEncode(state, "bear");

        attack(state, [bear]);
        dealDamage(state);
        removePermanentTo(state, "bear", "graveyard");
        resolveTopOfStack(state);
        answer(state, ["cast"]);

        expect(state.stack[state.stack.length - 1].isCopy).toBe(true);
    });

    it("the card leaving exile before resolution leaves nothing to copy (CR 400.7)", () => {
        const bear = creature("bear", "p1");
        const state = board([bear]);
        const item = resolveAndEncode(state, "bear");

        attack(state, [bear]);
        dealDamage(state);
        moveCard(getPlayer(state, "p1"), item.id, "exile", "graveyard");
        resolveTopOfStack(state);

        expect(state.pendingChoices ?? []).toEqual([]);
        expect(state.stack).toHaveLength(0);
    });
});

describe("Cipher: how the encoding ends (CR 702.99c)", () => {
    it("the card leaving exile ends it", () => {
        const bear = creature("bear", "p1");
        const state = board([bear]);
        const item = resolveAndEncode(state, "bear");

        moveCard(getPlayer(state, "p1"), item.id, "exile", "graveyard");
        expect(
            getPlayer(state, "p1").graveyard.find((c) => c.id === item.id)
                ?.encodedOn
        ).toBeUndefined();

        attack(state, [bear]);
        dealDamage(state);
        expect(encodedTrigger(state)).toBeUndefined();
    });

    it("the card cast out of exile is a new object: declined, it goes to the graveyard", () => {
        const bear = creature("bear", "p1");
        const state = board([bear]);
        const item = resolveAndEncode(state, "bear");

        pushSpell(state, EXILE_CASTER, "p1");
        resolveTopOfStack(state);
        expect(state.stack[state.stack.length - 1].id).toBe(item.id);
        expect(state.stack[state.stack.length - 1].encodedOn).toBeUndefined();

        // It is a card on the stack again, so it may encode itself anew; declined,
        // nothing of the old link sends it back to exile.
        resolveTopOfStack(state);
        answer(state, []);

        expect(graveyardIds(state, "p1")).toContain(item.id);
        expect(exileIds(state, "p1")).toEqual([]);
    });

    it("the creature returning is a new object: the card stays exiled, no longer encoded", () => {
        const bear = creature("bear", "p1");
        const state = board([bear]);
        const item = resolveAndEncode(state, "bear");

        removePermanentTo(state, "bear", "hand");
        clearExileLinksToEnteringSource(state, "bear");
        const returned = getPlayer(state, "p1").hand.find(
            (c) => c.id === "bear"
        )!;
        getPlayer(state, "p1").hand = getPlayer(state, "p1").hand.filter(
            (c) => c.id !== "bear"
        );
        returned.zone = "battlefield";
        getPlayer(state, "p1").battlefield.push(returned);

        expect(exileIds(state, "p1")).toEqual([item.id]);
        attack(state, [returned]);
        dealDamage(state);
        expect(encodedTrigger(state)).toBeUndefined();
    });

    it("a loss of abilities LATER than the encoding fires nothing, and the card stays encoded", () => {
        const bear = creature("bear", "p1");
        const state = board([bear]);
        const item = resolveAndEncode(state, "bear");
        const encodedAt = getPlayer(state, "p1").exile.find(
            (c) => c.id === item.id
        )!.encodedOn!.seq;
        bear.abilityLossHolds = [
            { sourceInstanceId: "strip", seq: encodedAt + 1 },
        ] as never;
        bear.abilitiesSuppressedBy = [
            { sourceCardId: "strip", seq: encodedAt + 1 },
        ] as never;

        attack(state, [bear]);
        dealDamage(state);

        expect(encodedTrigger(state)).toBeUndefined();
        expect(
            getPlayer(state, "p1").exile.find((c) => c.id === item.id)
                ?.encodedOn
        ).toBeDefined();
    });

    it("a loss of abilities EARLIER than the encoding does not outrank it (CR 613.7)", () => {
        const bear = creature("bear", "p1");
        const state = board([bear]);
        bear.abilitiesSuppressedBy = [
            { sourceCardId: "strip", seq: 0 },
        ] as never;
        const item = resolveAndEncode(state, "bear");

        attack(state, [bear]);
        dealDamage(state);

        expect(encodedTrigger(state)?.delayedPayload?.encodedCard).toEqual([
            item.id,
        ]);
    });
});

describe("Cipher: the copy that is cast (CR 707.12 / 704.5e)", () => {
    it("a copy with no legal target is not cast and ceases to exist", () => {
        const bear = creature("bear", "p1");
        const state = board([bear], [creature("victim", "p2")]);
        const item = pushSpell(state, TARGETED_CIPHER, "p1", [
            { type: "permanent", id: "victim" },
        ]);
        resolveTopOfStack(state);
        answer(state, ["bear"]);
        expect(exileIds(state, "p1")).toEqual([item.id]);

        // The first cast destroyed the victim; the attacker, the last creature
        // it could target, leaves with the trigger on the stack.
        attack(state, [bear]);
        dealDamage(state);
        removePermanentTo(state, "bear", "graveyard");

        resolveTopOfStack(state);
        const idsBefore = state.nextInstanceId ?? 0;
        answer(state, ["cast"]);

        // Accepted, so a copy was created; with no target it was never cast, and
        // the resolution's own state-based check removed it (CR 704.5e).
        expect(state.nextInstanceId).toBeGreaterThan(idsBefore);
        expect(state.stack).toHaveLength(0);
        expect(exileIds(state, "p1")).toEqual([item.id]);
    });

    it("chooses new targets for the copy, and the parked choice survives SBAs and a save", () => {
        const bear = creature("bear", "p1");
        const state = board([bear], [creature("victim", "p2")]);
        const item = pushSpell(state, TARGETED_CIPHER, "p1", [
            { type: "permanent", id: "victim" },
        ]);
        resolveTopOfStack(state);
        answer(state, ["bear"]);

        const secondVictim = creature("second", "p2");
        getPlayer(state, "p2").battlefield.push(secondVictim);
        attack(state, [bear]);
        dealDamage(state);
        resolveTopOfStack(state);
        answer(state, ["cast"]);

        // The copy waits in exile for its target pick (CR 601.2c).
        expect(state.pendingChoices![0].choiceId).toContain("target");
        checkStateBasedActions(state);
        expect(getPlayer(state, "p1").exile).toHaveLength(2);
        const reloaded = expandState(compactState(state));
        const beforeCopies = getPlayer(reloaded, "p1").exile.filter(
            (c) => c.castCopyOfCard
        );
        expect(beforeCopies).toHaveLength(1);

        answer(reloaded, ["second"]);

        const spell = reloaded.stack[reloaded.stack.length - 1];
        expect(spell.isCopy).toBe(true);
        expect(spell.targets).toEqual([{ type: "permanent", id: "second" }]);
        expect(exileIds(reloaded, "p1")).toEqual([item.id]);
    });

    it("a copy stranded in exile ceases to exist as a state-based action", () => {
        const state = board([]);
        getPlayer(state, "p1").exile.push(
            makeInstance(DRAW_CIPHER, {
                id: "stranded",
                ownerId: "p1",
                controllerId: "p1",
                zone: "exile",
                castCopyOfCard: true,
            })
        );

        checkStateBasedActions(state);

        expect(exileIds(state, "p1")).toEqual([]);
    });
});

describe("Cipher: persistence, wire and definition", () => {
    it("the link round-trips through a save", () => {
        const bear = creature("bear", "p1");
        const state = board([bear]);
        const item = resolveAndEncode(state, "bear");
        const seq = getPlayer(state, "p1").exile[0].encodedOn!.seq;

        const reloaded = expandState(compactState(state));

        expect(getPlayer(reloaded, "p1").exile[0]).toMatchObject({
            id: item.id,
            encodedOn: { permanentId: "bear", seq },
        });
    });

    it("the client sees the card pinned to its creature, and the link the Bot reads", () => {
        const bear = creature("bear", "p1");
        const state = board([bear]);
        const item = resolveAndEncode(state, "bear");

        const wireCard = () =>
            projectPublicState(state, 1, "p2").players[0].exile.find(
                (c) => c.id === item.id
            ) as CardInstanceState & { exiledByPermanentId?: string };

        expect(wireCard().exiledByPermanentId).toBe("bear");
        expect(wireCard().encodedOn?.permanentId).toBe("bear");

        removePermanentTo(state, "bear", "graveyard");
        expect(wireCard().exiledByPermanentId).toBeUndefined();
    });

    it("the expanded script validates, and a compiled grant of cipher is refused", () => {
        const def = expandCipher({
            id: "x",
            rarity: "common",
            name: "X",
            types: ["Sorcery"],
            staticAbilities: ["cipher"],
            effects: [{ op: "draw", player: "controller", count: 1 }],
        } as CardDefinition);
        expect(validateEffectScript(def)).toEqual([]);
        expect(expandCipher(def)).toBe(def);
        expect(isDefinitionLevelKeyword("cipher")).toBe(true);
    });

    it("the validator refuses a copy cast from anywhere but exile, or of no bound card", () => {
        const script = (effects: EffectOp[]) => ({
            id: "x",
            name: "X",
            effects,
        });
        const cast = (fields: object) =>
            script([
                {
                    op: "choice",
                    kind: "choose-graveyard-card",
                    player: "controller",
                    zone: "graveyard",
                    count: 1,
                    prompt: "p",
                    bind: "$c",
                },
                {
                    op: "castDuringResolution",
                    player: "controller",
                    asCopy: true,
                    ...fields,
                } as EffectOp,
            ]);
        expect(
            validateEffectScript(
                cast({ card: { ref: "$c" }, source: "graveyard" })
            ).join()
        ).toContain("asCopy");
        expect(
            validateEffectScript(cast({ fromTopOfLibrary: true })).join()
        ).toContain("asCopy");
        expect(
            validateEffectScript(cast({ card: { ref: "$c" }, source: "exile" }))
        ).toEqual([]);
    });

    it("the predicate validates, on a literal true alone", () => {
        const op: EffectOp = {
            op: "if",
            predicate: { spellRepresentedByCard: true },
            then: [{ op: "draw", player: "controller", count: 1 }],
        };
        expect(
            validateEffectScript({ id: "x", name: "X", effects: [op] })
        ).toEqual([]);
    });
});
