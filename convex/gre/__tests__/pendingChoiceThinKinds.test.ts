// Characterisation of the THIN Pending Choice kinds through the real submit
// ladder (issue #4476, PRD #4474 T1). Each kind below had at most one test
// that answered it through `applyPendingChoiceSubmit` — Balance's
// `keep-permanents` / `keep-hand` had none (its tests wrote the answer into
// the stack item by hand), `choose-player` had none. The Pending Choice
// handler registry (issue #4443) replaces the ladder these tests drive, so
// every test here raises the choice through production code, answers it
// through the public submit seam and asserts the resulting STATE — never the
// branch that got it there — so the same tests stay green across the refactor
// and go red on a kind the registry drops.
import { describe, it, expect } from "vitest";
import {
    putReanimatedSetOnBattlefield,
    resolveTopOfStack,
    type GameState,
} from "../state";
import { advancePhase } from "../phases";
import { checkStateBasedActions } from "../sba";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    balance,
    grizzlyBears,
    plains,
    unholyStrength,
} from "../../cards/sets/lea";
import { aladdinsLamp } from "../../cards/sets/arn";
import { jasmineBoreal } from "../../cards/sets/leg";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";

/** Answers the queue head through the REAL submit seam — the one
 *  `submitResolutionChoice` and the bot driver take — echoing the head's own
 *  identity so only the picks are the test's input. */
function submitHead(state: GameState, ids: string[]): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: ids,
    });
}

function ids(cards: { id: string }[]): string[] {
    return cards.map((c) => c.id);
}

describe("keep-permanents (Balance, CR 608.2d — a keep chosen while resolving)", () => {
    it("keeps the picked lands, sacrifices the rest, and resolves Balance", () => {
        const land = (id: string, owner: string) =>
            makeInstance(plains.id, {
                id,
                controllerId: owner,
                ownerId: owner,
            });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: ["a", "b", "c", "d"].map((x) =>
                        land(`p1-${x}`, "p1")
                    ),
                }),
                makePlayer("p2", {
                    battlefield: [land("p2-a", "p2"), land("p2-b", "p2")],
                }),
            ],
        });
        pushSpell(state, balance.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull();
        expect(state.pendingChoices?.[0]).toMatchObject({
            kind: "keep-permanents",
            playerId: "p1",
            count: 2,
        });

        submitHead(state, ["p1-b", "p1-d"]);

        expect(state.pendingChoices).toBeUndefined();
        expect(state.stack).toHaveLength(0);
        expect(ids(state.players[0].battlefield)).toEqual(["p1-b", "p1-d"]);
        expect(ids(state.players[0].graveyard)).toEqual(
            expect.arrayContaining(["p1-a", "p1-c"])
        );
        expect(ids(state.players[1].battlefield)).toEqual(["p2-a", "p2-b"]);
    });

    it("rejects a pick that does not match the step's filter (a creature at the land step)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(plains.id, {
                            id: "l1",
                            controllerId: "p1",
                        }),
                        makeInstance(plains.id, {
                            id: "l2",
                            controllerId: "p1",
                        }),
                        makeInstance(grizzlyBears.id, {
                            id: "bear",
                            controllerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(plains.id, {
                            id: "p2-l",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                        makeInstance(grizzlyBears.id, {
                            id: "p2-bear",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
        pushSpell(state, balance.id, "p1");
        resolveTopOfStack(state);
        expect(state.pendingChoices?.[0].kind).toBe("keep-permanents");

        expect(() => submitHead(state, ["bear"])).toThrow(
            "Card does not match the required filter"
        );
        // Nothing moved: the choice is still owed.
        expect(state.pendingChoices?.[0].kind).toBe("keep-permanents");
        expect(state.players[0].battlefield).toHaveLength(3);
    });
});

describe("keep-hand (Balance, CR 608.2d — a keep chosen while resolving)", () => {
    it("keeps the picked card, discards the rest, and resolves Balance", () => {
        const card = (id: string, owner: string) =>
            makeInstance(grizzlyBears.id, {
                id,
                controllerId: owner,
                ownerId: owner,
                zone: "hand",
            });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        card("h0", "p1"),
                        card("h1", "p1"),
                        card("h2", "p1"),
                    ],
                }),
                makePlayer("p2", { hand: [card("p2-h0", "p2")] }),
            ],
        });
        pushSpell(state, balance.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull();
        expect(state.pendingChoices?.[0]).toMatchObject({
            kind: "keep-hand",
            zone: "hand",
            count: 1,
        });

        submitHead(state, ["h1"]);

        expect(state.pendingChoices).toBeUndefined();
        expect(state.stack).toHaveLength(0);
        expect(ids(state.players[0].hand)).toEqual(["h1"]);
        expect(ids(state.players[0].graveyard)).toEqual(
            expect.arrayContaining(["h0", "h2"])
        );
        expect(ids(state.players[1].hand)).toEqual(["p2-h0"]);
    });

    it("rejects a card that is not in the chooser's hand", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: ["h0", "h1"].map((id) =>
                        makeInstance(grizzlyBears.id, {
                            id,
                            controllerId: "p1",
                            zone: "hand",
                        })
                    ),
                }),
                makePlayer("p2", {
                    hand: [
                        makeInstance(grizzlyBears.id, {
                            id: "p2-h0",
                            controllerId: "p2",
                            ownerId: "p2",
                            zone: "hand",
                        }),
                    ],
                }),
            ],
        });
        pushSpell(state, balance.id, "p1");
        resolveTopOfStack(state);
        expect(state.pendingChoices?.[0].kind).toBe("keep-hand");

        expect(() => submitHead(state, ["p2-h0"])).toThrow("Card not in hand");
        expect(state.players[0].hand).toHaveLength(2);
    });
});

