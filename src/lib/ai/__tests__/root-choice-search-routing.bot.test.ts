// Root pending choices reach the ISMCTS search (issue #1506).
//
// The bug this locks: the whole choice-node machinery (PRD #1423) was dead in
// production for ROOT decisions. `decideBotAction` intercepted the bot's owed
// choice for EVERY kind and answered with the ADR 0016 minimal heuristics, and
// `botActionRealisation` classified all of them as `"executor"`, so the live
// driver realised them directly through mutations and never reached the Worker.
// The gate the comments promised — route a kind to the search when it has a
// registered candidate generator — existed in the engine
// (`hasChoiceCandidateGenerator`) and was imported nowhere in `src/`. The modal
// and fetch charters passed CI only because they called `searchWithTrace`
// directly; the live bot still took the first modal mode and fetched greedily.
//
// The guard is REGISTRY-DRIVEN, per the bot-driver exhaustive-dispatch
// convention: it enumerates `CHOICE_CANDIDATE_GENERATORS` and fails when a
// generator-covered kind has no fixture here, or is still heuristic-answered.
// Every assertion runs through the real reducers (`projectPublicState` →
// `buildBotView`), never a hand-built view.

import { describe, expect, it } from "vitest";
import type { GameState, PendingChoice } from "@convex/gre";
import {
    CHOICE_CANDIDATE_GENERATORS,
    choiceCandidates,
} from "@convex/gre/ai/choiceCandidates";
import type { PendingChoiceKind } from "@convex/gre";
import { projectPublicState } from "@convex/gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { getCardByName } from "@convex/cards";
import {
    decideBotAction,
    botActionRealisation,
    chooseOwedChoiceAction,
} from "../brain";
import { buildBotView, botActionToMove } from "../bot-view";
import { consultBrain } from "../brain-client";
import { projectedToGameState } from "../state-adapter";

const BOT = "u1-p2";
const HUMAN = "u1-p1";

/** A board owned by the bot, carrying `choice` as the head pending choice.
 *  A mid-resolution choice arises from a resolving stack item, so a host with
 *  the matching `stackItemId` MUST be on the stack — `applyPendingChoiceSubmit`
 *  (the resolver the search drives when it descends the choice) writes the
 *  picks into `stackItem.collectedChoices` and throws "Stack item not found"
 *  otherwise. A vanilla creature host resolves cleanly once the choice is
 *  submitted, so the playout advances past the node without a spurious error. */
function stateWithBotChoice(
    choice: Partial<PendingChoice> & Pick<PendingChoice, "kind">,
    botOverrides: Parameters<typeof makePlayer>[1] = {}
): GameState {
    const state = makeState({
        players: [makePlayer(HUMAN), makePlayer(BOT, botOverrides)],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
    });
    state.stack = [
        {
            ...makeInstance(getCardByName("Grizzly Bears").id, {
                id: "stack-1",
                controllerId: BOT,
                ownerId: BOT,
                zone: "stack",
            }),
            castById: BOT,
            targets: [],
        } as unknown as GameState["stack"][number],
    ];
    state.pendingChoices = [
        {
            stackItemId: "stack-1",
            step: 0,
            choiceId: "c1",
            playerId: BOT,
            count: 1,
            prompt: "test choice",
            ...choice,
        } as PendingChoice,
    ];
    return state;
}

/** A library of `names` owned by the bot, with a live `search-library` choice
 *  (CR 701.19) — the shape a fetchland / tutor opens. */
function stateWithBotLibrarySearch(names: string[]): GameState {
    return stateWithBotChoice(
        {
            kind: "search-library",
            zone: "library",
            prompt: "Search your library for a card.",
        },
        {
            library: names.map((name, i) =>
                makeInstance(getCardByName(name).id, {
                    id: `lib-${i}`,
                    controllerId: BOT,
                    ownerId: BOT,
                    zone: "library",
                })
            ),
        }
    );
}

