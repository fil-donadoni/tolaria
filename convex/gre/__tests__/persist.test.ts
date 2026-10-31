// Persist (CR 702.79a, issue #1372) — "When this permanent is put into a
// graveyard from the battlefield, if it had no -1/-1 counters on it, return it
// to the battlefield under its owner's control with a -1/-1 counter on it."
//
// The keyword is expanded from the bare `staticAbilities: ["persist"]` string
// (`expandKeywordTriggers`, ADR 0054). What is new and earns tests here:
//   - the departure event's counter snapshot (`PermanentLeftEvent.
//     countersBeforeLeave`, CR 603.10a) the intervening-if reads (CR 603.4);
//   - CR 704.8 — the SBA batch's last known information (annihilation, CR
//     704.5q, is ordered after the same pass's zone changes in `sba.ts`);
//   - `moveZone`'s `entersWithCounters` field (CR 122.6 / 614.1c): the counter
//     is on the permanent AS it enters, including across an as-enters park.
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
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { projectPublicState } from "../../gameProjections";
import { validateAbilityEffectScript } from "../effects/validate";
import { withTemporaryDefinition } from "../../cards/registry";
import { getCardByName, getDefinition } from "../../cards";
import { enteredTrigger } from "../../cards/abilities/triggers/enteredTrigger";
import type {
    CardDefinition,
    EffectOp,
    PermanentEnteredEvent,
    PermanentLeftEvent,
} from "../../cards/types";

const PERSISTER_ID = "test-only-persister";
/** A 6/6 creature with persist — Woodfall Primus's body, without its ETB. */
const persister: CardDefinition = {
    id: PERSISTER_ID,
    rarity: "common",
    name: "Test Persister",
    oracleText: "Persist",
    manaCost: { X: 5, G: 1 },
    types: ["Creature"],
    subtypes: ["Treefolk"],
    power: 6,
    toughness: 6,
    staticAbilities: ["persist"],
};

const PERSIST_ARTIFACT_ID = "test-only-persist-artifact";
/** A NONCREATURE permanent with persist: CR 702.79a says "this permanent". */
const persistArtifact: CardDefinition = {
    id: PERSIST_ARTIFACT_ID,
    rarity: "common",
    name: "Test Persist Artifact",
    oracleText: "Persist",
    manaCost: { X: 2 },
    types: ["Artifact"],
    staticAbilities: ["persist"],
};

const PARKING_PERSISTER_ID = "test-only-parking-persister";
/** A persister that owes an "as it enters" choice (CR 614.12a), so its return
 *  parks the entry across a pending choice. */
const parkingPersister: CardDefinition = {
    ...persister,
    id: PARKING_PERSISTER_ID,
    name: "Test Parking Persister",
    oracleText:
        "As this creature enters, pay any amount of life, up to 3.\nPersist",
    entersWith: { asEnters: [{ kind: "payLife", cap: 3 }] },
};

