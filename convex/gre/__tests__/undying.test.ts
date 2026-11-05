// Undying (CR 702.93a, issue #3997) — "When this permanent is put into a
// graveyard from the battlefield, if it had no +1/+1 counters on it, return it
// to the battlefield under its owner's control with a +1/+1 counter on it."
//
// The keyword shares persist's trigger (`returnWithCounterTrigger`,
// `convex/cards/abilities/keywordTriggers.ts`), differing only in the counter
// kind, so `persist.test.ts` owns the seams they share (the as-enters park, the
// card leaving the graveyard in response, the `moveZone` validator). What earns
// a test here is what the counter kind changes, and that both keywords on one
// permanent keep their counters apart.
// Every board goes through the production funnels: `removePermanentTo` /
// `checkStateBasedActions` → `processPendingActionTriggers` → the stack.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveTriggerOrder,
} from "../../cards/__tests__/setup.helper";
import {
    addCounterToCard,
    flushPendingEvents,
    processPendingActionTriggers,
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../state";
import { checkStateBasedActions } from "../sba";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";
import { withTemporaryDefinition } from "../../cards/registry";
import { getDefinition } from "../../cards";
import { liveKeywordTriggerInstances } from "../../cards/abilities/liveKeywordTriggers";
import { enteredTrigger } from "../../cards/abilities/triggers/enteredTrigger";
import type { CardDefinition, PermanentEnteredEvent } from "../../cards/types";

const UNDYING_ID = "test-only-undying";
/** A 1/1 creature with undying — Young Wolf's body (CR 704.8's own example). */
const undyingCreature: CardDefinition = {
    id: UNDYING_ID,
    rarity: "common",
    name: "Test Undying Creature",
    oracleText: "Undying",
    manaCost: { G: 1 },
    types: ["Creature"],
    power: 1,
    toughness: 1,
    staticAbilities: ["undying"],
};

const UNDYING_ARTIFACT_ID = "test-only-undying-artifact";
/** A NONCREATURE permanent with undying: CR 702.93a says "this permanent". */
const undyingArtifact: CardDefinition = {
    id: UNDYING_ARTIFACT_ID,
    rarity: "common",
    name: "Test Undying Artifact",
    oracleText: "Undying",
    manaCost: { X: 2 },
    types: ["Artifact"],
    staticAbilities: ["undying"],
};

const BOTH_ID = "test-only-persist-undying";
/** A 2/2 with undying AND persist, each checking its own counter kind. */
const persistAndUndying: CardDefinition = {
    id: BOTH_ID,
    rarity: "common",
    name: "Test Persist Undying Creature",
    oracleText: "Persist\nUndying",
    manaCost: { X: 2 },
    types: ["Creature"],
    power: 2,
    toughness: 2,
    staticAbilities: ["persist", "undying"],
};

const WATCHER_ID = "test-only-undying-entry-watcher";
/** Records every other permanent's PERMANENT_ENTERED event. */
function watcher(seen: PermanentEnteredEvent[]): CardDefinition {
    return {
        id: WATCHER_ID,
        name: "Test Entry Watcher",
        rarity: "common",
        types: ["Enchantment"],
        oracleText: "Test only.",
        triggeredAbilities: [
            enteredTrigger({
                id: "watch",
                oracleText: "Test only.",
                scope: "any-other",
                condition: (event) => {
                    seen.push(event);
                    return false;
                },
                effects: [],
            }),
        ],
    };
}

function withDefs(defs: CardDefinition[], run: () => void): void {
    const [head, ...rest] = defs;
    if (!head) return run();
    withTemporaryDefinition(head, () => withDefs(rest, run));
}

function board(
    cardId: string,
    overrides: Partial<CardInstanceState> = {},
    extra: CardInstanceState[] = []
): GameState {
    const card = makeInstance(cardId, {
        id: "undying",
        controllerId: "p1",
        ownerId: "p1",
        isSummoningSick: false,
        ...overrides,
    });
    const onP1 = card.controllerId === "p1" ? [card] : [];
    const onP2 = card.controllerId === "p2" ? [card] : [];
    return makeState({
        players: [
            makePlayer("p1", { battlefield: [...onP1, ...extra] }),
            makePlayer("p2", { battlefield: onP2 }),
        ],
    });
}

function findOnBattlefield(
    state: GameState,
    id: string
): CardInstanceState | undefined {
    for (const p of state.players) {
        const found = p.battlefield.find((c) => c.id === id);
        if (found) return found;
    }
    return undefined;
}

function undyingItems(state: GameState) {
    return state.stack.filter((s) => s.triggeredAbilityId === "undying");
}

function persistItems(state: GameState) {
    return state.stack.filter((s) => s.triggeredAbilityId === "persist");
}

function drainStack(state: GameState): void {
    resolveTriggerOrder(state);
    while (state.stack.length > 0) resolveTopOfStack(state);
}

/** Destroys the permanent through the production departure funnel and puts
 *  whatever triggered on the stack. */
function destroy(state: GameState, id: string): void {
    removePermanentTo(state, id, "graveyard", "destroy");
    processPendingActionTriggers(state);
    resolveTriggerOrder(state);
}

describe("Undying — the live keyword (CR 702.93a)", () => {
    it("one occurrence is ONE self PERMANENT_LEFT trigger, on no definition", () => {
        withDefs([undyingCreature], () => {
            expect(
                (getDefinition(UNDYING_ID).triggeredAbilities ?? []).filter(
                    (t) => t.id === "undying"
                )
            ).toHaveLength(0);
            const abilities = liveKeywordTriggerInstances(["undying"]);
            expect(abilities).toHaveLength(1);
            expect(abilities[0].event).toBe("PERMANENT_LEFT");
        });
    });
});

describe("Undying — the return (CR 702.93a / 400.7)", () => {
    it("dies with no +1/+1 counters → returns under its owner's control with exactly one +1/+1 counter, as a new object", () => {
        withDefs([undyingCreature], () => {
            const state = board(UNDYING_ID, { damageMarked: 1 });
            destroy(state, "undying");
            expect(undyingItems(state)).toHaveLength(1);
            drainStack(state);

            const back = findOnBattlefield(state, "undying");
            expect(back).toBeDefined();
            expect(back!.controllerId).toBe("p1");
            expect(back!.counters).toEqual({ "+1/+1": 1 });
            expect(back!.damageMarked ?? 0).toBe(0);
            expect(back!.isSummoningSick).toBe(true);
            expect(getEffectivePower(state, back!)).toBe(2);
            expect(getEffectiveToughness(state, back!)).toBe(2);
            expect(
                state.players[0].graveyard.some((c) => c.id === "undying")
            ).toBe(false);
        });
    });

    it("the +1/+1 counter is on it AS it enters: the entry event already announces a 2/2 (CR 122.6 / 614.1c)", () => {
        const seen: PermanentEnteredEvent[] = [];
        const def = watcher(seen);
        withDefs([undyingCreature, def], () => {
            const watch = makeInstance(WATCHER_ID, {
                id: "watcher",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = board(UNDYING_ID, {}, [watch]);
            destroy(state, "undying");
            drainStack(state);

            const entry = seen.find((e) => e.instanceId === "undying");
            expect(entry).toBeDefined();
            expect(entry!.power).toBe(2);
            expect(entry!.toughness).toBe(2);
        });
    });

    it("dies WITH a +1/+1 counter → does not trigger", () => {
        withDefs([undyingCreature], () => {
            const state = board(UNDYING_ID, { counters: { "+1/+1": 1 } });
            destroy(state, "undying");
            expect(undyingItems(state)).toHaveLength(0);
            drainStack(state);
            expect(findOnBattlefield(state, "undying")).toBeUndefined();
            expect(
                state.players[0].graveyard.some((c) => c.id === "undying")
            ).toBe(true);
        });
    });

    it("the counter kind is +1/+1, not persist's: dying with only a -1/-1 counter still returns it", () => {
        withDefs([undyingCreature], () => {
            const state = board(UNDYING_ID, { counters: { "-1/-1": 1 } });
            destroy(state, "undying");
            expect(undyingItems(state)).toHaveLength(1);
            drainStack(state);
            // CR 400.7 — the -1/-1 counter of its previous existence is gone.
            expect(findOnBattlefield(state, "undying")?.counters).toEqual({
                "+1/+1": 1,
            });
        });
    });

    it("returns once, then stays dead: the returned permanent carries the counter that stops the second return", () => {
        withDefs([undyingCreature], () => {
            const state = board(UNDYING_ID);
            destroy(state, "undying");
            drainStack(state);
            expect(findOnBattlefield(state, "undying")).toBeDefined();
            flushPendingEvents(state);

            destroy(state, "undying");
            expect(undyingItems(state)).toHaveLength(0);
            drainStack(state);
            expect(findOnBattlefield(state, "undying")).toBeUndefined();
        });
    });

    it("CR 702.93a says PERMANENT: a noncreature permanent with undying returns too", () => {
        withDefs([undyingArtifact], () => {
            const state = board(UNDYING_ARTIFACT_ID);
            destroy(state, "undying");
            expect(undyingItems(state)).toHaveLength(1);
            drainStack(state);
            expect(findOnBattlefield(state, "undying")?.counters).toEqual({
                "+1/+1": 1,
            });
        });
    });

    it("a stolen creature with undying returns under its OWNER's control (CR 108.3); the trigger is the last controller's (CR 603.3a)", () => {
        withDefs([undyingCreature], () => {
            const state = board(UNDYING_ID, {
                controllerId: "p2",
                ownerId: "p1",
            });
            destroy(state, "undying");
            expect(undyingItems(state)[0]?.castById).toBe("p2");
            drainStack(state);
            expect(
                state.players[1].battlefield.some((c) => c.id === "undying")
            ).toBe(false);
            const back = state.players[0].battlefield.find(
                (c) => c.id === "undying"
            );
            expect(back?.controllerId).toBe("p1");
            expect(back?.counters).toEqual({ "+1/+1": 1 });
        });
    });

    it("a TOKEN with undying returns nothing (CR 111.7)", () => {
        withDefs([undyingCreature], () => {
            const state = board(UNDYING_ID, { isToken: true });
            destroy(state, "undying");
            drainStack(state);
            expect(findOnBattlefield(state, "undying")).toBeUndefined();
        });
    });

    it("wire format: the returned permanent's +1/+1 counter survives `projectPublicState`", () => {
        withDefs([undyingCreature], () => {
            const state = board(UNDYING_ID);
            destroy(state, "undying");
            drainStack(state);
            const pub = projectPublicState(state, 1, "p1");
            const wire = pub.players
                .flatMap((p) => p.battlefield)
                .find((c) => c.id === "undying");
            expect(wire?.counters).toEqual({ "+1/+1": 1 });
        });
    });

    it("survives a save/load (compact → expand) between trigger and resolution", () => {
        withDefs([undyingCreature], () => {
            const state = board(UNDYING_ID, { counters: { "-1/-1": 1 } });
            destroy(state, "undying");
            expect(undyingItems(state)).toHaveLength(1);

            const reloaded = expandState(compactState(state)) as GameState;
            drainStack(reloaded);
            expect(findOnBattlefield(reloaded, "undying")?.counters).toEqual({
                "+1/+1": 1,
            });
        });
    });
});

describe("Undying — state-based actions (CR 704.5q / 704.8)", () => {
    it("+1/+1 and -1/-1 annihilated in an EARLIER check, then it dies → it returns again", () => {
        withDefs([undyingCreature], () => {
            const state = board(UNDYING_ID, { counters: { "+1/+1": 1 } });
            const card = findOnBattlefield(state, "undying")!;
            addCounterToCard(state, card, "-1/-1", 1);
            checkStateBasedActions(state);
            expect(findOnBattlefield(state, "undying")?.counters ?? {}).toEqual(
                {}
            );

            destroy(state, "undying");
            expect(undyingItems(state)).toHaveLength(1);
            drainStack(state);
            expect(findOnBattlefield(state, "undying")?.counters).toEqual({
                "+1/+1": 1,
            });
        });
    });

    it("CR 704.8's example: Young Wolf with a +1/+1 counter gets three -1/-1 counters, dies, and undying does not trigger", () => {
        withDefs([undyingCreature], () => {
            const state = board(UNDYING_ID, { counters: { "+1/+1": 1 } });
            const card = findOnBattlefield(state, "undying")!;
            addCounterToCard(state, card, "-1/-1", 3);
            checkStateBasedActions(state);

            expect(findOnBattlefield(state, "undying")).toBeUndefined();
            expect(undyingItems(state)).toHaveLength(0);
            drainStack(state);
            expect(findOnBattlefield(state, "undying")).toBeUndefined();
        });
    });
});

describe("Undying beside persist — each keyword reads its own counter (CR 702.93a / 702.79a)", () => {
    it("dies with neither counter: both trigger, the first returns it, the second finds no card (CR 400.7)", () => {
        withDefs([persistAndUndying], () => {
            const state = board(BOTH_ID);
            destroy(state, "undying");
            expect(undyingItems(state)).toHaveLength(1);
            expect(persistItems(state)).toHaveLength(1);
            drainStack(state);

            const counters = findOnBattlefield(state, "undying")?.counters;
            expect(Object.values(counters ?? {})).toEqual([1]);
        });
    });

    it("dies with a -1/-1 counter: only undying triggers, and the +1/+1 counter comes back alone", () => {
        withDefs([persistAndUndying], () => {
            const state = board(BOTH_ID, { counters: { "-1/-1": 1 } });
            destroy(state, "undying");
            expect(undyingItems(state)).toHaveLength(1);
            expect(persistItems(state)).toHaveLength(0);
            drainStack(state);
            expect(findOnBattlefield(state, "undying")?.counters).toEqual({
                "+1/+1": 1,
            });
        });
    });

    it("dies with a +1/+1 counter: only persist triggers, and the -1/-1 counter comes back alone", () => {
        withDefs([persistAndUndying], () => {
            const state = board(BOTH_ID, { counters: { "+1/+1": 1 } });
            destroy(state, "undying");
            expect(undyingItems(state)).toHaveLength(0);
            expect(persistItems(state)).toHaveLength(1);
            drainStack(state);
            expect(findOnBattlefield(state, "undying")?.counters).toEqual({
                "-1/-1": 1,
            });
        });
    });
});
