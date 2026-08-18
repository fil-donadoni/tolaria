// The bot must ANSWER Mox Diamond's as-enters discard, and answer it with a
// sign (issue #2389).
//
// Why the shared `discard-hand` arm is not enough. Every as-enters prompt
// REUSES an existing `PendingChoiceKind` shape (ADR 0100 D3), so the bot's
// exhaustive `chooseResolution` switch already reaches this window and the game
// never freezes — that half is free. What is NOT free is the ANSWER: the
// shipped arm submits `min` cards worst-first, and an as-enters `discard` has
// `min: 0`, so the shared default declines every time. Declining is legal, but
// for this card it means the Mox goes to the graveyard — the bot would never
// play its own artifact.
//
// Producer census for the `discard-hand` kind — the input space the new
// `asEntersKind === "discard"` branch discriminates over. One row per producer,
// with the load-bearing "should this take the new branch" column:
//
//   row | producer                                              | asEntersKind | min | new branch?
//   ----|-------------------------------------------------------|--------------|-----|------------
//   A   | CR 514.1 cleanup discard (`gre/phases.ts`)             | undefined    | >0  | NO
//   B   | DSL `choice` Op, `kind: "discard-hand"` (Bazaar of     | undefined    | >=0 | NO
//       |   Baghdad, Necropotence, Wheel-shaped cards, …)        |              |     |
//   C   | `resolve()` `requestChoice` discard picks (Mind Warp,  | undefined    | >=0 | NO
//       |   Leshrac's Sigil — the CASTER picks the TARGET's)     |              |     |
//   D   | as-enters `{ kind: "discard" }` (Mox Diamond, #2389)   | "discard"    | 0   | YES
//
// Rows A-C are the must-NOT rows: a `min === 0` discriminator would fail OPEN on
// row B (an "up to one" DSL discard would start paying a cost nobody asked for),
// which is why the branch keys on the explicit `asEntersKind` instead. Row A is
// asserted below as the must-NOT case; rows B/C share row A's shape exactly
// (`asEntersKind` undefined) and are covered by the same assertion.
//
// Everything here runs through the REAL reducers the driver uses —
// `projectPublicState` → `buildBotView` → `escalationLadder` — never a
// hand-built OwedChoice, so a field dropped in the projection shows up as red.

import { describe, expect, it } from "vitest";
import { moxDiamond } from "@convex/cards/sets/sth/colorless";
import { forest, grizzlyBears } from "@convex/cards/sets/lea";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { projectPublicState } from "@convex/gameProjections";
import type { CardInstanceState, GameState } from "@convex/gre";
import { putReanimatedSetOnBattlefield } from "@convex/gre/state";
import { applyPendingChoiceSubmit } from "@convex/gre/pendingChoiceSubmit";
import { refreshExpectedInput } from "@convex/gre/expectedInput";
import { buildBotView } from "../bot-view";
import { escalationLadder } from "../owed-input";
import type { BotAction } from "../brain";

const BOT = "p2";

function handLand(id: string): CardInstanceState {
    return makeInstance(forest.id, {
        id,
        controllerId: BOT,
        ownerId: BOT,
        zone: "hand",
    });
}

function battlefieldLand(id: string): CardInstanceState {
    return makeInstance(forest.id, { id, controllerId: BOT, ownerId: BOT });
}

/** Mox Diamond entering under the BOT's control (the non-cast route parks it
 *  identically to the cast one — same ADR 0100 D1 chokepoint), with
 *  `landsInHand` lands in hand and `landsInPlay` lands already in play. */
function moxEntering(landsInHand: number, landsInPlay: number): GameState {
    const state = makeState({
        players: [
            makePlayer("p1"),
            makePlayer(BOT, {
                hand: Array.from({ length: landsInHand }, (_, i) =>
                    handLand(`hand-land-${i}`)
                ),
                battlefield: Array.from({ length: landsInPlay }, (_, i) =>
                    battlefieldLand(`play-land-${i}`)
                ),
            }),
        ],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
    });
    const mox = makeInstance(moxDiamond.id, {
        id: "mox",
        controllerId: BOT,
        ownerId: BOT,
        zone: "graveyard",
    });
    putReanimatedSetOnBattlefield(state, [{ card: mox, controllerId: BOT }]);
    refreshExpectedInput(state);
    return state;
}

