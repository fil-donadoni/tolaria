// CR 400.7 (issue #5523) — an object that changes zones becomes a new object
// with no memory of its previous existence. The "mana spent to cast it" record
// (`notedManaSpentOnCast`) the Elemental Incarnations read in their ETB
// conditions must not survive a trip through the graveyard / exile.
import { describe, it, expect } from "vitest";
import {
    buildSpellContext,
    removePermanentTo,
    resolveTopOfStack,
    type GameState,
    type StackItem,
} from "../state";
import { collectTriggers } from "../triggers";
import {
    deceit,
    vibrance,
    wistfulness,
} from "../../cards/sets/ecl/multicolor.cards";
import {
    makeInstance,
    makeState,
    makePlayer,
    pushSpell,
} from "../../cards/__tests__/setup.helper";

const CYCLE = [
    { name: "Deceit", def: deceit, spent: { U: 2, B: 2 }, other: { U: 2 } },
    { name: "Vibrance", def: vibrance, spent: { R: 2, G: 2 }, other: { R: 2 } },
    {
        name: "Wistfulness",
        def: wistfulness,
        spent: { G: 2, U: 2 },
        other: { G: 2 },
    },
] as const;

function enterTriggers(state: GameState, cardId: string): StackItem[] {
    const triggers = collectTriggers(state, [
        {
            type: "PERMANENT_ENTERED",
            instanceId: "inc",
            controllerId: "p1",
            cardId,
            types: ["Creature"],
        },
    ]);
    state.pendingChoices = undefined;
    return triggers;
}

function castAndResolve(
    def: (typeof CYCLE)[number]["def"],
    spent: Record<string, number>
): GameState {
    const inc = makeInstance(def().id, {
        id: "inc",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [makePlayer("p1"), makePlayer("p2")],
    });
    state.stack.push({
        ...inc,
        zone: "stack",
        castById: "p1",
        notedManaSpent: { ...spent },
    });
    resolveTopOfStack(state);
    return state;
}

describe.each(CYCLE)(
    "$name — mana-spent record is per-object (CR 400.7, issue #5523)",
    ({ def, spent }) => {
        it("a hard cast records the spent mana and fires its ETBs", () => {
            const state = castAndResolve(def, spent);
            const perm = state.players[0].battlefield.find(
                (c) => c.id === "inc"
            );
            expect(perm?.notedManaSpentOnCast).toEqual(spent);
            expect(enterTriggers(state, def().id).length).toBeGreaterThan(0);
        });

        it("reanimated from the graveyard: record empty, no ETB fires", () => {
            const state = castAndResolve(def, spent);
            expect(removePermanentTo(state, "inc", "graveyard")).not.toBeNull();
            const ctx = buildSpellContext(
                state,
                pushSpell(state, def().id, "p1")
            );
            expect(ctx.returnToBattlefield("p1", "inc", "graveyard")).toBe(
                true
            );
            const back = state.players[0].battlefield.find(
                (c) => c.id === "inc"
            );
            expect(back?.notedManaSpentOnCast).toBeUndefined();
            expect(enterTriggers(state, def().id)).toHaveLength(0);
        });

        it("flickered through exile: record undefined on the returned permanent", () => {
            const state = castAndResolve(def, spent);
            expect(removePermanentTo(state, "inc", "exile")).not.toBeNull();
            const ctx = buildSpellContext(
                state,
                pushSpell(state, def().id, "p1")
            );
            expect(ctx.returnToBattlefield("p1", "inc", "exile")).toBe(true);
            const back = state.players[0].battlefield.find(
                (c) => c.id === "inc"
            );
            expect(back?.notedManaSpentOnCast).toBeUndefined();
        });

        it("recast after a zone change takes a fresh snapshot", () => {
            const state = castAndResolve(def, spent);
            expect(removePermanentTo(state, "inc", "hand")).not.toBeNull();
            const card = state.players[0].hand.find((c) => c.id === "inc")!;
            expect(card.notedManaSpentOnCast).toBeUndefined();
            state.players[0].hand = [];
            state.stack.push({
                ...card,
                zone: "stack",
                castById: "p1",
                notedManaSpent: { ...spent },
            });
            resolveTopOfStack(state);
            expect(
                state.players[0].battlefield.find((c) => c.id === "inc")
                    ?.notedManaSpentOnCast
            ).toEqual(spent);
        });
    }
);
