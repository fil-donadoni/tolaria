// CR 603.6e — "When you cast this spell, …": a triggered ability whose SOURCE
// is the spell currently being announced onto the stack (issue #2319).
//
// This is the capability test for `collectSelfCastTriggers` (gre/state.ts) and
// the `functionsFromStack` marker `spellCastTrigger` stamps on a
// `scope: "self"` trigger. Before it existed, `collectTriggers` swept only the
// battlefield (plus just-left graveyard/exile) piles, so nothing ever saw such
// a trigger: the ability was built, validated, shipped — and silently never
// fired. Mana Vortex's "counter it unless you sacrifice a land" was inert in
// production for exactly that reason, with only a hand-driven unit test
// (`sets/drk/__tests__/blue.test.ts`) standing in for a real cast.
//
// The two properties under test are opposites, and BOTH matter:
//   1. a `scope: "self"` cast trigger IS collected off the stack;
//   2. a cast-WATCHING trigger on the same card (`scope: "any"`/"you") is NOT —
//      it functions only on the battlefield (CR 603.6), and collecting it here
//      would make a permanent trigger off its own casting.

import { describe, it, expect } from "vitest";
import { preloadDefinitions } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import { spellCastTrigger } from "../../cards/abilities/triggers/spellCastTrigger";
import { manaVortex } from "../../cards/sets/drk/blue";
import {
    makeInstance,
    makeState,
    makePlayer,
    pushSpell,
} from "../../cards/__tests__/setup";
import { finalizeTargetSelection } from "../../game";
import {
    emitSpellCastEvent,
    processPendingActionTriggers,
    resolveTopOfStack,
} from "../state";

const SELF_CARD_ID = "00000000-0000-4000-8000-00005e1f0001";
const WATCHER_CARD_ID = "00000000-0000-4000-8000-00005e1f0002";
const TARGETED_CARD_ID = "00000000-0000-4000-8000-00005e1f0003";
/** Grizzly Bears — a registered vanilla creature, used as an inert target. */
const GRIZZLY_BEARS_ID = "ce2d603a-3231-4a8c-bf39-1617586ea870";

preloadDefinitions([
    {
        id: SELF_CARD_ID,
        name: "Synthetic Self-Cast Trigger",
        rarity: "rare",
        manaCost: { X: 2 },
        types: ["Creature"],
        subtypes: ["Eldrazi"],
        power: 2,
        toughness: 2,
        triggeredAbilities: [
            spellCastTrigger({
                id: "synthetic-self-cast",
                oracleText: "When you cast this spell, take an extra turn.",
                scope: "self",
                effects: [{ op: "extraTurn", player: "controller" }],
            }),
        ],
    } as CardDefinition,
    {
        id: WATCHER_CARD_ID,
        name: "Synthetic Cast Watcher",
        rarity: "rare",
        manaCost: { X: 2 },
        types: ["Creature"],
        subtypes: ["Eldrazi"],
        power: 2,
        toughness: 2,
        triggeredAbilities: [
            // A permanent that watches OTHER casts from the battlefield. Its
            // own casting must NOT fire it.
            spellCastTrigger({
                id: "synthetic-cast-watcher",
                oracleText:
                    "Whenever a player casts a spell, take an extra turn.",
                scope: "any",
                effects: [{ op: "extraTurn", player: "controller" }],
            }),
        ],
    } as CardDefinition,
    {
        id: TARGETED_CARD_ID,
        name: "Synthetic Targeted Cast Trigger",
        rarity: "rare",
        manaCost: { X: 2 },
        types: ["Creature"],
        subtypes: ["Eldrazi"],
        power: 2,
        toughness: 2,
        triggeredAbilities: [
            spellCastTrigger({
                id: "synthetic-self-cast-targeted",
                oracleText:
                    "When you cast this spell, exile up to one target creature.",
                scope: "self",
                targetRequirement: {
                    type: "Creature",
                    count: { min: 0, max: 1 },
                },
                effects: [{ op: "exile", target: { target: 0 } }],
            }),
        ],
    } as CardDefinition,
]);

/** The REAL cast path: `convex/game.ts`'s cast mutation pushes the stack item,
 *  then runs exactly these two calls. */
function cast(cardId: string) {
    const state = makeState({ players: [makePlayer("p1"), makePlayer("p2")] });
    const spell = pushSpell(state, cardId, "p1");
    emitSpellCastEvent(state, spell);
    processPendingActionTriggers(state);
    return { state, spell };
}

