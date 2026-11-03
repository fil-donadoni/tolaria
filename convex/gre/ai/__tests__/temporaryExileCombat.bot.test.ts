// Issue #7791 — a TEMPORARY exile (CR 603.7a: Flickerwisp's "return that card
// to the battlefield ... at the beginning of the next end step") priced at
// what the permanent misses before it comes back, read on the position the
// answer settles to (`settleStackForBreakdown` — the same settle the root's
// `announcement-variant` ranking reads through `resolvedMarginDelta`) and
// scored by the leaf evaluation.
//
// The discriminating pair: an opposing creature exiled on the Bot's own turn,
// before a combat in which the Bot has a creature ready to attack, is a
// blocker gone from that combat (CR 509.1a — only the defending player's
// creatures on the battlefield block); with no ready attacker, or on the
// opponent's turn, it is back before anything it does matters, and the exile
// is worth what exiling a land is.

import { describe, expect, it } from "vitest";
import type { ScenarioSpec } from "../../../debugScenarioSpec";
import { describeMove } from "../../describeMove";
import { enumerateMoves } from "../../moves";
import { cloneGameState } from "../../clone";
import { evaluate } from "../../evaluate";
import type { GameState } from "../../state";
import {
    answeredTriggerId,
    applyMoveInSearch,
    decidingPlayer,
    policyProbeState,
    settleStackForBreakdown,
} from "../../search";
import type { BladeSetupStep } from "../blade/types";
import { buildBladeState, buildPositionFromSpec } from "../blade/build";
import { BLADE_SCENARIOS } from "../blade/scenarios";
import { seatPlayerId } from "../blade/matcher";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import { candidateFeatures } from "../verdicts/evalPairs";

type Board = {
    /** The Bot's other creature — able to attack this turn or not. */
    bearsSick: boolean;
    /** The Bot's other creature (default Grizzly Bears). */
    creature?: string;
    /** Whose turn the enters trigger targets on. */
    turn: "me" | "opp";
};

/** One settled evaluation per described `submit-target` answer of Flickerwisp's
 *  enters trigger (CR 603.3d). */
