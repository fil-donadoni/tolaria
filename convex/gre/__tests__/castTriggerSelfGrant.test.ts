// A cast trigger granting its OWN spell an ability that survives onto the
// battlefield: "When you cast this spell, … it gains 'When this creature
// leaves the battlefield, …'" (the Thief of Existence shape).
//
// CR 400.7a — an effect from a triggered ability that changes the
// characteristics of a permanent spell on the stack continues to apply to the
// permanent that spell becomes. The cast trigger (CR 603.6e) resolves while the
// spell is still on the stack, so `grantAbility { target: $source,
// grantedTriggeredId }` stamps an entry grant rider on the stack item, and the
// permanent branch of `finalizeSpellResolution` converts it into an indefinite
// `grantedTriggeredAbilities` entry as the permanent enters. A spell countered
// before it resolves is a new object in the graveyard (CR 400.7) and carries
// nothing.
//
// Full path: the real cast-event seam (`emitSpellCastEvent` +
// `processPendingActionTriggers`, what `convex/game.ts` runs after pushing the
// spell), the Effect Script interpreter, resolution, the departure trigger, and
// the client surface through `projectPublicState`.
import { describe, it, expect } from "vitest";
import { preloadDefinitions } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import { spellCastTrigger } from "../../cards/abilities/triggers/spellCastTrigger";
import { leftTrigger } from "../../cards/abilities/triggers/leftTrigger";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { counterspell } from "../../cards/sets/lea/index.cards";
import { projectPublicState } from "../../gameProjections";
import {
    emitSpellCastEvent,
    getPlayer,
    processPendingActionTriggers,
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../state";

const SELF_GRANT_CARD_ID = "00000000-0000-4000-8000-0000c7a50001";
const GRANT_ID = "synthetic-self-grant-leave";

preloadDefinitions([
    {
        id: SELF_GRANT_CARD_ID,
        name: "Synthetic Self-Granting Caster",
        rarity: "rare",
        oracleText:
            'When you cast this spell, it gains "When this creature leaves the battlefield, you gain 3 life."',
        manaCost: { X: 2 },
        types: ["Creature"],
        subtypes: ["Horror"],
        power: 2,
        toughness: 2,
        triggeredAbilities: [
            spellCastTrigger({
                id: "synthetic-self-grant-cast",
                oracleText:
                    'When you cast this spell, it gains "When this creature leaves the battlefield, you gain 3 life."',
                scope: "self",
                effects: [
                    {
                        op: "grantAbility",
                        target: { ref: "$source" },
                        grantedTriggeredId: GRANT_ID,
                    },
                ],
            }),
        ],
        triggeredGrantTemplates: [
            leftTrigger({
                id: GRANT_ID,
                oracleText:
                    "When this creature leaves the battlefield, you gain 3 life.",
                scope: "self",
                effects: [{ op: "gainLife", player: "controller", amount: 3 }],
            }),
        ],
    } as CardDefinition,
]);

/** The real cast seam: `convex/game.ts`'s cast mutation pushes the stack item,
 *  then runs exactly these two calls. */
function cast(): { state: GameState; spellId: string } {
    const state = makeState({ players: [makePlayer("p1"), makePlayer("p2")] });
    const spell = pushSpell(state, SELF_GRANT_CARD_ID, "p1");
    emitSpellCastEvent(state, spell);
    processPendingActionTriggers(state);
    return { state, spellId: spell.id };
}

function selfGrants(card: CardInstanceState | undefined) {
    return (card?.grantedTriggeredAbilities ?? []).filter(
        (g) => g.abilityId === GRANT_ID && g.sourceCardId === SELF_GRANT_CARD_ID
    );
}

function pushCounterspellAt(state: GameState, spellId: string): void {
    state.stack.push({
        ...makeInstance(counterspell().id, {
            id: "counter",
            controllerId: "p2",
            ownerId: "p2",
            zone: "stack",
        }),
        castById: "p2",
        targets: [{ type: "spell", id: spellId }],
    });
}

describe("a cast trigger grants its own spell an ability carried onto the battlefield (CR 400.7a, CR 603.6e)", () => {
    it("the resolved cast trigger stamps the grant on the spell; the permanent enters with it, and it survives the projection", () => {
        const { state, spellId } = cast();
        expect(state.stack).toHaveLength(2);
        expect(state.stack[1].triggerSourceId).toBe(spellId);

        // The cast trigger resolves above its own spell.
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].entryGrantRiders).toEqual([
            { sourceCardId: SELF_GRANT_CARD_ID, abilityId: GRANT_ID },
        ]);

        resolveTopOfStack(state);
        const p1 = getPlayer(state, "p1");
        const permanent = p1.battlefield.find((c) => c.id === spellId);
        expect(selfGrants(permanent)).toHaveLength(1);
        expect(permanent!.entryGrantRiders).toBeUndefined();

        const projected = projectPublicState(state, 1, "p1")
            .players.find((p) => p.id === "p1")!
            .battlefield.find((c) => c.id === spellId)!;
        expect(projected.grantedTriggeredAbilities).toEqual([
            expect.objectContaining({
                sourceCardId: SELF_GRANT_CARD_ID,
                abilityId: GRANT_ID,
            }),
        ]);
    });

    it("the permanent keeps the granted ability: it leaves the battlefield and the granted trigger fires", () => {
        const { state, spellId } = cast();
        resolveTopOfStack(state);
        resolveTopOfStack(state);
        const p1 = getPlayer(state, "p1");
        const lifeBefore = p1.life;

        removePermanentTo(state, spellId, "graveyard");
        processPendingActionTriggers(state);
        while (state.stack.length > 0) resolveTopOfStack(state);
        expect(p1.life).toBe(lifeBefore + 3);
    });

    it("a spell countered AFTER the cast trigger resolved reaches the graveyard carrying nothing (CR 400.7)", () => {
        const { state, spellId } = cast();
        resolveTopOfStack(state);
        expect(state.stack[0].entryGrantRiders).toHaveLength(1);

        pushCounterspellAt(state, spellId);
        resolveTopOfStack(state);
        const card = getPlayer(state, "p1").graveyard.find(
            (c) => c.id === spellId
        );
        expect(card).toBeDefined();
        expect(card!.entryGrantRiders).toBeUndefined();
        expect(selfGrants(card)).toEqual([]);
    });

    it("a spell countered BEFORE the cast trigger resolves: the trigger finds no spell and grants nothing (CR 608.2b)", () => {
        const { state, spellId } = cast();
        // Counter the spell in response to its own cast trigger.
        pushCounterspellAt(state, spellId);
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(0);
        const card = getPlayer(state, "p1").graveyard.find(
            (c) => c.id === spellId
        );
        expect(card).toBeDefined();
        expect(card!.entryGrantRiders).toBeUndefined();
        expect(selfGrants(card)).toEqual([]);
    });
});
