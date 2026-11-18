// A tax counter into a payer who can pay (issue #9832).
//
// CR 118.12a: "counter target spell unless its controller pays {N}" means the
// spell's controller MAY pay, and the counter happens only if it doesn't. The
// Bot cast Daze into an opponent holding an open Plains, valuing the cast as
// a hard counter. Three seams read it so, each pinned here through the real
// engine:
//   - the 1-ply probe of the cast (`policyProbeState`) stopped on the
//     opponent's `may-pay` with the target still on the stack, where the
//     spell had neither resolved nor been countered;
//   - the probe of the PAYER's answer read accept and decline alike, the
//     spell still on the stack in both, so the rollout's payer declined;
//   - the payer's tree node explored the decline, and its mean backup
//     credited the cast with it (`isDominatedTaxDecline`).

import { describe, expect, it } from "vitest";
import type { ScenarioSpec } from "../../../debugScenarioSpec";
import type { GameState } from "../../state";
import { cloneGameState } from "../../clone";
import { enumerateMoves, type Move } from "../../moves";
import {
    advanceToDecision,
    applyMoveInSearch,
    policyValue,
} from "../../search";
import { buildPositionFromSpec } from "../blade/build";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import { isDominatedTaxDecline } from "../taxDominance";

type SpecCard = ScenarioSpec["cards"][number];

/** The opponent ("me" seat) cast Serra Angel and passed; the Bot ("opp")
 *  holds `counter` over `botIslands` Islands, the opponent `open` untapped
 *  Plains. */
function position(
    counter: string,
    botIslands: number,
    open: number
): GameState {
    const cards: SpecCard[] = [
        { name: counter, owner: "opp", zone: "hand" },
        ...Array.from(
            { length: botIslands },
            (): SpecCard => ({
                name: "Island",
                owner: "opp",
                zone: "battlefield",
            })
        ),
        ...Array.from(
            { length: 5 },
            (_, i): SpecCard => ({
                name: "Plains",
                owner: "me",
                zone: "battlefield",
                tapped: i >= open,
            })
        ),
    ];
    return buildPositionFromSpec({
        cards,
        phase: "PRECOMBAT_MAIN",
        activePlayer: "me",
        turn: 6,
        priority: "opp",
        passCount: 1,
        landsPlayed: { me: 1 },
        libraryCount: 20,
        stack: [{ kind: "spell", name: "Serra Angel", controller: "me" }],
    });
}

function botOf(state: GameState): string {
    return state.priorityPlayerId!;
}

function castMove(state: GameState): Move {
    const move = enumerateMoves(state, botOf(state)).find(
        (m) => m.kind === "cast-spell"
    );
    if (!move) throw new Error("the counter is not castable here");
    return move;
}

/** The Bot's 1-ply value of `pid`'s `move` from `state` (the move applied,
 *  then probed), on the Bot's own scale. */
function botValue(
    state: GameState,
    botId: string,
    pid: string,
    move: Move
): number {
    const probe = cloneGameState(state);
    applyMoveInSearch(probe, pid, move);
    return policyValue(probe, botId, move, DEFAULT_EVAL_WEIGHTS, pid);
}

const PASS: Move = { kind: "pass" };

/** The world after the Bot casts the counter and the opponent passes: the
 *  counter resolving, the payer's `may-pay` at the head. */
function atPayersChoice(state: GameState): GameState {
    const world = cloneGameState(state);
    applyMoveInSearch(world, botOf(state), castMove(state));
    for (let i = 0; i < 4; i++) {
        if (world.pendingChoices?.[0]?.kind === "may-pay") return world;
        const pid = advanceToDecision(world);
        if (!pid) break;
        applyMoveInSearch(world, pid, PASS);
    }
    if (world.pendingChoices?.[0]?.kind !== "may-pay") {
        throw new Error("the counter never asked for its tax");
    }
    return world;
}

describe("tax counter into a payable tax (CR 118.12a, issue #9832)", () => {
    it("the 1-ply probe reads Daze below passing when the opponent can pay {1}", () => {
        const state = position("Daze", 1, 1);
        const bot = botOf(state);
        expect(botValue(state, bot, bot, castMove(state))).toBeLessThan(
            botValue(state, bot, bot, PASS)
        );
    });

    it("the 1-ply probe still reads Daze into a tapped-out opponent as a counter", () => {
        const state = position("Daze", 1, 0);
        const bot = botOf(state);
        expect(botValue(state, bot, bot, castMove(state))).toBeGreaterThan(
            botValue(state, bot, bot, PASS)
        );
    });

    it("the payer's 1-ply reading pays Mana Leak's {3} to keep its spell", () => {
        const state = position("Mana Leak", 2, 3);
        const bot = botOf(state);
        const world = atPayersChoice(state);
        const payer = world.pendingChoices![0].playerId;
        const answers = enumerateMoves(world, payer);
        const accept = answers.find((m) => m.kind === "may-pay" && m.accept)!;
        const decline = answers.find((m) => m.kind === "may-pay" && !m.accept)!;
        // Bot-perspective values: the payer's better answer is the Bot's worse.
        expect(botValue(world, bot, payer, accept)).toBeLessThan(
            botValue(world, bot, payer, decline)
        );
    });

    it("the payer's decline is dominated when an affordable mana-only accept keeps its spell", () => {
        const world = atPayersChoice(position("Daze", 1, 1));
        const payer = world.pendingChoices![0].playerId;
        expect(
            isDominatedTaxDecline(
                world,
                enumerateMoves(world, payer),
                (probe, move) => applyMoveInSearch(probe, payer, move)
            )
        ).toBe(true);
    });

    it("no decline is dominated when the payer cannot pay", () => {
        const world = atPayersChoice(position("Mana Leak", 2, 2));
        const payer = world.pendingChoices![0].playerId;
        const answers = enumerateMoves(world, payer);
        expect(answers.some((m) => m.kind === "may-pay" && m.accept)).toBe(
            false
        );
        expect(
            isDominatedTaxDecline(world, answers, (probe, move) =>
                applyMoveInSearch(probe, payer, move)
            )
        ).toBe(false);
    });
});
