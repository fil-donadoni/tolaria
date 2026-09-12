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
    emitPermanentEntered,
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
    modalBackFaceDefinitionId,
    modalBackTwinDefinition,
} from "../../cards/modalDfc";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { grizzlyBears } from "../../cards/sets/lea";
import { rukhEgg } from "../../cards/sets/arn/red";
import { superShredder } from "../../cards/sets/tmt/black";
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
        // Super Shredder watches ANOTHER permanent leaving, so it fires off the
        // same batch from the battlefield — the positive control below.
        const witness = makeInstance(superShredder.id, {
            id: "witness",
            controllerId: "p1",
        });
        const state = boardWith([egg, witness]);
        turnFaceDown(state, egg, "morph");

        removePermanentTo(state, "egg", "graveyard");
        const ids = firedIds(state);
        expect(ids).not.toContain("rukh-egg-death");
        // Positive control: the assertion above passes just as well if the
        // departed source stopped being scanned at all, so the same batch has
        // to produce a trigger that MUST appear.
        expect(ids).toContain("super-shredder-counter");
    });

    it("unions NO retained-through-copy trigger onto a face-down departure (CR 707.2 / 707.9d)", () => {
        // The sentinel branch must stamp no `copiedFrom`: the departure id
        // alone cannot tell a face-down permanent from a face-UP copy OF one
        // (CR 707.2's Clone-of-Grinning-Demon example presents the sentinel
        // either way), and claiming the copy anchor would union the printed
        // card's CR 707.9d retained triggers onto an object CR 708.2 gives no
        // abilities at all.
        const hidden: CardDefinition = {
            ...grizzlyBears,
            id: "look-back-hidden",
            name: "Look-Back Hidden",
            triggeredAbilities: [
                {
                    id: "hidden-retained-death",
                    oracleText: "When this creature dies, draw a card.",
                    retainedThroughCopy: true,
                    event: "CREATURE_DIED",
                    matches: (event, self) =>
                        event.type === "CREATURE_DIED" &&
                        event.creatureInstanceId === self.id,
                    effects: [{ op: "draw", player: "controller", count: 1 }],
                },
            ],
        };

        withTemporaryDefinition(hidden, () => {
            const card = makeInstance(hidden.id, {
                id: "hidden",
                controllerId: "p1",
            });
            const witness = makeInstance(superShredder.id, {
                id: "witness",
                controllerId: "p1",
            });
            const state = boardWith([card, witness]);
            turnFaceDown(state, card, "morph");

            removePermanentTo(state, "hidden", "graveyard");
            const ids = firedIds(state);
            expect(ids).not.toContain("hidden-retained-death");
            expect(ids).toContain("super-shredder-counter");
        });
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
                    // CR 707.9d — what makes the transform leg OBSERVABLE.
                    // Misrouting a transformed permanent to the copy branch
                    // stamps `copiedFrom`, and `effectiveTriggeredAbilities`
                    // then unions exactly the front face's retained triggers
                    // back in; without the flag the two branches are
                    // indistinguishable from the outside.
                    retainedThroughCopy: true,
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
            const witness = makeInstance(superShredder.id, {
                id: "witness",
                controllerId: "p1",
            });
            const state = boardWith([card, witness]);
            transformPermanent(state, card);
            expect(presentedDefId(card)).not.toBe(flipper.id);

            removePermanentTo(state, "flip", "graveyard");
            const ids = firedIds(state);
            expect(ids).not.toContain("flipper-front-death");
            expect(ids).toContain("super-shredder-counter");
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

    it("does NOT look back for a permanent BLINKED and returned in the same batch (CR 400.7)", () => {
        // Instance ids are never reallocated, and `lastKnownCopiable` is pruned
        // only at cleanup (CR 514), so a permanent flickered and returned
        // within ONE event batch (Ephemerate, Displacer Kitten) is back on the
        // battlefield carrying an entry that describes the object it was
        // BEFORE the blink. Keying the look-back on the instance id would
        // evaluate that LIVE permanent as its pre-blink self — here, a morph
        // whose entry trigger is suppressed because the view rebuilds it as
        // the 2/2 sentinel. The scan keys on the source OBJECTS it pulled out
        // of a destination zone instead, and a returned permanent is not one.
        const entered: string[] = [];
        const blinker: CardDefinition = {
            ...grizzlyBears,
            id: "look-back-blinker",
            name: "Look-Back Blinker",
            triggeredAbilities: [
                {
                    id: "blinker-etb",
                    oracleText: "When this creature enters, draw a card.",
                    event: "PERMANENT_ENTERED",
                    matches: (event, self) => {
                        if (
                            event.type !== "PERMANENT_ENTERED" ||
                            event.instanceId !== self.id
                        ) {
                            return false;
                        }
                        entered.push(presentedDefId(self));
                        return true;
                    },
                    effects: [{ op: "draw", player: "controller", count: 1 }],
                },
            ],
        };

        withTemporaryDefinition(blinker, () => {
            const card = makeInstance(blinker.id, {
                id: "blink",
                controllerId: "p1",
            });
            const state = boardWith([card]);
            // Face down on the way out, so a look-back applied to the RETURNED
            // permanent would present the vanilla sentinel and find no trigger.
            turnFaceDown(state, card, "morph");
            removePermanentTo(state, "blink", "exile");
            const exiled = state.players[0].exile.find(
                (c) => c.id === "blink"
            )!;
            state.players[0].exile = state.players[0].exile.filter(
                (c) => c.id !== "blink"
            );
            exiled.zone = "battlefield";
            state.players[0].battlefield.push(exiled);
            emitPermanentEntered(state, exiled);

            const ids = firedIds(state);
            expect(ids).toContain("blinker-etb");
            expect(entered).toEqual([blinker.id]);
        });
    });

    it("never mutates the destination-zone card the view was spread from", () => {
        // The whole design rests on the view being a throwaway: it is a shallow
        // spread of a live `CardInstanceState` handed to the same layer rebuild
        // the three identity-swap sites use. A nested in-place write there
        // would corrupt the real card in the graveyard.
        const egg = makeInstance(rukhEgg.id, { id: "egg", controllerId: "p1" });
        const clone = makeInstance(grizzlyBears.id, {
            id: "clone",
            controllerId: "p1",
        });
        applyCopy(NO_BOARD_LAYER_VIEW, clone, egg);
        const state = boardWith([egg, clone]);

        removePermanentTo(state, "clone", "graveyard");
        const inGraveyard = state.players[0].graveyard.find(
            (c) => c.id === "clone"
        )!;
        const before = JSON.stringify(inGraveyard);
        expect(firedIds(state)).toContain("rukh-egg-death");
        expect(JSON.stringify(inGraveyard)).toBe(before);
    });

    it("resolves a MODAL back face's own leave trigger from the twin (CR 712.8f)", () => {
        // The modal leg of `backFaceDefinitionIdOf` — the only one that can
        // ever carry a back-face trigger. A NONMODAL back face is registered
        // through the token codec and `CardBackFace` declares no
        // `triggeredAbilities` at all, so nothing printed can reach this leg
        // today; the modal twin is a real `CardDefinition`, and the trigger is
        // stamped onto it here to exercise the resolution path end to end.
        const front: CardDefinition = {
            ...grizzlyBears,
            id: "look-back-modal",
            name: "Look-Back Modal",
            backFace: {
                kind: "modal",
                name: "Look-Back Modal Back",
                types: ["Creature"],
                subtypes: ["Elemental"],
                power: 3,
                toughness: 3,
            },
        };
        const twin: CardDefinition = {
            ...modalBackTwinDefinition(front)!,
            triggeredAbilities: [
                {
                    id: "modal-back-death",
                    oracleText: "When this creature dies, draw a card.",
                    event: "CREATURE_DIED",
                    matches: (event, self) =>
                        event.type === "CREATURE_DIED" &&
                        event.creatureInstanceId === self.id,
                    effects: [{ op: "draw", player: "controller", count: 1 }],
                },
            ],
        };
        expect(twin.id).toBe(modalBackFaceDefinitionId(front.id));

        withTemporaryDefinition(front, () => {
            withTemporaryDefinition(twin, () => {
                const card = makeInstance(front.id, {
                    id: "modal",
                    controllerId: "p1",
                });
                const state = boardWith([card]);
                transformPermanent(state, card);
                expect(presentedDefId(card)).toBe(twin.id);

                removePermanentTo(state, "modal", "graveyard");
                expect(firedIds(state)).toContain("modal-back-death");
            });
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
