// CR 603.10 look-back for the dies / leaves-the-battlefield trigger scan
// (issue #2967).
//
//   CR 603.10 — "the game 'looks back in time' to determine if those abilities
//   trigger, using the existence of those abilities and the appearance of
//   objects immediately prior to the event."
//   CR 603.10a — "Some zone-change triggers look back in time. These are
//   leaves-the-battlefield abilities, …"
//
// The single battlefield-departure funnel reverts three identity swaps on the
// way out, each correct in itself — CR 707.2 (a copy effect lasts only while
// the object is on the battlefield), CR 712.8a (off the battlefield a
// double-faced card has only its front face's characteristics) and CR 708.9
// (a face-down permanent is revealed as it moves) — and the trigger collector
// then re-found the object in its destination zone and read the PRINTED card.
// Two opposite failures fell out of that: a copy LOST its dies trigger, and a
// face-down permanent GAINED one it never had.
//
// Every test below drives the real collector over the real `pendingEvents` the
// departure funnel queued; the assertions name the ability ids that reach the
// stack, which is the same list `placeTriggersOnStack` would push.

import { describe, it, expect } from "vitest";
import {
    removePermanentTo,
    type CardInstanceState,
    type GameState,
} from "../state";
import { collectTriggers } from "../triggers";
import { applyCopy, findTriggeredAbility, presentedDefId } from "../copy";
import { turnFaceDown } from "../faceDown";
import { transformPermanent } from "../transform";
import { NO_BOARD_LAYER_VIEW } from "../layers";
import { withTemporaryDefinition } from "../../cards/registry";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { grizzlyBears } from "../../cards/sets/lea";
import { rukhEgg } from "../../cards/sets/arn/red";
import { masterOfDeath } from "../../cards/sets/mh2/multicolor";
import type { CardDefinition, GameEvent } from "../../cards/types";

/** A board with `battlefield` under p1. */
function boardWith(battlefield: CardInstanceState[]): GameState {
    return makeState({
        players: [makePlayer("p1", { battlefield }), makePlayer("p2")],
    });
}

/** The ability ids the collector puts on the stack for `events`. */
function firedIds(state: GameState, events?: GameEvent[]): string[] {
    return collectTriggers(state, events ?? state.pendingEvents ?? []).map(
        (item) => item.triggeredAbilityId ?? ""
    );
}

