// "Target card in your graveyard that was put there from anywhere this turn"
// (issue #7209, CR 400.7): one per-card stamp, written on every path into a
// graveyard, read by the `putIntoGraveyardThisTurn` target filter.
import { beforeAll, describe, expect, it } from "vitest";
import { registerTokenDefinition } from "../../cards";
import { withTemporaryDefinition } from "../../cards/registry";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { wormsOfTheEarth } from "../../cards/sets/drk/black.cards";
import { grizzlyBears } from "../../cards/sets/lea/green.cards";
import type {
    CardDefinition,
    SpellContext,
    TargetRequirement,
} from "../../cards/types";
import { applyOneTargetSelection } from "../../game";
import { advancePhase } from "../phases";
import { applyPlayLand } from "../playLand";
import {
    getLegalTargets,
    NO_TARGETING_SOURCE,
    pendingTargetFiltersFromRequirement,
} from "../rules";
import { compactState, expandState } from "../serialize";
import {
    buildSpellContext,
    discardToGraveyard,
    moveCard,
    putReanimatedSetOnBattlefield,
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../state";

const SORCERY_ID = "test-put-into-graveyard-sorcery";
const LAND_ID = "test-put-into-graveyard-land";

const REQUIREMENT: TargetRequirement = {
    type: "card",
    count: 1,
    zone: "graveyard",
    controller: "you",
    putIntoGraveyardThisTurn: true,
};

beforeAll(() => {
    const sorcery: CardDefinition = {
        id: SORCERY_ID,
        name: "Test Stamp Sorcery",
        rarity: "common",
        types: ["Sorcery"],
    };
    const land: CardDefinition = {
        id: LAND_ID,
        name: "Test Stamp Land",
        rarity: "common",
        types: ["Land"],
    };
    registerTokenDefinition(sorcery);
    registerTokenDefinition(land);
});

function bear(
    id: string,
    zone: CardInstanceState["zone"],
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return makeInstance(grizzlyBears().id, { id, zone, ...overrides });
}

function offeredIds(state: GameState): string[] {
    return getLegalTargets(state, REQUIREMENT, NO_TARGETING_SOURCE, "p1").map(
        (t) => t.id
    );
}

function contextOf(state: GameState): SpellContext {
    return buildSpellContext(
        state,
        makeInstance(SORCERY_ID, { zone: "stack" }) as StackItem
    );
}

/** Drives the real turn structure to the next turn's first step. */
function advanceToNextTurn(state: GameState): void {
    const turn = state.turn;
    for (let i = 0; i < 40 && state.turn === turn; i++) advancePhase(state);
    expect(state.turn).toBe(turn + 1);
}

describe("CR 400.7 — every path into a graveyard stamps the card (issue #7209)", () => {
    it("a card that was already there at the start of the turn is not offered", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [bear("old", "graveyard")] }),
                makePlayer("p2"),
            ],
        });
        expect(offeredIds(state)).toEqual([]);
    });

    it("from the hand: a discard", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [bear("c", "hand")] }),
                makePlayer("p2"),
            ],
        });
        discardToGraveyard(state, "p1", "c", { kind: "cost" });
        expect(offeredIds(state)).toEqual(["c"]);
    });

    it("from the library: a mill", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: [bear("c", "library")] }),
                makePlayer("p2"),
            ],
        });
        contextOf(state).millCards("p1", 1);
        expect(offeredIds(state)).toEqual(["c"]);
    });

    it("from the library: the general zone mover", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: [bear("c", "library")] }),
                makePlayer("p2"),
            ],
        });
        moveCard(state.players[0], "c", "library", "graveyard");
        expect(offeredIds(state)).toEqual(["c"]);
    });

    it("from the battlefield: a permanent leaving", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear("c", "battlefield")] }),
                makePlayer("p2"),
            ],
        });
        removePermanentTo(state, "c", "graveyard");
        expect(offeredIds(state)).toEqual(["c"]);
    });

    it("from the stack: a spell finishing its resolution", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, SORCERY_ID, "p1");
        resolveTopOfStack(state);
        expect(offeredIds(state)).toEqual([item.id]);
    });

    it("a land Worms of the Earth bars from entering lands in the graveyard", () => {
        const land = makeInstance(LAND_ID, { id: "c", zone: "library" });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(wormsOfTheEarth().id, { id: "worms" }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        putReanimatedSetOnBattlefield(state, [
            { card: land, controllerId: "p1" },
        ]);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["c"]);
        expect(offeredIds(state)).toEqual(["c"]);
    });
});