/** One fixture per generator-covered choice kind. A kind added to
 *  `CHOICE_CANDIDATE_GENERATORS` with no entry here fails the sweep below —
 *  that is the point: the new kind must be proven to reach the search. */
const FIXTURES: Partial<Record<PendingChoiceKind, () => GameState>> = {
    "may-pay": () => stateWithBotChoice({ kind: "may-pay", cost: {} }),
    "land-entry-tapped": () =>
        stateWithBotChoice(
            {
                kind: "land-entry-tapped",
                cost: { life: 2 },
                landInstanceId: "land-1",
            } as Partial<PendingChoice> & Pick<PendingChoice, "kind">,
            {
                battlefield: [
                    makeInstance(getCardByName("Forest").id, {
                        id: "land-1",
                        controllerId: BOT,
                        ownerId: BOT,
                        zone: "battlefield",
                    }),
                ],
            }
        ),
    "draw-replacement": () =>
        stateWithBotChoice({ kind: "draw-replacement", cost: { life: 2 } }),
    "option-pick": () =>
        stateWithBotChoice({
            kind: "option-pick",
            options: [
                { id: "mode-a", label: "Mode A" },
                { id: "mode-b", label: "Mode B" },
            ],
        } as Partial<PendingChoice> & Pick<PendingChoice, "kind">),
    "search-library": () =>
        stateWithBotLibrarySearch(["Forest", "Craw Wurm", "Grizzly Bears"]),
    // CR 705.2 / ADR 0023 (generator added by issue #1511) — a degenerate
    // single-candidate acknowledge. The outcome is already drawn and persisted;
    // the search's only legal answer is the ack, which the driver submits.
    "random-reveal": () => stateWithBotChoice({ kind: "random-reveal" }),
    // CR 608.2b (issue #1888) — an OPTIONAL hand pick ("you may exile a card",
    // Chrome Mox's imprint). Only the `min === 0` shape is an in-tree node; the
    // mandatory shape is pinned as NOT searchable below.
    "choose-hand-card": () =>
        stateWithBotChoice(
            {
                kind: "choose-hand-card",
                zone: "hand",
                count: { min: 0, max: 1 },
                prompt: "You may exile a card from your hand.",
            },
            {
                hand: [
                    makeInstance(getCardByName("Lightning Bolt").id, {
                        id: "hand-1",
                        controllerId: BOT,
                        ownerId: BOT,
                        zone: "hand",
                    }),
                ],
            }
        ),
};

