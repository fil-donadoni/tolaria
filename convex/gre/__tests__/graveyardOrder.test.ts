// CR 404.3 (issue #9554) — "If an effect or rule puts two or more cards into
// the same graveyard at the same time, the owner of those cards may arrange
// them in any order."
//
// The batch is one simultaneous event — one resolving instruction (an Effect
// Script Op, a `resolve()` step) or one SBA pass — and is raised as a
// `graveyard-order` prompt at the SBA settle point (`gre/graveyardOrder.ts`).

import { describe, it, expect } from "vitest";
import {
    getPlayer,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../state";
import { activateAbilityOnState } from "../activation";
import { checkStateBasedActions } from "../sba";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { withGraveyardArrivalBatch } from "../graveyardOrder";
import { compactState, expandState } from "../serialize";
import { presentedDefId } from "../copy";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";

const HERMIT_DRUID = getCardByName("Hermit Druid").id;
const SHAPESHIFTER = getCardByName("Volrath's Shapeshifter").id;
const FOREST = getCardByName("Forest").id;
const BEARS = getCardByName("Grizzly Bears").id;
const WURM = getCardByName("Craw Wurm").id;
const BOLT = getCardByName("Lightning Bolt").id;
const LIONS = getCardByName("Savannah Lions").id;
const WRATH = getCardByName("Wrath of God").id;

function gy(state: GameState, playerId: string): string[] {
    return getPlayer(state, playerId).graveyard.map((c) => c.id);
}

/** Hermit Druid on p1's battlefield, `library` top-first, a {G} floating. */
function druidState(
    library: CardInstanceState[],
    graveyard: CardInstanceState[] = []
): { state: GameState; druid: CardInstanceState } {
    const state = makeState();
    const p1 = getPlayer(state, "p1");
    const druid = makeInstance(HERMIT_DRUID, {
        id: "druid",
        ownerId: "p1",
        controllerId: "p1",
        zone: "battlefield",
    });
    p1.battlefield.push(druid);
    p1.library = library;
    p1.graveyard = graveyard;
    p1.manaPool = { ...p1.manaPool, G: 1 };
    return { state, druid };
}

function lib(cardId: string, id: string): CardInstanceState {
    return makeInstance(cardId, {
        id,
        ownerId: "p1",
        controllerId: "p1",
        zone: "library",
    });
}

function activateDruidAndResolve(state: GameState): void {
    activateAbilityOnState(state, {
        playerId: "p1",
        cardInstanceId: "druid",
        abilityId: "hermit-druid-ability",
    });
    resolveTopOfStack(state);
    checkStateBasedActions(state);
}

function submitOrder(
    state: GameState,
    topmostFirst: string[],
    orderRandomly = false
): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: topmostFirst,
        ...(orderRandomly ? { orderRandomly: true } : {}),
    });
}

describe("CR 404.3 — Hermit Druid's revealed cards are one batch", () => {
    it("prompts the owner; the answer is the graveyard's top-down order above the cards already there", () => {
        const { state } = druidState(
            [
                lib(BEARS, "bears"),
                lib(BOLT, "bolt"),
                lib(WURM, "wurm"),
                lib(FOREST, "forest"),
            ],
            [
                makeInstance(LIONS, {
                    id: "old",
                    ownerId: "p1",
                    controllerId: "p1",
                    zone: "graveyard",
                }),
            ]
        );
        activateDruidAndResolve(state);

        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("graveyard-order");
        expect(head?.playerId).toBe("p1");
        expect(head?.stackItemId).toBe("");
        // Topmost first: the engine order (bears in first, wurm last = top).
        expect(head?.candidateIds).toEqual(["wurm", "bolt", "bears"]);
        expect(getPlayer(state, "p1").hand.map((c) => c.id)).toContain(
            "forest"
        );

        submitOrder(state, ["bears", "wurm", "bolt"]);

        // Bottom → top: the pre-existing card stays below the batch.
        expect(gy(state, "p1")).toEqual(["old", "bolt", "wurm", "bears"]);
        expect(state.pendingChoices).toBeUndefined();
        expect(state.pendingGraveyardArrangements).toBeUndefined();
        expect(state.priorityPlayerId).toBe("p1");
    });

    it("refuses an answer that is not a permutation of the batch", () => {
        const { state } = druidState([
            lib(BEARS, "bears"),
            lib(BOLT, "bolt"),
            lib(FOREST, "forest"),
        ]);
        activateDruidAndResolve(state);
        expect(() => submitOrder(state, ["bears"])).toThrow();
        expect(() => submitOrder(state, ["bears", "bears"])).toThrow();
        expect(state.pendingChoices?.[0]?.kind).toBe("graveyard-order");
    });

    it("Volrath's Shapeshifter takes the text of the creature the owner puts on top", () => {
        const { state } = druidState([
            lib(BEARS, "bears"),
            lib(WURM, "wurm"),
            lib(BOLT, "bolt"),
            lib(FOREST, "forest"),
        ]);
        getPlayer(state, "p1").battlefield.push(
            makeInstance(SHAPESHIFTER, {
                id: "shifter",
                ownerId: "p1",
                controllerId: "p1",
                zone: "battlefield",
            })
        );
        activateDruidAndResolve(state);
        // Engine order would leave Lightning Bolt on top (no creature).
        submitOrder(state, ["wurm", "bolt", "bears"]);
        expect(gy(state, "p1").at(-1)).toBe("wurm");
        const shifter = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "shifter"
        )!;
        expect(presentedDefId(shifter)).toBe(WURM);
    });

    it("survives a save at the prompt (the queue is persisted)", () => {
        const { state } = druidState([
            lib(BEARS, "bears"),
            lib(BOLT, "bolt"),
            lib(FOREST, "forest"),
        ]);
        activateDruidAndResolve(state);
        const round = expandState(compactState(state));
        expect(round.pendingGraveyardArrangements).toEqual(
            state.pendingGraveyardArrangements
        );
        submitOrder(round, ["bears", "bolt"]);
        expect(gy(round, "p1")).toEqual(["bolt", "bears"]);
    });

    it('"Order randomly" draws a seeded permutation server-side', () => {
        const run = (): string[] => {
            const { state } = druidState([
                lib(BEARS, "bears"),
                lib(BOLT, "bolt"),
                lib(WURM, "wurm"),
                lib(LIONS, "lions"),
                lib(FOREST, "forest"),
            ]);
            state.rngSeed = 7;
            state.rngCounter = 0;
            activateDruidAndResolve(state);
            const counter = state.rngCounter;
            submitOrder(state, [], true);
            expect(state.rngCounter).toBeGreaterThan(counter);
            expect(state.pendingChoices).toBeUndefined();
            return gy(state, "p1");
        };
        const first = run();
        expect([...first].sort()).toEqual(["bears", "bolt", "lions", "wurm"]);
        expect(run()).toEqual(first);
    });
});