// `choose-player` has no producer in the catalogue today (Endurance moved to a
// CR 603.3d announcement-time target, issue #1193), but the ladder still owns
// a dedicated branch for it and `SpellContext.requestChoice` still accepts it,
// so the registry must port it. This minimal `resolve()` fixture raises it
// the way any protocol card would.
const CHOOSE_PLAYER_FIXTURE: CardDefinition = {
    id: "test-only-choose-player-drain",
    rarity: "common",
    name: "Test Choose-Player Drain",
    oracleText: "Choose up to one player. That player loses 3 life.",
    manaCost: { B: 1 },
    types: ["Sorcery"],
    resolve: (ctx) => {
        const picked = ctx.requestChoice({
            playerId: ctx.controller,
            choiceId: "drain",
            kind: "choose-player",
            zone: "battlefield",
            count: { min: 0, max: 1 },
            candidatePlayerIds: ["p1", "p2"],
            prompt: "Choose up to one player",
        });
        if (picked === undefined) return;
        for (const p of picked) ctx.loseLife(p, 3);
    },
};

describe("choose-player (CR 608.2d — a player chosen while resolving, not a target)", () => {
    function raise(): GameState {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, CHOOSE_PLAYER_FIXTURE.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull();
        expect(state.pendingChoices?.[0]).toMatchObject({
            kind: "choose-player",
            playerId: "p1",
            candidatePlayerIds: ["p1", "p2"],
        });
        return state;
    }

    it("a player pick resumes resolution and applies the effect to that player", () => {
        withTemporaryDefinition(CHOOSE_PLAYER_FIXTURE, () => {
            const state = raise();
            submitHead(state, ["p2"]);
            expect(state.pendingChoices).toBeUndefined();
            expect(state.stack).toHaveLength(0);
            expect(state.players[1].life).toBe(17);
            expect(state.players[0].life).toBe(20);
            expect(state.priorityPlayerId).toBe(state.activePlayerId);
        });
    });

    it("an empty submission is legal for `up to one` and applies nothing", () => {
        withTemporaryDefinition(CHOOSE_PLAYER_FIXTURE, () => {
            const state = raise();
            submitHead(state, []);
            expect(state.pendingChoices).toBeUndefined();
            expect(state.stack).toHaveLength(0);
            expect(state.players.map((p) => p.life)).toEqual([20, 20]);
        });
    });

    it("rejects an id that is not one of the candidate players", () => {
        withTemporaryDefinition(CHOOSE_PLAYER_FIXTURE, () => {
            const state = raise();
            expect(() => submitHead(state, ["p3"])).toThrow(
                "Not a legal player"
            );
            expect(state.pendingChoices?.[0].kind).toBe("choose-player");
        });
    });
});

