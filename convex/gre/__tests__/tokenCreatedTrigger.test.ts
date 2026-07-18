// Token-creation meta-trigger foundation (issue #1345, CR 111 / 707.2). Proves
// the two load-bearing pieces:
//   1. `createTokenPermanents` (via `SpellContext.createToken`) emits ONE
//      `TOKENS_CREATED` pendingEvent per CALL — the natural batching a
//      "whenever you create one or more X tokens" trigger (Staff of the
//      Storyteller) needs: creating 3 tokens in one resolution still fires
//      exactly once, not three times.
//   2. `tokenCreatedTrigger` — the declarative factory building a
//      TriggeredAbility off that event — fires end-to-end: the engine's
//      normal trigger-collection pass (`processPendingActionTriggers`) picks
//      it up and stacks it, honoring `scope` and an optional creature-token
//      `filter`.

import { describe, it, expect } from "vitest";
import {
    buildSpellContext,
    processPendingActionTriggers,
    resolveTopOfStack,
    getPlayer,
    type GameState,
} from "../state";
import { registerTokenDefinition } from "../../cards";
import { tokenCreatedTrigger } from "../../cards/abilities/triggers/tokenCreatedTrigger";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import type { CardDefinition } from "../../cards/types";

const WATCHER_YOU_ID = "test-token-created-watcher-you";
const WATCHER_OPPONENTS_ID = "test-token-created-watcher-opponents";
const WATCHER_CREATURE_FILTER_ID = "test-token-created-watcher-creature-filter";

// Fires on ANY creature token its controller creates (scope: "you"), gaining
// 1 life per occurrence — an easily-observed side effect proving the trigger
// actually resolved, not just matched.
registerTokenDefinition({
    id: WATCHER_YOU_ID,
    name: "Test Token Watcher (you)",
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Test"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        tokenCreatedTrigger({
            id: "test-token-created-you",
            oracleText: "Whenever you create one or more tokens, gain 1 life.",
            scope: "you",
            resolve: (ctx, _event, created) => {
                ctx.gainLife(created.controllerId, 1);
            },
        }),
    ],
} satisfies CardDefinition);

registerTokenDefinition({
    id: WATCHER_OPPONENTS_ID,
    name: "Test Token Watcher (opponents)",
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Test"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        tokenCreatedTrigger({
            id: "test-token-created-opponents",
            oracleText:
                "Whenever an opponent creates one or more tokens, gain 1 life.",
            scope: "opponents",
            resolve: (ctx) => {
                // `ctx.controller` is the WATCHER's controller (an ETB/trigger
                // ability always belongs to its source), not the token
                // creator — gain life for the watcher's own controller.
                ctx.gainLife(ctx.controller, 1);
            },
        }),
    ],
} satisfies CardDefinition);

// Filters to creature tokens only — mirrors Staff of the Storyteller's exact
// clause ("whenever you create one or more CREATURE tokens").
registerTokenDefinition({
    id: WATCHER_CREATURE_FILTER_ID,
    name: "Test Token Watcher (creature filter)",
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Test"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        tokenCreatedTrigger({
            id: "test-token-created-creature-filter",
            oracleText:
                "Whenever you create one or more creature tokens, gain 1 life.",
            scope: "you",
            filter: { types: "Creature" },
            resolve: (ctx, _event, created) => {
                ctx.gainLife(created.controllerId, 1);
            },
        }),
    ],
} satisfies CardDefinition);

function pushItem(state: GameState, cardId: string, controllerId = "p1") {
    return pushSpell(state, cardId, controllerId);
}

describe("SpellContext.createToken emits TOKENS_CREATED (CR 111 / 707.2, issue #1345)", () => {
    it("queues ONE TOKENS_CREATED pendingEvent per call, count matching the batch", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushItem(state, WATCHER_YOU_ID);
        const ctx = buildSpellContext(state, item);

        ctx.createToken(
            {
                name: "Spirit",
                types: ["Creature"],
                subtypes: ["Spirit"],
                power: 1,
                toughness: 1,
                colors: ["W"],
                staticAbilities: ["flying"],
            },
            "p1",
            3
        );

        const tokenEvents = (state.pendingEvents ?? []).filter(
            (e) => e.type === "TOKENS_CREATED"
        );
        expect(tokenEvents).toHaveLength(1);
        expect(tokenEvents[0]).toMatchObject({
            type: "TOKENS_CREATED",
            controllerId: "p1",
            count: 3,
            types: ["Creature"],
            subtypes: ["Spirit"],
        });
    });

    it("does NOT emit for a zero count", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushItem(state, WATCHER_YOU_ID);
        const ctx = buildSpellContext(state, item);

        ctx.createToken({ name: "Spirit", types: ["Creature"] }, "p1", 0);

        expect(
            (state.pendingEvents ?? []).filter(
                (e) => e.type === "TOKENS_CREATED"
            )
        ).toHaveLength(0);
    });
});