describe("an entry that never happened (issue #7209)", () => {
    const HEART: CardDefinition = {
        id: "test-put-into-graveyard-heart",
        name: "Test Stamp Heart",
        rarity: "common",
        types: ["Land"],
        entersWith: {
            asEnters: [
                {
                    kind: "sacrifice",
                    filter: { subtypes: "Forest" },
                    ifDeclined: "graveyard",
                },
            ],
        },
    };

    it("a land played from the hand and abandoned has arrived", () => {
        withTemporaryDefinition(HEART, () => {
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        hand: [
                            makeInstance(HEART.id, { id: "c", zone: "hand" }),
                        ],
                    }),
                    makePlayer("p2"),
                ],
            });
            applyPlayLand(state, state.players[0], "c");
            expect(state.players[0].graveyard.map((x) => x.id)).toEqual(["c"]);
            expect(offeredIds(state)).toEqual(["c"]);
        });
    });

    it("a card lifted out of the graveyard and abandoned has not", () => {
        withTemporaryDefinition(HEART, () => {
            const state = makeState({
                players: [makePlayer("p1"), makePlayer("p2")],
            });
            putReanimatedSetOnBattlefield(state, [
                {
                    card: makeInstance(HEART.id, {
                        id: "c",
                        zone: "graveyard",
                    }),
                    controllerId: "p1",
                },
            ]);
            expect(state.players[0].graveyard.map((x) => x.id)).toEqual(["c"]);
            expect(offeredIds(state)).toEqual([]);
        });
    });

    it("a land Worms of the Earth holds in the graveyard has not", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(wormsOfTheEarth().id, { id: "worms" }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        putReanimatedSetOnBattlefield(state, [
            {
                card: makeInstance(LAND_ID, { id: "c", zone: "graveyard" }),
                controllerId: "p1",
            },
        ]);
        expect(state.players[0].graveyard.map((x) => x.id)).toEqual(["c"]);
        expect(offeredIds(state)).toEqual([]);
    });
});

describe("CR 400.7 — the stamp names one graveyard object (issue #7209)", () => {
    it("leaving the graveyard ends it, and a later return earns a new one", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [bear("c", "hand")] }),
                makePlayer("p2"),
            ],
        });
        const player = state.players[0];
        discardToGraveyard(state, "p1", "c", { kind: "cost" });
        const moved = moveCard(player, "c", "graveyard", "hand");
        expect(moved.putIntoGraveyardThisTurn).toBeUndefined();
        moveCard(player, "c", "hand", "graveyard");
        expect(offeredIds(state)).toEqual(["c"]);
    });

    it("the whole-graveyard sweep ends it", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [bear("c", "hand")] }),
                makePlayer("p2"),
            ],
        });
        discardToGraveyard(state, "p1", "c", { kind: "cost" });
        contextOf(state).putGraveyardOnBottomOfLibrary("p1");
        expect(state.players[0].library[0].putIntoGraveyardThisTurn).toBe(
            undefined
        );
    });

    it("the next turn ends it, and a card stamped then is the only one offered", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [bear("c", "hand")],
                    battlefield: [bear("later", "battlefield")],
                }),
                makePlayer("p2"),
            ],
        });
        discardToGraveyard(state, "p1", "c", { kind: "cost" });
        expect(offeredIds(state)).toEqual(["c"]);
        advanceToNextTurn(state);
        expect(offeredIds(state)).toEqual([]);
        removePermanentTo(state, "later", "graveyard");
        expect(offeredIds(state)).toEqual(["later"]);
    });

    it("survives the persistence round trip", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [bear("c", "hand")] }),
                makePlayer("p2"),
            ],
        });
        discardToGraveyard(state, "p1", "c", { kind: "cost" });
        expect(offeredIds(expandState(compactState(state)))).toEqual(["c"]);
    });
});

describe("offered set == accepted set (ADR 0068, issue #7209)", () => {
    function pendingBoard(): GameState {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [bear("fresh", "hand")],
                    graveyard: [bear("old", "graveyard")],
                }),
                makePlayer("p2"),
            ],
        });
        discardToGraveyard(state, "p1", "fresh", { kind: "cost" });
        state.pendingTarget = {
            playerId: "p1",
            cardInstanceId: "src",
            targetType: "card",
            // Two slots, so the accepted pick stays readable instead of
            // finalizing a cast this board has no source for.
            count: 2,
            selected: [],
            ...pendingTargetFiltersFromRequirement(REQUIREMENT, undefined),
        };
        return state;
    }

    it("selectTarget refuses an old card in the same graveyard", () => {
        expect(() =>
            applyOneTargetSelection(pendingBoard(), "p1", {
                targetType: "graveyard-card",
                targetId: "old",
                targetPlayerId: "p1",
            })
        ).toThrow("Must target a card put into a graveyard this turn");
    });

    it("selectTarget accepts the stamped card", () => {
        const state = pendingBoard();
        applyOneTargetSelection(state, "p1", {
            targetType: "graveyard-card",
            targetId: "fresh",
            targetPlayerId: "p1",
        });
        expect(state.pendingTarget?.selected.map((t) => t.id)).toEqual([
            "fresh",
        ]);
    });
});