/** THE path under test — the exact three calls the vs-AI driver makes. */
function rungTwo(state: GameState): BotAction {
    const projected = projectPublicState(state, 1, BOT);
    const view = buildBotView(projected, BOT);
    expect(view.owedInput?.kind).toBe("choice");
    const ladder = escalationLadder("choice", view);
    expect(ladder.map((s) => s.rung)).toEqual([2]);
    return ladder[0].action;
}

function picks(action: BotAction): string[] {
    expect(action.kind).toBe("resolution-choice");
    if (action.kind !== "resolution-choice") throw new Error("wrong kind");
    return action.cardInstanceIds;
}

function submit(state: GameState, ids: string[]): void {
    const h = (state.pendingChoices ?? [])[0];
    applyPendingChoiceSubmit(state, {
        playerId: h.playerId,
        stackItemId: h.stackItemId,
        step: h.step,
        choiceId: h.choiceId,
        cardInstanceIds: ids,
    });
}

const botBattlefieldIds = (state: GameState): string[] =>
    state.players[1].battlefield.map((c) => c.id);
const botGraveyardIds = (state: GameState): string[] =>
    state.players[1].graveyard.map((c) => c.id);

describe("bot answers Mox Diamond's as-enters discard (CR 614.1a, issue #2389)", () => {
    it("row D — the window IS owed and the bot produces a submission for it (ADR 0047)", () => {
        const state = moxEntering(2, 0);
        const action = rungTwo(state);
        expect(action.kind).toBe("resolution-choice");
    });

    it("pays out of surplus — two lands in hand, one covers the land drop (CR 305.2)", () => {
        const state = moxEntering(2, 0);
        const ids = picks(rungTwo(state));
        expect(ids).toHaveLength(1);

        submit(state, ids);
        expect(botBattlefieldIds(state)).toContain("mox");
        expect(botGraveyardIds(state)).toContain(ids[0]);
    });

    it("pays with ONE spare land once the board is mana-developed (the land-flood case)", () => {
        const state = moxEntering(1, 4);
        const ids = picks(rungTwo(state));
        expect(ids).toEqual(["hand-land-0"]);

        submit(state, ids);
        expect(botBattlefieldIds(state)).toContain("mox");
    });

    it("declines while land-light — the last land is the constraining resource (#242)", () => {
        const state = moxEntering(1, 1);
        expect(picks(rungTwo(state))).toEqual([]);

        submit(state, []);
        // CR 614.1a — the Mox goes to the graveyard, and the land is still in
        // hand to be played.
        expect(botBattlefieldIds(state)).not.toContain("mox");
        expect(botGraveyardIds(state)).toContain("mox");
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["hand-land-0"]);
    });

    it("no land in hand — the engine auto-resolves, so the bot is never asked", () => {
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer(BOT, {
                    hand: [
                        makeInstance(grizzlyBears.id, {
                            id: "bears",
                            controllerId: BOT,
                            ownerId: BOT,
                            zone: "hand",
                        }),
                    ],
                }),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
        });
        const mox = makeInstance(moxDiamond.id, {
            id: "mox",
            controllerId: BOT,
            ownerId: BOT,
            zone: "graveyard",
        });
        putReanimatedSetOnBattlefield(state, [
            { card: mox, controllerId: BOT },
        ]);

        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(botGraveyardIds(state)).toContain("mox");
    });

    it("row A (must NOT) — an ordinary discard-hand levy keeps its pre-#2389 answer", () => {
        // The CR 514.1 cleanup shape: same `kind`, no `asEntersKind`, a real
        // `min`. The new branch must not reach it, so the bot still sheds
        // exactly `min` cards rather than consulting the surplus rule.
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer(BOT, {
                    hand: [handLand("hand-land-0"), handLand("hand-land-1")],
                }),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
        });
        state.pendingChoices = [
            {
                stackItemId: "",
                step: 0,
                choiceId: BOT,
                playerId: BOT,
                kind: "discard-hand",
                zone: "hand",
                count: 1,
                prompt: "Discard down to seven cards.",
            },
        ];
        state.pendingCleanupDiscard = { playerId: BOT };
        refreshExpectedInput(state);

        expect(picks(rungTwo(state))).toHaveLength(1);
    });
});
