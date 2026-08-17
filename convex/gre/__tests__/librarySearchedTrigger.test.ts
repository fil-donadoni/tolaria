// Library-search meta-trigger foundation (CR 603.2 / 701.19a, issue #788 —
// the residual "whenever an opponent searches their library" trigger
// condition; the sibling "becomes the target of a spell/ability an opponent
// controls" (BECAME_TARGET, issue #1265) and "you create one or more
// tokens" (TOKENS_CREATED, issue #1345) variants already shipped). Proves
// the two load-bearing pieces:
//   1. `emitLibrarySearchedEvent` / `applyPendingChoiceSubmit` — a
//      `search-library` PendingChoice commit emits ONE `LIBRARY_SEARCHED`
//      pendingEvent, regardless of DSL-vs-resolve() authoring and
//      regardless of whether the search finds anything (CR 701.23a — the
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
import { pathToExile } from "../../cards/sets/con/white";
import { diabolicVision } from "../../cards/sets/ice/multicolor";
import { expressiveIteration } from "../../cards/sets/stx/multicolor";
import { grizzlyBears, forest } from "../../cards/sets/lea";
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

/** A synthetic DSL-only Jester's Cap/Lobotomy-shaped sorcery: the CASTER
 *  (`player: "controller"`) searches the OPPONENT's library
 *  (`zoneOwnerId: "opponent"`), exiles the pick, then the OPPONENT shuffles
 *  their own library. This is the cross-library search shape that exposed
 *  the bug (issue #788 post-review): the searcher and the library owner are
 *  DIFFERENT players, unlike every other tutor/fetchland in this file where
 *  they're the same. */
function registerCrossLibraryTutor(id: string): string {
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
                zoneOwnerId: "opponent",
                count: { min: 0, max: 1 },
                prompt: "Search the opponent's library for a card.",
                bind: "$picked",
            },
            {
                op: "moveZone",
                cards: { ref: "$picked" },
                player: "opponent",
                from: "library",
                to: "exile",
            },
            { op: "libraryLook", action: "shuffle", player: "opponent" },
        ],
    } satisfies CardDefinition);
    return id;
}