describe("draw-look-keep (Aladdin's Lamp, CR 614 draw replacement)", () => {
    function raise(x: number): GameState {
        const lamp = makeInstance(aladdinsLamp.id, { id: "lamp" });
        const lib = ["c0", "c1", "c2", "c3"].map((id) =>
            makeInstance(grizzlyBears.id, {
                id,
                controllerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            turn: 2,
            phase: "UPKEEP",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [lamp], library: lib }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...lamp,
            zone: "stack",
            castById: "p1",
            abilityId: "aladdins-lamp-look",
            chosenX: x,
            targets: [],
        });
        resolveTopOfStack(state);
        advancePhase(state); // UPKEEP → DRAW: the replacement suspends
        expect(state.pendingChoices?.[0]).toMatchObject({
            kind: "draw-look-keep",
            stackItemId: "",
        });
        return state;
    }

    it("keeping the TOP card draws it and bottoms the other looked-at card", () => {
        const state = raise(2);
        expect(state.pendingChoices![0].candidateIds).toEqual(["c0", "c1"]);

        submitHead(state, ["c0"]);

        expect(state.pendingChoices).toBeUndefined();
        expect(ids(state.players[0].hand)).toEqual(["c0"]);
        expect(ids(state.players[0].library)).toEqual(["c2", "c3", "c1"]);
    });

    it("rejects a library card below the looked-at window", () => {
        const state = raise(2);
        expect(() => submitHead(state, ["c3"])).toThrow(
            "Card is not an eligible choice"
        );
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.pendingChoices?.[0].kind).toBe("draw-look-keep");
    });
});

describe("legend-keep (CR 704.5j — raised by a resolving legend)", () => {
    it("the newly resolved duplicate may be the one kept", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(jasmineBoreal.id, {
                            id: "old-jasmine",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const spell = pushSpell(state, jasmineBoreal.id, "p1");
        resolveTopOfStack(state);
        checkStateBasedActions(state);
        expect(state.pendingChoices?.[0]).toMatchObject({
            kind: "legend-keep",
            stackItemId: "",
            playerId: "p1",
        });
        expect(state.pendingChoices![0].candidateIds).toEqual(
            expect.arrayContaining(["old-jasmine", spell.id])
        );

        submitHead(state, [spell.id]);

        expect(state.pendingChoices).toBeUndefined();
        expect(ids(state.players[0].battlefield)).toEqual([spell.id]);
        expect(ids(state.players[0].graveyard)).toEqual(["old-jasmine"]);
    });
});

describe("choose-aura-host (CR 303.4f — Aura entering without being cast)", () => {
    it("an empty submission is refused (count 1), then a legal host attaches the Aura", () => {
        const bear = (id: string) =>
            makeInstance(grizzlyBears.id, {
                id,
                controllerId: "p1",
                ownerId: "p1",
            });
        const aura = makeInstance(unholyStrength.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [bear("bear-1"), bear("bear-2")],
                    graveyard: [aura],
                }),
                makePlayer("p2"),
            ],
        });
        state.players[0].graveyard.splice(0, 1);
        putReanimatedSetOnBattlefield(state, [
            { card: aura, controllerId: "p1" },
        ]);
        expect(state.pendingChoices?.[0]).toMatchObject({
            kind: "choose-aura-host",
            stackItemId: "",
        });

        expect(() => submitHead(state, [])).toThrow("Select at least 1 card");
        expect(state.pendingChoices?.[0].kind).toBe("choose-aura-host");

        submitHead(state, ["bear-2"]);

        expect(state.pendingChoices ?? []).toHaveLength(0);
        const entered = state.players[0].battlefield.find(
            (c) => c.id === "aura"
        );
        expect(entered?.attachedTo).toBe("bear-2");
    });
});