describe("CR 603.10 look-back — a departed permanent's leave triggers", () => {
    it("fires the COPIED creature's dies trigger, not the printed card's (CR 707.2)", () => {
        // Phantasmal-Image shape with shipped cards: a Grizzly Bears instance
        // that had become a Rukh Egg. `revertCopy` puts the printed Bears in
        // the graveyard, so the pre-fix scan found a vanilla 2/2 and no
        // trigger ever reached the stack.
        const egg = makeInstance(rukhEgg.id, { id: "egg", controllerId: "p1" });
        const clone = makeInstance(grizzlyBears.id, {
            id: "clone",
            controllerId: "p1",
        });
        applyCopy(NO_BOARD_LAYER_VIEW, clone, egg);
        const state = boardWith([egg, clone]);

        removePermanentTo(state, "clone", "graveyard");
        // The card in the graveyard is the printed Bears — the whole reason a
        // destination-zone read is the wrong authority here.
        expect(
            presentedDefId(
                state.players[0].graveyard.find((c) => c.id === "clone")!
            )
        ).toBe(grizzlyBears.id);

        expect(firedIds(state)).toContain("rukh-egg-death");
    });

    it("hands the copy's trigger a stack item that still resolves (CR 603.10)", () => {
        // A trigger whose stack item presents the reverted printed card is
        // indistinguishable from no trigger at all: `findTriggeredAbility`
        // reads the item's own `card.id` at resolution and finds nothing.
        const egg = makeInstance(rukhEgg.id, { id: "egg", controllerId: "p1" });
        const clone = makeInstance(grizzlyBears.id, {
            id: "clone",
            controllerId: "p1",
        });
        applyCopy(NO_BOARD_LAYER_VIEW, clone, egg);
        const state = boardWith([egg, clone]);

        removePermanentTo(state, "clone", "graveyard");
        const item = collectTriggers(state, state.pendingEvents ?? []).find(
            (i) => i.triggerSourceId === "clone"
        );
        expect(item).toBeDefined();
        expect(presentedDefId(item!)).toBe(rukhEgg.id);
        expect(
            findTriggeredAbility(item!, item!.triggeredAbilityId!)
        ).toBeDefined();
    });

    it("gives a departed source's predicate the pre-departure object (CR 603.10)", () => {
        // The ability list is only half the rule: `matches(event, self, state)`
        // must see the appearance the object had immediately prior to the
        // event, not the characteristics `revertCopy` restored.
        const seen: Array<{
            defId: string;
            power: number | undefined;
            subtypes: string[];
        }> = [];
        const watcher: CardDefinition = {
            ...grizzlyBears,
            id: "look-back-watcher",
            name: "Look-Back Watcher",
            subtypes: ["Dragon"],
            power: 7,
            toughness: 7,
            triggeredAbilities: [
                {
                    id: "watcher-death",
                    oracleText: "When this creature dies, record it.",
                    event: "CREATURE_DIED",
                    matches: (event, self) => {
                        if (
                            event.type !== "CREATURE_DIED" ||
                            event.creatureInstanceId !== self.id
                        ) {
                            return false;
                        }
                        seen.push({
                            defId: presentedDefId(self),
                            power: self.power,
                            subtypes: [...self.subtypes],
                        });
                        return true;
                    },
                    effects: [{ op: "draw", player: "controller", count: 1 }],
                },
            ],
        };

        withTemporaryDefinition(watcher, () => {
            const original = makeInstance(watcher.id, {
                id: "orig",
                controllerId: "p1",
            });
            const clone = makeInstance(grizzlyBears.id, {
                id: "clone",
                controllerId: "p1",
            });
            applyCopy(NO_BOARD_LAYER_VIEW, clone, original);
            const state = boardWith([original, clone]);

            removePermanentTo(state, "clone", "graveyard");
            expect(firedIds(state)).toContain("watcher-death");
            expect(seen).toEqual([
                { defId: watcher.id, power: 7, subtypes: ["Dragon"] },
            ]);
        });
    });

    it("fires NO printed dies trigger for a creature that died FACE DOWN (CR 708.2 / 708.9)", () => {
        // CR 708.2 — a face-down permanent's copiable values are the vanilla
        // 2/2 body, so it has no abilities at all. CR 708.9's reveal runs at
        // the same funnel, BEFORE the scan, which is how the printed trigger
        // used to fire for an object that never had it.
        const egg = makeInstance(rukhEgg.id, { id: "egg", controllerId: "p1" });
        const state = boardWith([egg]);
        turnFaceDown(state, egg, "morph");

        removePermanentTo(state, "egg", "graveyard");
        expect(firedIds(state)).not.toContain("rukh-egg-death");
    });

    it("fires NO front-face leave trigger for a permanent that died TRANSFORMED (CR 712.8a)", () => {
        // CR 712.8a puts the front face back on the card the moment it leaves
        // the battlefield, so the destination-zone read saw a front face the
        // permanent had not presented since it transformed.
        const flipper: CardDefinition = {
            ...grizzlyBears,
            id: "look-back-flipper",
            name: "Look-Back Flipper",
            triggeredAbilities: [
                {
                    id: "flipper-front-death",
                    oracleText: "When this creature dies, draw a card.",
                    event: "CREATURE_DIED",
                    matches: (event, self) =>
                        event.type === "CREATURE_DIED" &&
                        event.creatureInstanceId === self.id,
                    effects: [{ op: "draw", player: "controller", count: 1 }],
                },
            ],
            backFace: {
                kind: "nonmodal",
                name: "Look-Back Flipped",
                types: ["Creature"],
                subtypes: ["Werewolf"],
                power: 4,
                toughness: 4,
            },
        };

        withTemporaryDefinition(flipper, () => {
            const card = makeInstance(flipper.id, {
                id: "flip",
                controllerId: "p1",
            });
            const state = boardWith([card]);
            transformPermanent(state, card);
            expect(presentedDefId(card)).not.toBe(flipper.id);

            removePermanentTo(state, "flip", "graveyard");
            expect(firedIds(state)).not.toContain("flipper-front-death");
        });
    });

    it("leaves an ordinary permanent's printed dies trigger untouched (CR 603.10a)", () => {
        const egg = makeInstance(rukhEgg.id, { id: "egg", controllerId: "p1" });
        const state = boardWith([egg]);

        removePermanentTo(state, "egg", "graveyard");
        expect(firedIds(state)).toContain("rukh-egg-death");
    });

    it("still serves a self-scoped LTB trigger reaching EXILE (CR 603.10a)", () => {
        // The same scan serves every non-graveyard destination through
        // `recentlyLeft`; an exiled Aura must keep finding itself.
        const aura: CardDefinition = {
            id: "look-back-aura",
            rarity: "common",
            name: "Look-Back Aura",
            oracleText: "When this Aura leaves the battlefield, draw a card.",
            manaCost: { W: 1 },
            types: ["Enchantment"],
            subtypes: ["Aura"],
            triggeredAbilities: [
                {
                    id: "aura-ltb",
                    oracleText:
                        "When this Aura leaves the battlefield, draw a card.",
                    event: "PERMANENT_LEFT",
                    matches: (event, self) =>
                        event.type === "PERMANENT_LEFT" &&
                        event.instanceId === self.id,
                    effects: [{ op: "draw", player: "controller", count: 1 }],
                },
            ],
        };

        withTemporaryDefinition(aura, () => {
            const card = makeInstance(aura.id, {
                id: "aura",
                controllerId: "p1",
            });
            const state = boardWith([card]);

            removePermanentTo(state, "aura", "exile");
            expect(firedIds(state)).toContain("aura-ltb");
        });
    });

    it("keeps a graveyard-zone ability reading the CARD IN THE GRAVEYARD (CR 603.6e)", () => {
        // A Master of Death that died while a copy of Rukh Egg contributes the
        // EGG's dies trigger (look-back, CR 603.10) and its OWN upkeep
        // self-return (CR 400.7 — the card in the graveyard is a new object,
        // and it is the printed Master of Death). The two authorities must not
        // be swapped for each other.
        const egg = makeInstance(rukhEgg.id, { id: "egg", controllerId: "p1" });
        const master = makeInstance(masterOfDeath.id, {
            id: "master",
            controllerId: "p1",
        });
        applyCopy(NO_BOARD_LAYER_VIEW, master, egg);
        const state = boardWith([egg, master]);

        removePermanentTo(state, "master", "graveyard");
        const events: GameEvent[] = [
            ...(state.pendingEvents ?? []),
            { type: "PHASE_BEGIN", phase: "UPKEEP", activePlayerId: "p1" },
        ];
        const ids = firedIds(state, events);
        expect(ids).toContain("rukh-egg-death");
        expect(ids).toContain("master-of-death-upkeep-return");
    });
});