describe("CR 404.3 — simultaneous deaths", () => {
    function creature(cardId: string, id: string, ownerId: string) {
        return makeInstance(cardId, {
            id,
            ownerId,
            controllerId: ownerId,
            zone: "battlefield",
        });
    }

    it("one SBA pass: two lethal-damaged creatures of one owner prompt that owner", () => {
        const state = makeState();
        const p1 = getPlayer(state, "p1");
        p1.battlefield.push(
            creature(BEARS, "bears", "p1"),
            creature(LIONS, "lions", "p1")
        );
        p1.battlefield.forEach((c) => (c.damageMarked = 5));
        checkStateBasedActions(state);
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("graveyard-order");
        expect([...(head?.candidateIds ?? [])].sort()).toEqual([
            "bears",
            "lions",
        ]);
    });

    it("a mass destroy over two owners prompts each owner once, APNAP", () => {
        const state = makeState({
            activePlayerId: "p2",
            priorityPlayerId: "p2",
        });
        getPlayer(state, "p1").battlefield.push(
            creature(BEARS, "a-bears", "p1"),
            creature(LIONS, "a-lions", "p1")
        );
        getPlayer(state, "p2").battlefield.push(
            creature(WURM, "b-wurm", "p2"),
            creature(BEARS, "b-bears", "p2")
        );
        pushSpell(state, WRATH, "p2");
        resolveTopOfStack(state);
        checkStateBasedActions(state);

        // Active player (p2) first.
        expect(state.pendingChoices?.[0]?.playerId).toBe("p2");
        submitOrder(state, ["b-wurm", "b-bears"]);
        expect(gy(state, "p2").filter((id) => id.startsWith("b-"))).toEqual([
            "b-bears",
            "b-wurm",
        ]);
        expect(state.pendingChoices?.[0]?.playerId).toBe("p1");
        expect(state.pendingChoices?.[0]?.kind).toBe("graveyard-order");
        submitOrder(state, ["a-bears", "a-lions"]);
        expect(gy(state, "p1")).toEqual(["a-lions", "a-bears"]);
        expect(state.pendingChoices).toBeUndefined();
    });
});

describe("CR 404.3 — no prompt when it cannot matter", () => {
    it("a single card", () => {
        const { state } = druidState([lib(BEARS, "bears"), lib(FOREST, "f")]);
        activateDruidAndResolve(state);
        expect(state.pendingChoices).toBeUndefined();
        expect(gy(state, "p1")).toEqual(["bears"]);
    });

    it("a batch of copies of one name", () => {
        const { state } = druidState([
            lib(BEARS, "bears-1"),
            lib(BEARS, "bears-2"),
            lib(FOREST, "f"),
        ]);
        activateDruidAndResolve(state);
        expect(state.pendingChoices).toBeUndefined();
        expect(state.pendingGraveyardArrangements).toBeUndefined();
    });

    it('an effect that says "in a random order" — seeded, no prompt', () => {
        const run = (): string[] => {
            const state = makeState({ rngSeed: 11, rngCounter: 0 });
            const p1 = getPlayer(state, "p1");
            p1.hand = [
                makeInstance(BEARS, { id: "h1", ownerId: "p1", zone: "hand" }),
                makeInstance(BOLT, { id: "h2", ownerId: "p1", zone: "hand" }),
                makeInstance(WURM, { id: "h3", ownerId: "p1", zone: "hand" }),
                makeInstance(LIONS, { id: "h4", ownerId: "p1", zone: "hand" }),
            ];
            withGraveyardArrivalBatch(
                state,
                () => {
                    for (const card of p1.hand.splice(0)) {
                        card.zone = "graveyard";
                        p1.graveyard.push(card);
                    }
                },
                "random"
            );
            expect(state.rngCounter).toBeGreaterThan(0);
            checkStateBasedActions(state);
            expect(state.pendingChoices).toBeUndefined();
            return gy(state, "p1");
        };
        const first = run();
        expect([...first].sort()).toEqual(["h1", "h2", "h3", "h4"]);
        expect(run()).toEqual(first);
    });
});