const TUTOR_CROSS_LIBRARY_ID = registerCrossLibraryTutor(
    "test-library-searched-tutor-cross"
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
        emitLibrarySearchedEvent(state, "p1", "p1");
        expect(state.pendingEvents).toEqual([
            { type: "LIBRARY_SEARCHED", playerId: "p1", libraryOwnerId: "p1" },
        ]);
    });

    it("distinguishes searcher from library owner (Jester's Cap shape, bugfix issue #788)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        emitLibrarySearchedEvent(state, "p1", "p2");
        expect(state.pendingEvents).toEqual([
            { type: "LIBRARY_SEARCHED", playerId: "p1", libraryOwnerId: "p2" },
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

    it("fires on a 0-pick 'whiff' search (CR 701.23a — the act of searching is what matters, not the result)", () => {
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

    // Bugfix regression (issue #788 post-review): a Jester's Cap / Jester's
    // Mask / Lobotomy-shaped search has the CASTER search a DIFFERENT
    // player's library ("search TARGET PLAYER's library"). That is NOT "an
    // opponent searches their [own] library" for CR 701.23a purposes, so it
    // must never satisfy ANY `librarySearchedTrigger` scope — the exact bug
    // this test locks down: p1 casting a cross-library tutor at p2 used to
    // fire p1's OWN "opponents"-scope watcher (a free trigger off a search
    // that never touched p1's own library). Watchers of BOTH scopes on BOTH
    // players' battlefields must all stay silent — "for either player".
    it("does NOT fire for ANY scope/controller when the caster searches an OPPONENT's library (Jester's Cap/Lobotomy shape)", () => {
        const watcherYouP1 = makeInstance(WATCHER_YOU_ID, {
            id: "watcher-cross-you-p1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const watcherOppP1 = makeInstance(WATCHER_OPPONENTS_ID, {
            id: "watcher-cross-opp-p1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const watcherYouP2 = makeInstance(WATCHER_YOU_ID, {
            id: "watcher-cross-you-p2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const watcherOppP2 = makeInstance(WATCHER_OPPONENTS_ID, {
            id: "watcher-cross-opp-p2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [watcherYouP1, watcherOppP1],
                    life: 20,
                }),
                makePlayer("p2", {
                    battlefield: [watcherYouP2, watcherOppP2],
                    library: libraryOf("p2", ["lib-cross-1"]),
                    life: 20,
                }),
            ],
        });

        // p1 casts the cross-library tutor: p1 is the SEARCHER
        // (`playerId`), p2 (p1's opponent, resolved via `zoneOwnerId:
        // "opponent"`) is the LIBRARY OWNER.
        castTutorAndSearch(state, TUTOR_CROSS_LIBRARY_ID, "p1", [
            "lib-cross-1",
        ]);

        expect(
            state.stack.some((s) =>
                [
                    "test-library-searched-you",
                    "test-library-searched-opponents",
                ].includes(s.triggeredAbilityId ?? "")
            )
        ).toBe(false);
    });

    // Must-fire regression (re-review finding, issue #788): Path to
    // Exile/Erode-shaped effects have the CASTER (stack item controller)
    // make the TARGET's controller search THEIR OWN library — searcher and
    // library owner are the SAME player, but that player is DIFFERENT from
    // the stack item's `controllerId`. A prior fixup derived the searcher
    // from `stackItem.controllerId` instead of the choice's own `playerId`
    // (`head.actingPlayerId ?? head.playerId`); that reads p1 (the caster)
    // as the searcher and p2 (`zoneOwnerId ?? playerId` = p2) as the library
    // owner — DIFFERENT people — so `librarySearchedTrigger`'s equality gate
    // wrongly suppressed every watcher. This drives the REAL `pathToExile`
    // card (not a synthetic tutor) through `resolveTopOfStack` +
    // `applyPendingChoiceSubmit` end-to-end and asserts it correctly fires:
    // this test FAILS against the `stackItem.controllerId`-derived searcher.
    it("fires for Path to Exile (caster makes the TARGET's controller search their OWN library, searcher == library owner != stack-item controller)", () => {
        const watcherYou = makeInstance(WATCHER_YOU_ID, {
            id: "watcher-path-you",
            controllerId: "p2",
            ownerId: "p2",
        });
        const watcherOpponents = makeInstance(WATCHER_OPPONENTS_ID, {
            id: "watcher-path-opponents",
            controllerId: "p1",
            ownerId: "p1",
        });
        const victim = makeInstance(grizzlyBears.id, {
            id: "path-victim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [watcherOpponents], life: 20 }),
                makePlayer("p2", {
                    battlefield: [victim, watcherYou],
                    library: [
                        makeInstance(forest.id, {
                            id: "path-lib1",
                            controllerId: "p2",
                            ownerId: "p2",
                            zone: "library",
                        }),
                    ],
                    life: 20,
                }),
            ],
        });

        // p1 casts Path to Exile targeting p2's creature. The stack item's
        // controller is p1, but the `search-library` choice prompts p2 (the
        // exiled creature's controller) to search p2's OWN library.
        pushSpell(state, pathToExile.id, "p1", [
            { type: "permanent", id: "path-victim" },
        ]);
        expect(resolveTopOfStack(state)).toBeNull(); // suspends on the search
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("search-library");
        expect(head.playerId).toBe("p2");
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["path-lib1"],
        });

        // p2 (the searcher AND library owner) triggers p2's OWN "you"-scope
        // watcher, and p1's "opponents"-scope watcher (p2 is p1's opponent).
        expect(
            state.stack.some(
                (s) => s.triggeredAbilityId === "test-library-searched-you"
            )
        ).toBe(true);
        expect(
            state.stack.some(
                (s) =>
                    s.triggeredAbilityId === "test-library-searched-opponents"
            )
        ).toBe(true);
    });
});

