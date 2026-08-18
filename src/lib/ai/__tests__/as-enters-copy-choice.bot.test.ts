// The bot must ANSWER the as-enters copy choice, and answer it with a sign
// (issue #2451, ADR 0100 slice 4).
//
// Why the shared `choose-permanents` arm is not enough. Every as-enters prompt
// REUSES an existing `PendingChoiceKind` shape (ADR 0100 D3), so the bot's
// exhaustive `chooseResolution` switch already reaches this window and the game
// never freezes — that half is free. What is NOT free is the ANSWER: the
// shipped arm submits the first `min` candidates, and an as-enters `copy` has
// `min: 0` (every printed clause is "you MAY have this enter as a copy"), so
// the shared default declines every time. Declining is legal and leaves a
// printed 0/0 the next sweep bins (CR 704.5f) — the bot would reanimate its own
// Clone straight into the graveyard, which is the very outcome #2451 is about.
//
// Producer census for the `choose-permanents` kind — the input space the new
// `asEntersKind === "copy"` branch discriminates over. One row per producer,
// with the load-bearing "should this take the new branch" column:
//
//   row | producer                                                | asEntersKind | min  | new branch?
//   ----|---------------------------------------------------------|--------------|------|------------
//   A   | DSL `choice` Op, `kind: "choose-permanents"`             | undefined    | >=0  | NO
//       |   (`gre/effects/interpreter.ts`, ~20 shipped cards)      |              |      |
//   B   | `resolve()`/`resolveSteps` `requestChoice`               | undefined    | >=0  | NO
//       |   (`cards/sets/**`, e.g. usg/blue, ice/black, amass)     |              |      |
//   C   | as-enters `{ kind: "copy" }` (`gre/state.ts`, #2451)     | "copy"       | 0    | YES
//
// Rows A and B are the must-NOT rows, and they are why the branch keys on the
// explicit `asEntersKind` rather than on `min === 0`: an "up to one" DSL pick
// (row A) would otherwise start grabbing a permanent nobody asked it to. Row A
// is asserted below; row B has row A's shape exactly (`asEntersKind` undefined)
// and is covered by the same assertion. The as-enters `aura-host` leg is NOT a
// row here — it raises `choose-aura-host`, a different switch arm.
//
// Everything runs through the REAL reducers the driver uses —
// `projectPublicState` → `buildBotView` → `escalationLadder` — never a
// hand-built OwedChoice, so a field dropped in the projection shows up as red.

import { describe, expect, it } from "vitest";
import { clone } from "@convex/cards/sets/lea/blue";
import { grizzlyBears, serraAngel } from "@convex/cards/sets/lea";
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
import { getEffectivePower } from "@convex/gre/layers";
import { buildBotView } from "../bot-view";
import { escalationLadder } from "../owed-input";
import type { BotAction } from "../brain";

const BOT = "p2";

function opponentCreature(defId: string, id: string): CardInstanceState {
    return makeInstance(defId, { id, controllerId: "p1", ownerId: "p1" });
}

/** A Clone entering under the BOT's control by the non-cast route (the same
 *  ADR 0100 D1 chokepoint a cast takes), with `board` on the opponent's side as
 *  the copy candidates. */
function cloneEntering(board: CardInstanceState[]): GameState {
    const state = makeState({
        players: [makePlayer("p1", { battlefield: board }), makePlayer(BOT)],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
    });
    const cloneCard = makeInstance(clone.id, {
        id: "clone",
        controllerId: BOT,
        ownerId: BOT,
        zone: "graveyard",
    });
    putReanimatedSetOnBattlefield(state, [
        { card: cloneCard, controllerId: BOT },
    ]);
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

describe("bot answers the as-enters copy choice (CR 707.5, issue #2451)", () => {
    it("row C — the window IS owed and the bot produces a submission for it (ADR 0047)", () => {
        const state = cloneEntering([
            opponentCreature(grizzlyBears.id, "bears"),
        ]);
        expect(rungTwo(state).kind).toBe("resolution-choice");
    });

    it("copies the BEST body on the board rather than declining", () => {
        const state = cloneEntering([
            opponentCreature(grizzlyBears.id, "bears"),
            opponentCreature(serraAngel.id, "serra"),
        ]);

        // The shipped `min`-first default would have submitted `[]` here.
        expect(picks(rungTwo(state))).toEqual(["serra"]);

        submit(state, ["serra"]);
        const copy = state.players[1].battlefield.find(
            (c) => c.id === "clone"
        )!;
        expect((copy.card as { id: string }).id).toBe(serraAngel.id);
        expect(getEffectivePower(state, copy)).toBe(4);
    });

    it("no legal source — the engine auto-declines, so the bot is never asked", () => {
        const state = cloneEntering([]);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("row A (must NOT) — an optional ordinary choose-permanents keeps its pre-#2451 answer", () => {
        // Same `kind`, same `min: 0`, no `asEntersKind`: an "up to one" DSL /
        // `requestChoice` pick must still resolve to the empty, always-legal
        // submission (ADR 0016), not start grabbing a permanent.
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        opponentCreature(serraAngel.id, "serra"),
                        opponentCreature(grizzlyBears.id, "bears"),
                    ],
                }),
                makePlayer(BOT),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
        });
        state.pendingChoices = [
            {
                stackItemId: "item-1",
                step: 0,
                choiceId: "up-to-one",
                playerId: BOT,
                kind: "choose-permanents",
                zone: "battlefield",
                allControllers: true,
                candidateIds: ["serra", "bears"],
                count: { min: 0, max: 1 },
                prompt: "You may choose a creature.",
            },
        ];
        refreshExpectedInput(state);

        expect(picks(rungTwo(state))).toEqual([]);
    });
});
