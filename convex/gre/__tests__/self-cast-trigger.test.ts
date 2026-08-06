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
import { makeState, makePlayer, pushSpell } from "../../cards/__tests__/setup";
import { emitSpellCastEvent, processPendingActionTriggers } from "../state";

const SELF_CARD_ID = "00000000-0000-4000-8000-00005e1f0001";
const WATCHER_CARD_ID = "00000000-0000-4000-8000-00005e1f0002";

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
