// Library-search meta-trigger foundation (CR 603.2 / 701.19a, issue #788 —
// the residual "whenever an opponent searches their library" trigger
// condition; the sibling "becomes the target of a spell/ability an opponent
// controls" (BECAME_TARGET, issue #1265) and "you create one or more
// tokens" (TOKENS_CREATED, issue #1345) variants already shipped). Proves
// the two load-bearing pieces:
//   1. `emitLibrarySearchedEvent` / `applyPendingChoiceSubmit` — a
//      `search-library` PendingChoice commit emits ONE `LIBRARY_SEARCHED`
//      pendingEvent, regardless of DSL-vs-resolve() authoring and
//      regardless of whether the search finds anything (CR 701.19a — the
//      ACT of searching is what matters, not the result).
//   2. `librarySearchedTrigger` — the declarative factory building a
//      TriggeredAbility off that event — fires end-to-end through the
//      engine's normal trigger-collection pass, honoring `scope`.

import { describe, it, expect } from "vitest";
import {
    resolveTopOfStack,
    getPlayer,
    emitLibrarySearchedEvent,
    type GameState,
} from "../state";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { registerTokenDefinition } from "../../cards";
import { librarySearchedTrigger } from "../../cards/abilities/triggers/librarySearchedTrigger";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import type { CardDefinition } from "../../cards/types";

const WATCHER_YOU_ID = "test-library-searched-watcher-you";
const WATCHER_OPPONENTS_ID = "test-library-searched-watcher-opponents";

// Fires whenever ITS OWN CONTROLLER searches a library (scope: "you"),
// gaining 1 life per occurrence — an easily-observed side effect proving the
// trigger actually resolved, not just matched.
registerTokenDefinition({
    id: WATCHER_YOU_ID,
    name: "Test Library Watcher (you)",
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Test"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        librarySearchedTrigger({
            id: "test-library-searched-you",
            oracleText: "Whenever you search your library, gain 1 life.",
            scope: "you",
            resolve: (ctx, _event, info) => {
                ctx.gainLife(info.playerId, 1);
            },
        }),
    ],
} satisfies CardDefinition);

// Fires whenever an OPPONENT searches a library (scope: "opponents") — the
// Wan Shi Tong, Librarian shape.
registerTokenDefinition({
    id: WATCHER_OPPONENTS_ID,
    name: "Test Library Watcher (opponents)",
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Test"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        librarySearchedTrigger({
            id: "test-library-searched-opponents",
            oracleText:
                "Whenever an opponent searches their library, gain 1 life.",
            scope: "opponents",
            resolve: (ctx) => {
                // `ctx.controller` is the WATCHER's controller (a triggered
                // ability always belongs to its source), not the searching
                // player — gain life for the watcher's own controller.
                ctx.gainLife(ctx.controller, 1);
            },
        }),
    ],
} satisfies CardDefinition);

/** A synthetic DSL-only tutor sorcery: search the library for a card (any
 *  filter), move it to `to`, then shuffle. Mirrors the shipped Vampiric
 *  Tutor / fetchland shapes exactly (`sets/vis/black.ts`,
 *  `sets/zen/colorless.ts`) — the same `choice(kind: "search-library")` +
 *  `moveZone` + `libraryLook` composition every real tutor/fetchland uses,
 *  so this test exercises the EXACT choke point real cards commit through. */
function registerTutor(
    id: string,
    to: "hand" | "battlefield",
    filter?: { type: "Land" }
): string {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { G: 1 },
        types: ["Sorcery"],
        effects: [
            {
                op: "choice",
                kind: "search-library",
                player: "controller",
                zone: "library",
                ...(filter ? { filter } : {}),
                count: { min: 0, max: 1 },
                prompt: "Search your library for a card.",
                bind: "$picked",
            },
            {
                op: "moveZone",
                cards: { ref: "$picked" },
                player: "controller",
                from: "library",
                to,
            },
            { op: "libraryLook", action: "shuffle", player: "controller" },
        ],
    } satisfies CardDefinition);
    return id;
}

const TUTOR_TO_HAND_ID = registerTutor(
    "test-library-searched-tutor-hand",
    "hand"
);
const TUTOR_TO_BATTLEFIELD_ID = registerTutor(
    "test-library-searched-tutor-fetch",
    "battlefield",
    { type: "Land" }
);

const LAND_ID = "test-library-searched-land";
registerTokenDefinition({
    id: LAND_ID,
    name: LAND_ID,
    rarity: "common",
    types: ["Land"],
});

const BEAR_ID = "test-library-searched-bear";
registerTokenDefinition({
    id: BEAR_ID,
    name: BEAR_ID,
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
});

function libraryOf(owner: string, ids: string[], cardId = BEAR_ID) {
    return ids.map((id) =>
        makeInstance(cardId, {
            id,
            controllerId: owner,
            ownerId: owner,
            zone: "library",
        })
    );
}

/** Casts and resolves `tutorId` for `casterId`, submitting the resulting
 *  `search-library` PendingChoice with `pick` (empty array = a 0-pick
 *  whiff). Asserts the search actually suspended (real test-harness
 *  sanity), then commits. */