function targetValues(board: Board): Map<string, number> {
    const spec: ScenarioSpec = {
        cards: [
            board.turn === "me"
                ? { name: "Flickerwisp", owner: "me", zone: "hand" }
                : {
                      name: "Flickerwisp",
                      owner: "me",
                      zone: "battlefield",
                  },
            {
                name: board.creature ?? "Grizzly Bears",
                owner: "me",
                zone: "battlefield",
                summoningSick: board.bearsSick,
            },
            { name: "Plains", owner: "me", zone: "battlefield", count: 3 },
            {
                name: "Hill Giant",
                owner: "opp",
                zone: "battlefield",
                summoningSick: false,
            },
            { name: "Mountain", owner: "opp", zone: "battlefield", count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        turn: 6,
        libraryCount: 20,
        ...(board.turn === "opp"
            ? { activePlayer: "opp" as const, priority: "me" as const }
            : {}),
    };
    const setup: BladeSetupStep[] =
        board.turn === "me"
            ? [
                  { kind: "cast", card: "Flickerwisp", by: "me" },
                  { kind: "pass", seat: "opp" },
              ]
            : [{ kind: "etb-trigger", card: "Flickerwisp", controller: "me" }];
    const state = buildPositionFromSpec(spec, setup, "temporary exile");
    const bot = decidingPlayer(state);
    if (!bot) throw new Error("no seat owes a decision");
    expect(state.pendingTarget?.kind).toBe("trigger");
    const values = new Map<string, number>();
    for (const move of enumerateMoves(state, bot)) {
        if (move.kind !== "submit-target") continue;
        const probe = cloneGameState(state);
        applyMoveInSearch(probe, bot, move);
        const settled = settleStackForBreakdown(probe, bot);
        // The trigger resolved: the answer's exile is on the board scored.
        expect(settled.stack).toHaveLength(0);
        values.set(describeMove(move, state), evaluate(settled, bot));
    }
    return values;
}

const GIANT = "target Hill Giant";
const MOUNTAIN = "target Mountain";
const BEARS = "target Grizzly Bears";

describe("temporary exile — CR 603.7a return window vs this turn's combat", () => {
    it("own turn, ready attacker: the opposing blocker's exile outscores the land's", () => {
        const v = targetValues({ bearsSick: false, turn: "me" });
        expect(v.get(GIANT)).toBeGreaterThan(v.get(MOUNTAIN)! + 10);
    });

    it("own turn: a land in temporary exile is not a source lost for good (it reads as the no-op of flickering a vanilla creature)", () => {
        const v = targetValues({ bearsSick: false, turn: "me" });
        expect(v.get(MOUNTAIN)).toBeCloseTo(v.get(BEARS)!, 6);
    });

    it("own turn, no ready attacker: the blocker misses nothing, the two exiles tie", () => {
        const v = targetValues({ bearsSick: true, turn: "me" });
        expect(v.get(GIANT)).toBeCloseTo(v.get(MOUNTAIN)!, 6);
    });

    it("own turn, the only untapped creature cannot attack (CR 702.3b defender): no blocker is missed", () => {
        const v = targetValues({
            bearsSick: false,
            turn: "me",
            creature: "Wall of Stone",
        });
        expect(v.get(GIANT)).toBeCloseTo(v.get(MOUNTAIN)!, 6);
    });

    it("opponent's turn: the creature returns to the active player, no blocker is missed", () => {
        const v = targetValues({ bearsSick: false, turn: "opp" });
        expect(v.get(GIANT)).toBeCloseTo(v.get(MOUNTAIN)!, 6);
    });
});

const VANILLA_ENTRY =
    "audit: cast-blink: Flickerwisp exiles the opposing body when its own creature is vanilla";

/** The blade entry's position — Flickerwisp's enters trigger announcing its
 *  target (CR 603.3d) — and the seat that owes the answer. */
function vanillaEntry(): { state: GameState; bot: string } {
    const scenario = BLADE_SCENARIOS.find((s) => s.label === VANILLA_ENTRY);
    if (!scenario) throw new Error("blade entry missing");
    const state = buildBladeState(scenario);
    expect(state.pendingTarget?.kind).toBe("trigger");
    return { state, bot: seatPlayerId(state, scenario.bot) };
}

function answer(state: GameState, bot: string, name: string) {
    const move = enumerateMoves(state, bot).find(
        (m) => m.kind === "submit-target" && describeMove(m, state) === name
    );
    if (!move) throw new Error(`no answer ${name}`);
    return move;
}

describe("1-ply probe — a trigger-target answer reads its trigger resolved (CR 603.3d)", () => {
    it("the Eval Pair policy separates the opposing blocker's exile from the land's", () => {
        const { state, bot } = vanillaEntry();
        const value = (name: string) =>
            candidateFeatures(state, bot, answer(state, bot, name)).policyValue;
        expect(value(GIANT)).toBeGreaterThan(value(MOUNTAIN) + 10);
    });

    it("a stale answer, its selection already completed, settles no trigger", () => {
        const { state, bot } = vanillaEntry();
        const giant = answer(state, bot, GIANT);
        // The selection answered: the trigger sits alone on the stack with
        // its target written and no selection pending.
        const answered = cloneGameState(state);
        applyMoveInSearch(answered, bot, giant);
        expect(answered.pendingTarget).toBeUndefined();
        expect(answered.stack).toHaveLength(1);
        // The same submission replayed there answers nothing
        // (`raisedPendingTargetOwedBy`), so the lone trigger is not its
        // payoff and the probe leaves it on the stack.
        const probe = cloneGameState(answered);
        applyMoveInSearch(probe, bot, giant);
        const settled = policyProbeState(
            probe,
            giant,
            DEFAULT_EVAL_WEIGHTS,
            bot,
            false,
            answeredTriggerId(answered, bot, giant)
        );
        expect(settled.stack).toHaveLength(1);
    });
});