describe("tokenCreatedTrigger fires end-to-end (issue #1345)", () => {
    it("BATCHES: creating 3 tokens in one call fires the trigger ONCE, not three times", () => {
        const watcher = makeInstance(WATCHER_YOU_ID, {
            id: "watcher1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [watcher], life: 20 }),
                makePlayer("p2"),
            ],
        });
        const item = pushItem(state, WATCHER_YOU_ID);
        const ctx = buildSpellContext(state, item);

        ctx.createToken(
            { name: "Spirit", types: ["Creature"], power: 1, toughness: 1 },
            "p1",
            3
        );
        processPendingActionTriggers(state);

        const stackTriggers = state.stack.filter(
            (s) => s.triggeredAbilityId === "test-token-created-you"
        );
        expect(stackTriggers).toHaveLength(1);

        while (
            state.stack.length > 0 &&
            state.stack[state.stack.length - 1]!.triggeredAbilityId ===
                "test-token-created-you"
        ) {
            resolveTopOfStack(state);
        }

        // ONE life gain, not three — the batching invariant.
        expect(getPlayer(state, "p1").life).toBe(21);
    });

    it("scope: you does not fire when an OPPONENT creates the tokens", () => {
        const watcher = makeInstance(WATCHER_YOU_ID, {
            id: "watcher2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [watcher], life: 20 }),
                makePlayer("p2"),
            ],
        });
        const item = pushItem(state, WATCHER_YOU_ID);
        const ctx = buildSpellContext(state, item);

        ctx.createToken({ name: "Spirit", types: ["Creature"] }, "p2", 1);
        processPendingActionTriggers(state);

        expect(
            state.stack.find(
                (s) => s.triggeredAbilityId === "test-token-created-you"
            )
        ).toBeUndefined();
    });

    it("scope: opponents fires when an opponent creates tokens, not when you do", () => {
        const watcher = makeInstance(WATCHER_OPPONENTS_ID, {
            id: "watcher3",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [watcher], life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        const item = pushItem(state, WATCHER_OPPONENTS_ID);
        const ctx = buildSpellContext(state, item);

        // p1's own token creation must NOT fire the "opponents" scope.
        ctx.createToken({ name: "Spirit", types: ["Creature"] }, "p1", 1);
        processPendingActionTriggers(state);
        expect(
            state.stack.find(
                (s) => s.triggeredAbilityId === "test-token-created-opponents"
            )
        ).toBeUndefined();

        // p2 (the opponent of the watcher's controller) creating tokens DOES fire.
        ctx.createToken({ name: "Spirit", types: ["Creature"] }, "p2", 1);
        processPendingActionTriggers(state);
        expect(
            state.stack.find(
                (s) => s.triggeredAbilityId === "test-token-created-opponents"
            )
        ).toBeDefined();
    });

    it("filter: types Creature excludes a non-creature token creation", () => {
        const watcher = makeInstance(WATCHER_CREATURE_FILTER_ID, {
            id: "watcher4",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [watcher], life: 20 }),
                makePlayer("p2"),
            ],
        });
        const item = pushItem(state, WATCHER_CREATURE_FILTER_ID);
        const ctx = buildSpellContext(state, item);

        // A Clue artifact token (noncreature) must NOT fire the creature filter.
        ctx.createToken(
            { name: "Clue", types: ["Artifact"], subtypes: ["Clue"] },
            "p1",
            1
        );
        processPendingActionTriggers(state);
        expect(
            state.stack.find(
                (s) =>
                    s.triggeredAbilityId ===
                    "test-token-created-creature-filter"
            )
        ).toBeUndefined();

        // A creature token DOES fire.
        ctx.createToken(
            { name: "Spirit", types: ["Creature"], power: 1, toughness: 1 },
            "p1",
            1
        );
        processPendingActionTriggers(state);
        expect(
            state.stack.find(
                (s) =>
                    s.triggeredAbilityId ===
                    "test-token-created-creature-filter"
            )
        ).toBeDefined();
    });
});