describe("self-scoped cast triggers are collected off the stack (CR 603.6e, issue #2319)", () => {
    it('a `scope: "self"` cast trigger lands on the stack above its own spell', () => {
        const { state, spell } = cast(SELF_CARD_ID);
        expect(state.stack).toHaveLength(2);
        expect(state.stack[0].id).toBe(spell.id);
        expect(state.stack[1].triggeredAbilityId).toBe("synthetic-self-cast");
        expect(state.stack[1].triggerSourceId).toBe(spell.id);
    });

    it("FAIL-CLOSED: a cast-WATCHING trigger on the cast card is NOT collected from the stack (CR 603.6)", () => {
        // `scope: "any"` matches every cast, including this one — so only the
        // `functionsFromStack` marker keeps it off the stack. Without that
        // gate, every permanent with a cast-watching trigger would fire it once
        // off its own casting, from a zone where the ability does not function.
        const { state, spell } = cast(WATCHER_CARD_ID);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].id).toBe(spell.id);
        expect(state.extraTurns).toBeUndefined();
    });

    it("the marker is set by `spellCastTrigger` for `self` and for no other scope", () => {
        const self = spellCastTrigger({
            id: "t-self",
            oracleText: "When you cast this spell, draw a card.",
            scope: "self",
            effects: [{ op: "draw", player: "controller", count: 1 }],
        });
        expect(self.functionsFromStack).toBe(true);
        for (const scope of ["you", "opponents", "any"] as const) {
            const watcher = spellCastTrigger({
                id: `t-${scope}`,
                oracleText: "Whenever a player casts a spell, draw a card.",
                scope,
                effects: [{ op: "draw", player: "controller", count: 1 }],
            });
            expect(watcher.functionsFromStack).toBeUndefined();
        }
    });
});

describe("a TARGETED self-cast trigger announces its target as it goes on the stack (CR 603.3d, issue #3229)", () => {
    // The half issue #2319 left open. `collectSelfCastTriggers` pushes straight
    // onto the stack and never reaches `placeTriggersOnStack`, which is where
    // every other producer's `raiseTriggerTargetSelection` sweep lives — and
    // `processPendingActionTriggers` bails BEFORE its own sweep when the cast
    // event collected no battlefield triggers, which is the normal case for a
    // card whose only cast watcher is itself. So the trigger sat on the stack
    // with `targets: undefined` and resolved doing nothing. Invisible until the
    // first TARGETED cast trigger shipped (Ugin, Eye of the Storms).
    function castTargeted() {
        // A VANILLA creature: the synthetic watcher card above would add a
        // third stack item off this very cast.
        const victim = makeInstance(GRIZZLY_BEARS_ID, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        const spell = pushSpell(state, TARGETED_CARD_ID, "p1");
        spell.targets = undefined;
        emitSpellCastEvent(state, spell);
        processPendingActionTriggers(state);
        return { state, spell };
    }

    it('raises a `kind:"trigger"` PendingTarget pointed at the trigger item', () => {
        const { state, spell } = castTargeted();
        expect(state.stack).toHaveLength(2);
        expect(state.stack[1].triggeredAbilityId).toBe(
            "synthetic-self-cast-targeted"
        );
        expect(state.pendingTarget).toBeDefined();
        expect(state.pendingTarget!.kind).toBe("trigger");
        expect(state.pendingTarget!.cardInstanceId).toBe(state.stack[1].id);
        expect(state.pendingTarget!.playerId).toBe("p1");
        // CR 603.3d — the trigger never inherits the watched spell's targets.
        expect(state.stack[0].id).toBe(spell.id);
    });

    it("resolving the trigger after the choice actually exiles the chosen target", () => {
        const { state } = castTargeted();
        state.pendingTarget!.selected = [{ type: "permanent", id: "victim" }];
        finalizeTargetSelection(
            state,
            state.pendingTarget!,
            state.pendingTarget!.playerId
        );
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].exile.map((c) => c.id)).toEqual(["victim"]);
    });

    it("with nothing legal the `up to one` slot locks EMPTY instead of staying unset (CR 603.3d)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const spell = pushSpell(state, TARGETED_CARD_ID, "p1");
        spell.targets = undefined;
        emitSpellCastEvent(state, spell);
        processPendingActionTriggers(state);
        expect(state.pendingTarget).toBeUndefined();
        expect(state.stack[1].targets).toEqual([]);
    });
});

describe("regression: Mana Vortex's cast trigger reaches the stack through a real cast (issue #2319)", () => {
    // The shipped card whose clause this capability revives. Its existing
    // per-card test hand-drives the trigger via `resolveTrigger`, which proves
    // the RESOLUTION but never the COLLECTION — the half that was broken.
    it("casting Mana Vortex announces its counter-unless-you-sacrifice-a-land trigger", () => {
        const { state, spell } = cast(manaVortex.id);
        expect(state.stack).toHaveLength(2);
        expect(state.stack[0].id).toBe(spell.id);
        expect(state.stack[1].triggeredAbilityId).toBe(
            "mana-vortex-cast-counter"
        );
    });
});
