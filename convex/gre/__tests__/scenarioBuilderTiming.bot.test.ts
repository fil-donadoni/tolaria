// CR 307.1 (issue #3454) — the BEHAVIOURAL half of the scenario spec's turn
// holder: what the rebuilt position actually lets the judged seat do.
//
// It lives in the bot suite rather than beside the rest of the builder's tests
// because it reads the legal-move list through `enumerateMoves`, which
// `bot-suite-boundary.test.ts` classifies as a bot-only module — the app suite
// loses the CPU race on those and times out.

import { describe, expect, it } from "vitest";
import { buildStateFromScenario } from "../scenarioBuilder";
import { makeState } from "../../cards/__tests__/setup";
import { enumerateMoves } from "../moves";
import { giantGrowth, grizzlyBears } from "../../cards/sets/lea/green";
import { forest } from "../../cards/sets/lea/colorless";
import type { GameState } from "../state";
import type { ScenarioSpec } from "../../debugScenarioSpec";

/** A board where "me" holds a land, a creature and an instant, with mana to
 *  cast any of them — so the enumerated list is a direct read of what TIMING
 *  the rebuilt position allows (CR 307.1 / 305.1 / 302.1). */
const TIMING_BOARD: ScenarioSpec = {
    cards: [
        { name: forest.name, owner: "me", zone: "hand" },
        { name: grizzlyBears.name, owner: "me", zone: "hand" },
        { name: giantGrowth.name, owner: "me", zone: "hand" },
        { name: grizzlyBears.name, owner: "opp", zone: "battlefield" },
    ],
    landCount: 4,
};

function kindsFor(state: GameState, playerId: string): string[] {
    return enumerateMoves(state, playerId).map((m) => m.kind);
}

/** The DEFINITION ids the seat may cast — the instance carries the definition,
 *  never a display name, so the id is what identifies it. */
function castableDefIds(state: GameState, playerId: string): string[] {
    const hands = [...state.players[0].hand, ...state.players[1].hand];
    return enumerateMoves(state, playerId)
        .filter((m) => m.kind === "cast-spell")
        .map((m) => {
            const card = hands.find((c) => c.id === m.cardInstanceId);
            return (card?.card as { id?: string })?.id ?? "?";
        });
}

describe("buildStateFromScenario — timing on the opponent's turn (issue #3454)", () => {
    // THE behavioural claim (CR 307.1): on the opponent's turn the judged seat
    // may only act at instant speed. A rebuild that got the turn holder wrong
    // fails HERE, loudly, rather than by quietly offering a bigger list.
    it("offers the judged seat ONLY instant-speed moves on the opponent's turn (CR 307.1)", () => {
        const onOppTurn = buildStateFromScenario(makeState(), {
            ...TIMING_BOARD,
            activePlayer: "opp",
            priority: "me",
        });
        const meId = onOppTurn.players[0].id;

        // No land drop (CR 305.1: active player, main phase, empty stack).
        expect(kindsFor(onOppTurn, meId)).not.toContain("play-land");
        // No creature — sorcery timing (CR 302.1 / 307.1).
        expect(castableDefIds(onOppTurn, meId)).not.toContain(grizzlyBears.id);
        // The instant IS offered: the seat still has priority, it is only the
        // timing that narrowed.
        expect(castableDefIds(onOppTurn, meId)).toContain(giantGrowth.id);

        // The control: the SAME board on the judged seat's own turn offers all
        // three, so the assertion above is measuring the turn holder and not
        // some unrelated legality of this fixture.
        const onOwnTurn = buildStateFromScenario(makeState(), TIMING_BOARD);
        expect(kindsFor(onOwnTurn, onOwnTurn.players[0].id)).toContain(
            "play-land"
        );
        expect(castableDefIds(onOwnTurn, onOwnTurn.players[0].id)).toContain(
            grizzlyBears.id
        );
    });
});