function castTutorAndSearch(
    state: GameState,
    tutorId: string,
    casterId: string,
    pick: string[]
): void {
    pushSpell(state, tutorId, casterId);
    expect(resolveTopOfStack(state)).toBeNull(); // suspended on the search
    const head = state.pendingChoices![0];
    expect(head.kind).toBe("search-library");
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: pick,
    });
}

describe("emitLibrarySearchedEvent (CR 701.19a, issue #788)", () => {
    it("queues a LIBRARY_SEARCHED pendingEvent naming the searching player", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        emitLibrarySearchedEvent(state, "p1");
        expect(state.pendingEvents).toEqual([
            { type: "LIBRARY_SEARCHED", playerId: "p1" },
        ]);
    });
});

describe("librarySearchedTrigger fires end-to-end (issue #788)", () => {
    it("scope: you fires when the watcher's OWN controller searches their library", () => {
        const watcher = makeInstance(WATCHER_YOU_ID, {
            id: "watcher-you-1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [watcher],
                    library: libraryOf("p1", ["lib1", "lib2"]),
                    life: 20,
                }),
                makePlayer("p2"),
            ],
        });
        castTutorAndSearch(state, TUTOR_TO_HAND_ID, "p1", ["lib1"]);

        const stackTriggers = state.stack.filter(
            (s) => s.triggeredAbilityId === "test-library-searched-you"
        );
        expect(stackTriggers).toHaveLength(1);
        resolveTopOfStack(state);
        expect(getPlayer(state, "p1").life).toBe(21);
    });

    it("scope: you does NOT fire when an OPPONENT searches", () => {
        const watcher = makeInstance(WATCHER_YOU_ID, {
            id: "watcher-you-2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [watcher], life: 20 }),
                makePlayer("p2", {
                    library: libraryOf("p2", ["lib3", "lib4"]),
                }),
            ],
        });
        castTutorAndSearch(state, TUTOR_TO_HAND_ID, "p2", ["lib3"]);

        expect(
            state.stack.find(
                (s) => s.triggeredAbilityId === "test-library-searched-you"
            )
        ).toBeUndefined();
    });

    it("scope: opponents fires when an opponent searches, not when you do (Wan Shi Tong shape)", () => {
        const watcher = makeInstance(WATCHER_OPPONENTS_ID, {
            id: "watcher-opp-1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [watcher],
                    library: libraryOf("p1", ["lib5", "lib6"]),
                    life: 20,
                }),
                makePlayer("p2", {
                    library: libraryOf("p2", ["lib7", "lib8"]),
                    life: 20,
                }),
            ],
        });

        // p1's own search must NOT fire the "opponents" scope.
        castTutorAndSearch(state, TUTOR_TO_HAND_ID, "p1", ["lib5"]);
        expect(
            state.stack.find(
                (s) =>
                    s.triggeredAbilityId === "test-library-searched-opponents"
            )
        ).toBeUndefined();

        // p2 (the opponent of the watcher's controller) searching DOES fire.
        castTutorAndSearch(state, TUTOR_TO_HAND_ID, "p2", ["lib7"]);
        const stackTriggers = state.stack.filter(
            (s) => s.triggeredAbilityId === "test-library-searched-opponents"
        );
        expect(stackTriggers).toHaveLength(1);
        resolveTopOfStack(state);
        expect(getPlayer(state, "p1").life).toBe(21);
    });

    it("fires on a 0-pick 'whiff' search (CR 701.19a — the act of searching is what matters, not the result)", () => {
        const watcher = makeInstance(WATCHER_OPPONENTS_ID, {
            id: "watcher-opp-2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [watcher], life: 20 }),
                // p2's library has no LAND — the fetch-style tutor's filter
                // matches nothing, so the search-library choice raises with
                // ZERO eligible candidates (a fetchland whiff).
                makePlayer("p2", { library: libraryOf("p2", ["nolands1"]) }),
            ],
        });
        castTutorAndSearch(state, TUTOR_TO_BATTLEFIELD_ID, "p2", []);

        expect(
            state.stack.find(
                (s) =>
                    s.triggeredAbilityId === "test-library-searched-opponents"
            )
        ).toBeDefined();
    });

    it("fires for a fetchland-style search that moves the found card to the battlefield", () => {
        const watcher = makeInstance(WATCHER_OPPONENTS_ID, {
            id: "watcher-opp-3",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [watcher], life: 20 }),
                makePlayer("p2", {
                    library: [
                        ...libraryOf("p2", ["bear1"]),
                        ...libraryOf("p2", ["plains1"], LAND_ID),
                    ],
                }),
            ],
        });
        castTutorAndSearch(state, TUTOR_TO_BATTLEFIELD_ID, "p2", ["plains1"]);

        expect(state.players[1].battlefield.map((c) => c.id)).toContain(
            "plains1"
        );
        expect(
            state.stack.find(
                (s) =>
                    s.triggeredAbilityId === "test-library-searched-opponents"
            )
        ).toBeDefined();
    });
});