describe("root pending choices route to the ISMCTS search (issue #1506)", () => {
    it("every generator-covered kind has a fixture here (registry-driven guard)", () => {
        for (const kind of Object.keys(
            CHOICE_CANDIDATE_GENERATORS
        ) as PendingChoiceKind[]) {
            expect(
                FIXTURES[kind],
                `choice kind "${kind}" has a candidate generator but no routing fixture — ` +
                    `add one and prove the driver hands it to the search, don't leave it heuristic-answered`
            ).toBeDefined();
        }
    });

    // THE acceptance criterion: a generator-covered choice must NOT be answered
    // by the ADR 0016 heuristic on the main thread. It must decide to
    // `search-choice`, which the driver realises through the Worker.
    for (const kind of Object.keys(
        CHOICE_CANDIDATE_GENERATORS
    ) as PendingChoiceKind[]) {
        it(`"${kind}" is handed to the Worker search, not heuristic-answered`, () => {
            const state = FIXTURES[kind]!();
            const publicState = projectPublicState(state, 1, BOT);
            const view = buildBotView(publicState, BOT);

            expect(view.owedChoice?.kind).toBe(kind);
            expect(view.owedChoice?.searchable).toBe(true);

            const action = decideBotAction(view);
            expect(action.kind).toBe("search-choice");
            // The driver's dispatch gate — this is what was broken.
            expect(botActionRealisation(action.kind)).toBe("worker");
            // And the search-choice action carries no answer of its own.
            expect(botActionToMove(action, publicState, BOT)).toBeNull();
        });
    }

    // The other half of the criterion: the move the driver submits is the one
    // the SEARCH returns. `consultBrain` falls back to the same inline
    // `searchWithTrace` the Worker runs when no Worker exists (vitest), so this
    // exercises the driver's actual worker branch end-to-end.
    for (const kind of Object.keys(
        CHOICE_CANDIDATE_GENERATORS
    ) as PendingChoiceKind[]) {
        it(`"${kind}": the search returns a submittable move for the driver`, async () => {
            const state = FIXTURES[kind]!();
            const publicState = projectPublicState(state, 1, BOT);
            const { move } = await consultBrain(publicState, BOT, {
                iterations: 24,
            });
            expect(move).not.toBeNull();
            // A choice window suppresses every other move, so whatever came back
            // IS an answer to the choice (never a pass / land drop / cast).
            expect(["pass", "play-land", "cast-spell"]).not.toContain(
                move!.kind
            );
        });
    }

    it("a searched fetch names REAL library instance ids the server can accept", async () => {
        const state = stateWithBotLibrarySearch([
            "Forest",
            "Craw Wurm",
            "Grizzly Bears",
        ]);
        const publicState = projectPublicState(state, 1, BOT);
        const realIds = new Set(
            state.players.find((p) => p.id === BOT)!.library.map((c) => c.id)
        );
        const { move } = await consultBrain(publicState, BOT, {
            iterations: 24,
        });
        expect(move?.kind).toBe("resolution-choice");
        const picked = (move as { cardInstanceIds: string[] }).cardInstanceIds;
        expect(picked.length).toBeGreaterThan(0);
        // The regression this guards: `projectedToGameState` used to rebuild
        // EVERY library from opaque placeholders, so the search's fetch named
        // fabricated ids the server rejects forever. The projection exposes the
        // searched pile to the chooser (`librarySearch`) — the adapter must use it.
        for (const id of picked) expect(realIds.has(id)).toBe(true);
    });
});

describe("kinds with NO candidate generator keep the ADR 0016 heuristic", () => {
    it("a discard-hand choice is still answered on the main thread (no stall)", () => {
        const state = stateWithBotChoice(
            { kind: "discard-hand", zone: "hand", count: 1 },
            {
                hand: [
                    makeInstance(getCardByName("Forest").id, {
                        id: "h1",
                        controllerId: BOT,
                        ownerId: BOT,
                        zone: "hand",
                    }),
                    makeInstance(getCardByName("Craw Wurm").id, {
                        id: "h2",
                        controllerId: BOT,
                        ownerId: BOT,
                        zone: "hand",
                    }),
                ],
            }
        );
        const publicState = projectPublicState(state, 1, BOT);
        const view = buildBotView(publicState, BOT);

        expect(view.owedChoice?.searchable).toBe(false);
        const action = decideBotAction(view);
        expect(action.kind).toBe("resolution-choice");
        expect(botActionRealisation(action.kind)).toBe("executor");
        expect(botActionToMove(action, publicState, BOT)).not.toBeNull();
    });

    it("a MANDATORY choose-hand-card is not searchable, though its kind has a generator (PR #1914 review finding 2)", () => {
        // Registry membership is not the gate. `handPickCandidates` emits
        // nothing for a `min > 0` pick (a Brainstorm putback, a discard cost),
        // so gating on the KIND made every one of them `search-choice`: a
        // Worker round-trip plus `THINK_DELAY_MS` that enumerates zero moves
        // and lands on the driver's emergency fallback, which exists for
        // exceptional cases only. Driven through the real reducers
        // (`projectPublicState` → `buildBotView`), never a hand-built view.
        const state = stateWithBotChoice(
            {
                kind: "choose-hand-card",
                zone: "hand",
                count: 2,
                prompt: "Put two cards from your hand on top of your library.",
            },
            {
                hand: ["p1", "p2", "p3"].map((id) =>
                    makeInstance(getCardByName("Lightning Bolt").id, {
                        id,
                        controllerId: BOT,
                        ownerId: BOT,
                        zone: "hand",
                    })
                ),
            }
        );
        const publicState = projectPublicState(state, 1, BOT);
        const view = buildBotView(publicState, BOT);

        expect(view.owedChoice?.kind).toBe("choose-hand-card");
        expect(view.owedChoice?.searchable).toBe(false);
        // …and the ADR 0016 heuristic answers it on the main thread, as before.
        const action = decideBotAction(view);
        expect(action.kind).toBe("resolution-choice");
        expect(botActionRealisation(action.kind)).toBe("executor");
        expect(botActionToMove(action, publicState, BOT)).not.toBeNull();

        // The invariant the gate exists to hold: it agrees with the ENUMERATOR
        // choice-by-choice, not kind-by-kind.
        const rehydrated = projectedToGameState(publicState);
        expect(
            choiceCandidates(rehydrated, rehydrated.pendingChoices![0]).length
        ).toBe(0);
    });

    it("madness-cast (no generator) still declines rather than searching", () => {
        const state = stateWithBotChoice({
            kind: "madness-cast",
            cardInstanceId: "x",
            cost: {},
        });
        const view = buildBotView(projectPublicState(state, 1, BOT), BOT);
        expect(view.owedChoice?.searchable).toBe(false);
        expect(decideBotAction(view).kind).toBe("madness-decline");
    });
});