// Bugfix regression (issue #788 PR #1987 re-review finding 1): `search-library`
// is an OVERLOADED PendingChoice kind. Expressive Iteration (stx/multicolor.ts)
// and Diabolic Vision (ice/multicolor.ts) both reuse it for a "look at the top
// N, pick one" prompt — NOT a CR 701.23a search, which requires looking at the
// WHOLE zone. Before the `isSearch` discriminator, `applyPendingChoiceSubmit`
// gated the `LIBRARY_SEARCHED` emit on `kind === "search-library"` alone, so
// casting either card fired a false event — a `librarySearchedTrigger` watcher
// (Wan Shi Tong, Librarian shape) would wrongly trigger off a card that never
// searched anything. These tests drive the REAL cards through
// `resolveTopOfStack` + `applyPendingChoiceSubmit` end-to-end and fail against
// the pre-fix `kind`-only gate.
describe("search-library overload does NOT fire LIBRARY_SEARCHED for a look-pick prompt (issue #788, PR #1987 finding 1)", () => {
    it("Diabolic Vision (look at top 5, keep 1) does not fire a librarySearchedTrigger watcher", () => {
        const watcherYou = makeInstance(WATCHER_YOU_ID, {
            id: "watcher-diabolic-you",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [watcherYou],
                    library: libraryOf("p1", [
                        "dv1",
                        "dv2",
                        "dv3",
                        "dv4",
                        "dv5",
                    ]),
                    life: 20,
                }),
                makePlayer("p2"),
            ],
        });

        pushSpell(state, diabolicVision.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspends on the keep pick
        const keepHead = state.pendingChoices![0];
        expect(keepHead.kind).toBe("search-library");
        applyPendingChoiceSubmit(state, {
            playerId: keepHead.playerId,
            stackItemId: keepHead.stackItemId,
            step: keepHead.step,
            choiceId: keepHead.choiceId,
            cardInstanceIds: ["dv1"],
        });

        // Resolve() re-runs and raises the second (reorder-library) choice —
        // finish it so the card fully resolves.
        const reorderHead = state.pendingChoices?.[0];
        expect(reorderHead?.kind).toBe("reorder-library");
        if (reorderHead) {
            applyPendingChoiceSubmit(state, {
                playerId: reorderHead.playerId,
                stackItemId: reorderHead.stackItemId,
                step: reorderHead.step,
                choiceId: reorderHead.choiceId,
                cardInstanceIds: ["dv2", "dv3", "dv4", "dv5"],
            });
        }

        expect(getPlayer(state, "p1").life).toBe(20); // watcher never fired
        expect(
            state.stack.some(
                (s) => s.triggeredAbilityId === "test-library-searched-you"
            )
        ).toBe(false);
    });

    it("Expressive Iteration (look at top 3, hand/bottom/exile) does not fire a librarySearchedTrigger watcher", () => {
        const watcherYou = makeInstance(WATCHER_YOU_ID, {
            id: "watcher-expressive-you",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [watcherYou],
                    library: libraryOf("p1", ["ei1", "ei2", "ei3"]),
                    life: 20,
                }),
                makePlayer("p2"),
            ],
        });

        pushSpell(state, expressiveIteration.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspends on the hand pick
        const handHead = state.pendingChoices![0];
        expect(handHead.kind).toBe("search-library");
        applyPendingChoiceSubmit(state, {
            playerId: handHead.playerId,
            stackItemId: handHead.stackItemId,
            step: handHead.step,
            choiceId: handHead.choiceId,
            cardInstanceIds: ["ei1"],
        });

        // Two cards remain (ei2, ei3) — resolve() re-runs and raises the
        // bottom pick, also `kind: "search-library"`.
        const bottomHead = state.pendingChoices?.[0];
        expect(bottomHead?.kind).toBe("search-library");
        if (bottomHead) {
            applyPendingChoiceSubmit(state, {
                playerId: bottomHead.playerId,
                stackItemId: bottomHead.stackItemId,
                step: bottomHead.step,
                choiceId: bottomHead.choiceId,
                cardInstanceIds: ["ei2"],
            });
        }

        expect(getPlayer(state, "p1").life).toBe(20); // watcher never fired
        expect(
            state.stack.some(
                (s) => s.triggeredAbilityId === "test-library-searched-you"
            )
        ).toBe(false);
    });
});