const WATCHER_ID = "test-only-persist-entry-watcher";
/** Records every other permanent's PERMANENT_ENTERED event. */
function watcher(seen: PermanentEnteredEvent[]): CardDefinition {
    return {
        id: WATCHER_ID,
        name: "Test Entry Watcher",
        rarity: "common",
        manaCost: { X: 1 },
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
        id: "persister",
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

describe("Persist — expansion (CR 702.79a)", () => {
    it("the bare keyword injects ONE self PERMANENT_LEFT trigger", () => {
        withDefs([persister], () => {
            const def = getDefinition(PERSISTER_ID);
            const persist = (def.triggeredAbilities ?? []).filter(
                (t) => t.id === "persist"
            );
            expect(persist).toHaveLength(1);
            expect(persist[0].event).toBe("PERMANENT_LEFT");
        });
    });
});

describe("Woodfall Primus — the compiled card carries persist (issue #1372)", () => {
    it("serves {5}{G}{G}{G} 6/6 trample with its ETB destroy AND the persist trigger", () => {
        const named = getCardByName("Woodfall Primus");
        expect(named).toBeDefined();
        // Through the `getDefinition` seam: the compiled triggers and the
        // ADR 0054 keyword expansion are applied there.
        const primus = getDefinition(named!.id);
        expect(primus!.manaCost).toEqual({ X: 5, G: 3 });
        expect([primus!.power, primus!.toughness]).toEqual([6, 6]);
        expect(primus!.staticAbilities).toEqual(
            expect.arrayContaining(["trample", "persist"])
        );
        const ids = (primus!.triggeredAbilities ?? []).map((t) => t.event);
        expect(ids).toEqual(
            expect.arrayContaining(["PERMANENT_ENTERED", "PERMANENT_LEFT"])
        );
    });
});

describe("Persist — the return (CR 702.79a / 400.7)", () => {
    it("dies with no -1/-1 counters → returns under its owner's control with exactly one -1/-1 counter, as a new object", () => {
        withDefs([persister], () => {
            const state = board(PERSISTER_ID, {
                counters: { "+1/+1": 2 },
                damageMarked: 3,
            });
            destroy(state, "persister");
            expect(persistItems(state)).toHaveLength(1);
            drainStack(state);

            const back = findOnBattlefield(state, "persister");
            expect(back).toBeDefined();
            expect(back!.controllerId).toBe("p1");
            // CR 400.7 — a new object: the +1/+1 counters and the damage of
            // its previous existence are gone; only the persist counter is on it.
            expect(back!.counters).toEqual({ "-1/-1": 1 });
            expect(back!.damageMarked ?? 0).toBe(0);
            expect(back!.isSummoningSick).toBe(true);
            expect(getEffectivePower(state, back!)).toBe(5);
            expect(getEffectiveToughness(state, back!)).toBe(5);
            expect(
                state.players[0].graveyard.some((c) => c.id === "persister")
            ).toBe(false);
        });
    });

    it("the -1/-1 counter is on it AS it enters: the entry event already announces a 5/5 (CR 122.6 / 614.1c)", () => {
        const seen: PermanentEnteredEvent[] = [];
        const def = watcher(seen);
        withDefs([persister, def], () => {
            const watch = makeInstance(WATCHER_ID, {
                id: "watcher",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = board(PERSISTER_ID, {}, [watch]);
            destroy(state, "persister");
            drainStack(state);

            const entry = seen.find((e) => e.instanceId === "persister");
            expect(entry).toBeDefined();
            expect(entry!.power).toBe(5);
            expect(entry!.toughness).toBe(5);
        });
    });

    it("dies WITH a -1/-1 counter → does not trigger", () => {
        withDefs([persister], () => {
            const state = board(PERSISTER_ID, { counters: { "-1/-1": 1 } });
            destroy(state, "persister");
            expect(persistItems(state)).toHaveLength(0);
            drainStack(state);
            expect(findOnBattlefield(state, "persister")).toBeUndefined();
            expect(
                state.players[0].graveyard.some((c) => c.id === "persister")
            ).toBe(true);
        });
    });

    it("persists once, then stays dead: the returned permanent carries the counter that stops the second return", () => {
        withDefs([persister], () => {
            const state = board(PERSISTER_ID);
            destroy(state, "persister");
            drainStack(state);
            expect(findOnBattlefield(state, "persister")).toBeDefined();
            flushPendingEvents(state);

            destroy(state, "persister");
            expect(persistItems(state)).toHaveLength(0);
            drainStack(state);
            expect(findOnBattlefield(state, "persister")).toBeUndefined();
        });
    });

    it("CR 702.79a says PERMANENT: a noncreature permanent with persist returns too", () => {
        withDefs([persistArtifact], () => {
            const state = board(PERSIST_ARTIFACT_ID);
            destroy(state, "persister");
            expect(persistItems(state)).toHaveLength(1);
            drainStack(state);
            expect(findOnBattlefield(state, "persister")?.counters).toEqual({
                "-1/-1": 1,
            });
        });
    });

    it("a stolen persister returns under its OWNER's control (CR 108.3); the trigger is the last controller's (CR 603.3a)", () => {
        withDefs([persister], () => {
            const state = board(PERSISTER_ID, {
                controllerId: "p2",
                ownerId: "p1",
            });
            destroy(state, "persister");
            expect(persistItems(state)[0]?.castById).toBe("p2");
            drainStack(state);
            expect(
                state.players[1].battlefield.some((c) => c.id === "persister")
            ).toBe(false);
            const back = state.players[0].battlefield.find(
                (c) => c.id === "persister"
            );
            expect(back?.controllerId).toBe("p1");
            expect(back?.counters).toEqual({ "-1/-1": 1 });
        });
    });

    it("the card leaves the graveyard before the trigger resolves → nothing returns, no error (CR 400.7)", () => {
        withDefs([persister], () => {
            const state = board(PERSISTER_ID);
            destroy(state, "persister");
            expect(persistItems(state)).toHaveLength(1);
            // Exiled in response (a graveyard-hate effect).
            const gy = state.players[0].graveyard;
            const [card] = gy.splice(
                gy.findIndex((c) => c.id === "persister"),
                1
            );
            card.zone = "exile";
            state.players[0].exile.push(card);

            expect(() => drainStack(state)).not.toThrow();
            expect(findOnBattlefield(state, "persister")).toBeUndefined();
            expect(
                state.players[0].exile.some((c) => c.id === "persister")
            ).toBe(true);
        });
    });

    it("a TOKEN with persist returns nothing (CR 111.7)", () => {
        withDefs([persister], () => {
            const state = board(PERSISTER_ID, { isToken: true });
            destroy(state, "persister");
            drainStack(state);
            expect(findOnBattlefield(state, "persister")).toBeUndefined();
        });
    });

    it("wire format: the returned permanent's -1/-1 counter survives `projectPublicState`", () => {
        withDefs([persister], () => {
            const state = board(PERSISTER_ID);
            destroy(state, "persister");
            drainStack(state);
            const pub = projectPublicState(state, "p1");
            const wire = pub.players
                .flatMap((p) => p.battlefield)
                .find((c) => c.id === "persister");
            expect(wire?.counters).toEqual({ "-1/-1": 1 });
        });
    });
});

describe("Persist — the counter snapshot (CR 603.10a / 603.4)", () => {
    it("the departure event carries the counters it left with", () => {
        withDefs([persister], () => {
            const state = board(PERSISTER_ID, {
                counters: { "+1/+1": 1, "-1/-1": 2 },
            });
            removePermanentTo(state, "persister", "graveyard", "destroy");
            const left = (state.pendingEvents ?? []).find(
                (e): e is PermanentLeftEvent =>
                    e.type === "PERMANENT_LEFT" && e.instanceId === "persister"
            );
            expect(left?.countersBeforeLeave).toEqual({
                "+1/+1": 1,
                "-1/-1": 2,
            });
        });
    });

    it("survives a save/load (compact → expand) between trigger and resolution", () => {
        withDefs([persister], () => {
            const state = board(PERSISTER_ID, { counters: { "+1/+1": 1 } });
            destroy(state, "persister");
            expect(persistItems(state)).toHaveLength(1);

            const reloaded = expandState(compactState(state)) as GameState;
            const item = persistItems(reloaded)[0];
            expect(
                (item.triggerEvent as PermanentLeftEvent).countersBeforeLeave
            ).toEqual({ "+1/+1": 1 });
            drainStack(reloaded);
            expect(findOnBattlefield(reloaded, "persister")?.counters).toEqual({
                "-1/-1": 1,
            });
        });
    });
});

describe("Persist — state-based actions (CR 704.5q / 704.8)", () => {
    it("the Kitchen Finks loop: -1/-1 and +1/+1 annihilated in an EARLIER check, then it dies → it persists again", () => {
        withDefs([persister], () => {
            const state = board(PERSISTER_ID, { counters: { "-1/-1": 1 } });
            const card = findOnBattlefield(state, "persister")!;
            addCounterToCard(state, card, "+1/+1", 1);
            checkStateBasedActions(state);
            expect(
                findOnBattlefield(state, "persister")?.counters ?? {}
            ).toEqual({});

            destroy(state, "persister");
            expect(persistItems(state)).toHaveLength(1);
            drainStack(state);
            expect(findOnBattlefield(state, "persister")?.counters).toEqual({
                "-1/-1": 1,
            });
        });
    });

    it("annihilation in the SAME check that kills it: the LKI still shows the -1/-1 counter, so it does not persist (CR 704.8)", () => {
        withDefs([persister], () => {
            // A 5/5 (6/6 with a -1/-1 counter) gets a +1/+1 counter and is
            // dealt lethal damage before state-based actions are checked: CR
            // 704.5g (lethal damage) and 704.5q (annihilation) are performed
            // simultaneously, and CR 704.8 reads its LKI from before both.
            const state = board(PERSISTER_ID, {
                counters: { "-1/-1": 1 },
                damageMarked: 6,
            });
            const card = findOnBattlefield(state, "persister")!;
            addCounterToCard(state, card, "+1/+1", 1);
            checkStateBasedActions(state);

            expect(findOnBattlefield(state, "persister")).toBeUndefined();
            expect(persistItems(state)).toHaveLength(0);
            drainStack(state);
            expect(findOnBattlefield(state, "persister")).toBeUndefined();
        });
    });
});

describe("moveZone entersWithCounters (CR 122.6, issue #1372)", () => {
    it("the counters ride an as-enters park (CR 614.12a) and are placed when the entry resumes", () => {
        withDefs([parkingPersister], () => {
            const state = board(PARKING_PERSISTER_ID);
            destroy(state, "persister");
            // ONE resolution: it suspends on the as-enters choice, leaving the
            // resolving trigger on the stack (ADR 0100 D5), so draining loops.
            resolveTopOfStack(state);
            expect(findOnBattlefield(state, "persister")).toBeUndefined();
            // Parked on the pay-life choice: not yet on the battlefield.
            expect(state.stagedEntries?.[0]?.entryCounters).toEqual({
                "-1/-1": 1,
            });
            const reloaded = expandState(compactState(state)) as GameState;
            const h = (reloaded.pendingChoices ?? [])[0];
            applyPendingChoiceSubmit(reloaded, {
                playerId: h.playerId,
                stackItemId: h.stackItemId,
                step: h.step,
                choiceId: h.choiceId,
                cardInstanceIds: ["0"],
            });
            expect(findOnBattlefield(reloaded, "persister")?.counters).toEqual({
                "-1/-1": 1,
            });
        });
    });

    it("validator: accepted on the target shape to the battlefield, refused anywhere else", () => {
        const validate = (effects: EffectOp[]) =>
            validateAbilityEffectScript(
                { id: "t", effects },
                "Test",
                "PERMANENT_LEFT"
            );
        const ok: EffectOp[] = [
            {
                op: "moveZone",
                target: { ref: "$source" },
                from: "graveyard",
                to: "battlefield",
                entersWithCounters: { "-1/-1": 1 },
            },
        ];
        expect(validate(ok)).toEqual([]);
        const toHand: EffectOp[] = [
            {
                op: "moveZone",
                target: { ref: "$source" },
                from: "graveyard",
                to: "hand",
                entersWithCounters: { "-1/-1": 1 },
            },
        ];
        expect(validate(toHand).join("\n")).toMatch(/entersWithCounters/);
        const badMap = [
            {
                op: "moveZone",
                target: { ref: "$source" },
                from: "graveyard",
                to: "battlefield",
                entersWithCounters: { "-1/-1": 0 },
            },
        ] as unknown as EffectOp[];
        expect(validate(badMap)).not.toEqual([]);
    });
});