describe("the driver's no-move safety net (issue #1506)", () => {
    it("chooseOwedChoiceAction still yields the legal ADR 0016 answer for a searchable kind", () => {
        // The driver falls back to this when the search surfaces no move for a
        // searchable choice, so the bot can never sit on a frozen priority.
        const state = FIXTURES["may-pay"]!();
        const publicState = projectPublicState(state, 1, BOT);
        const view = buildBotView(publicState, BOT);
        const fallback = chooseOwedChoiceAction(view.owedChoice!);
        expect(fallback.kind).toBe("may-pay");
        expect(botActionRealisation(fallback.kind)).toBe("executor");
        expect(botActionToMove(fallback, publicState, BOT)).not.toBeNull();
    });
});

describe("a mid-flight continuation keeps the choice off the search", () => {
    it("a parked pendingCast makes the choice non-searchable (enumerateMoves surfaces nothing there)", () => {
        const state = FIXTURES["may-pay"]!();
        // The exact condition `enumerateMoves` bails on: a cast continuation is
        // parked, so the enumerator yields no choice candidates and routing to
        // the Worker would stall. The gate must mirror it.
        (state as GameState).pendingCast = {
            playerId: BOT,
            cardInstanceId: "x",
        } as GameState["pendingCast"];
        const view = buildBotView(projectPublicState(state, 1, BOT), BOT);
        expect(view.owedChoice?.searchable).toBe(false);
        expect(botActionRealisation(decideBotAction(view).kind)).toBe(
            "executor"
        );
    });
});

/** The projected search state must agree with the gate: whenever the gate says
 *  "searchable", the engine's own root decider must name the bot. */
describe("gate and engine agree on the root decider", () => {
    it("the projected state's head choice is the bot's for every fixture", () => {
        for (const kind of Object.keys(
            CHOICE_CANDIDATE_GENERATORS
        ) as PendingChoiceKind[]) {
            const publicState = projectPublicState(FIXTURES[kind]!(), 1, BOT);
            const rehydrated = projectedToGameState(publicState);
            expect(rehydrated.pendingChoices?.[0]?.playerId).toBe(BOT);
            expect(rehydrated.pendingChoices?.[0]?.kind).toBe(kind);
        }
    });
});
