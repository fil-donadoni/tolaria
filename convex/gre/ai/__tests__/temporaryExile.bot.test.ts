// A temporary exile read as temporary (issue #6334, theme "cast × blink").
//
// `bun run cr 603.7a`: "Delayed triggered abilities are created during the
// resolution of spells or abilities". Flickerwisp's enters trigger exiles a
// permanent and creates one that returns it at the beginning of the next end
// step. The Bot read the exile as a permanent removal on both sides — its own
// flickered Flametongue Kavu as lost, the opposing Hill Giant as killed — and
// its tree explored the returning Kavu shooting itself (CR 603.3d: the Kavu
// is a legal target of its own trigger) as often as the Giant.
//
// Every position is the blade entry's, built and played through the real
// engine.

import { describe, it, expect } from "vitest";
import type { CardInstanceState, GameState } from "../../state";
import type { EffectOp } from "../../../cards/types";
import { tryGetDefinition } from "../../../cards";
import { enumerateMoves, type Move } from "../../moves";
import {
    advanceToDecision,
    applyMoveInSearch,
    settleStackForBreakdown,
} from "../../search";
import { materialMargin } from "../../evaluate";
import { BLADE_SCENARIOS } from "../blade/scenarios";
import { buildBladeState } from "../blade/build";
import { seatPlayerId } from "../blade/matcher";
import { misdirectedTargetCount } from "../beneficence";
import {
    blinkReturnedBindings,
    pendingBattlefieldReturns,
} from "../pendingReturn";
import { pruneDominatedTriggerTargets } from "../targetDominance";

const KAVU_ENTRY =
    "audit: cast-blink: Flickerwisp flickers its own Flametongue Kavu for the permanent kill";

function nameOf(card: CardInstanceState): string | undefined {
    return tryGetDefinition(String(card.card.id ?? ""))?.name;
}

/** Flickerwisp's enters trigger on the stack, its target being announced. */
function announcing(): { state: GameState; botId: string } {
    const scenario = BLADE_SCENARIOS.find((s) => s.label === KAVU_ENTRY);
    if (!scenario) throw new Error("blade entry missing");
    const state = buildBladeState(scenario);
    return { state, botId: seatPlayerId(state, scenario.bot) };
}

function answerNaming(state: GameState, botId: string, name: string): Move {
    const move = enumerateMoves(state, botId).find((m) => {
        if (m.kind !== "submit-target") return false;
        const id = m.targets[0]?.id;
        const card = state.players
            .flatMap((p) => p.battlefield)
            .find((c) => c.id === id);
        return card !== undefined && nameOf(card) === name;
    });
    if (!move) throw new Error(`no answer naming ${name}`);
    return move;
}

/** Flickerwisp's trigger resolved against `name`: exiled, return pending. */
function exiled(name: string): { state: GameState; botId: string } {
    const { state, botId } = announcing();
    applyMoveInSearch(state, botId, answerNaming(state, botId, name));
    return { state: settleStackForBreakdown(state, botId), botId };
}

/** The same position with the delayed return gone: a permanent exile. */
function withoutReturn(state: GameState): GameState {
    return { ...state, delayedTriggers: [] };
}

describe("blinkReturnedBindings — the blink shape in a script (CR 603.7a)", () => {
    // Flickerwisp's definition, read through the registry off its trigger.
    const { state } = announcing();
    const def = tryGetDefinition(String(state.stack[0]?.card.id ?? ""));
    const etb = def?.triggeredAbilities?.[0]?.effects ?? [];

    it("reads Flickerwisp's enters trigger", () => {
        expect(def?.name).toBe("Flickerwisp");
        expect(etb.length).toBeGreaterThan(1);
    });

    it("names the exile Flickerwisp's delayed trigger returns", () => {
        expect([...blinkReturnedBindings(etb)]).toEqual(["$c"]);
    });

    it("reads nothing in an exile no delayed trigger returns", () => {
        expect(blinkReturnedBindings(etb.slice(0, 1)).size).toBe(0);
    });

    it("reads nothing when the return waits on a board event", () => {
        const onLeave = etb.map((op) =>
            op.op === "delayedTrigger"
                ? ({ ...op, timing: "leaves-battlefield" } as EffectOp)
                : op
        );
        expect(blinkReturnedBindings(onLeave).size).toBe(0);
    });
});

describe("pendingBattlefieldReturns — the scheduled return (CR 603.7a)", () => {
    it("reads the exiled Kavu as returning to its owner", () => {
        const { state, botId } = exiled("Flametongue Kavu");
        const returns = pendingBattlefieldReturns(state);
        expect(returns.map((r) => [nameOf(r.card), r.to])).toEqual([
            ["Flametongue Kavu", botId],
        ]);
    });

    it("reads nothing once the delayed trigger is gone", () => {
        const { state } = exiled("Flametongue Kavu");
        expect(pendingBattlefieldReturns(withoutReturn(state))).toEqual([]);
    });
});

describe("evaluate — a temporary exile priced as temporary", () => {
    it("credits the bot's flickered Kavu back to it", () => {
        const { state, botId } = exiled("Flametongue Kavu");
        expect(materialMargin(state, botId)).toBeGreaterThan(
            materialMargin(withoutReturn(state), botId)
        );
    });

    it("prices a permanent exile of the Giant above a temporary one", () => {
        const { state, botId } = exiled("Hill Giant");
        expect(materialMargin(withoutReturn(state), botId)).toBeGreaterThan(
            materialMargin(state, botId)
        );
    });

    it("prices the Kavu's return, enters trigger and all, above the Giant's exile", () => {
        const kavu = exiled("Flametongue Kavu");
        const giant = exiled("Hill Giant");
        expect(materialMargin(kavu.state, kavu.botId)).toBeGreaterThan(
            materialMargin(giant.state, giant.botId)
        );
    });
});

describe("misdirectedTargetCount — a blink is no attack on its target", () => {
    it("draws no penalty for flickering the bot's own Kavu", () => {
        const { state, botId } = announcing();
        const move = answerNaming(state, botId, "Flametongue Kavu");
        expect(misdirectedTargetCount(state, move, botId)).toBe(0);
    });
});

describe("pruneDominatedTriggerTargets (CR 603.3d)", () => {
    const apply = (botId: string) => (probe: GameState, move: Move) =>
        applyMoveInSearch(probe, botId, move);

    it("keeps every answer to a trigger that schedules a return", () => {
        const { state, botId } = announcing();
        const moves = enumerateMoves(state, botId);
        expect(
            pruneDominatedTriggerTargets(state, botId, moves, apply(botId))
        ).toHaveLength(moves.length);
    });

    it("keeps only the Giant for the returned Kavu's own trigger", () => {
        const { state, botId } = exiled("Flametongue Kavu");
        // Walk to the end step: the Kavu returns and announces its target.
        for (let ply = 0; ply < 40 && !state.pendingTarget; ply++) {
            const pid = advanceToDecision(state);
            if (!pid) break;
            applyMoveInSearch(state, pid, { kind: "pass" });
        }
        expect(state.pendingTarget?.kind).toBe("trigger");
        const moves = enumerateMoves(state, botId);
        expect(moves.length).toBeGreaterThan(1);
        const kept = pruneDominatedTriggerTargets(
            state,
            botId,
            moves,
            apply(botId)
        );
        const named = kept.map((m) => {
            if (m.kind !== "submit-target") return m.kind;
            const id = m.targets[0]?.id;
            const card = state.players
                .flatMap((p) => p.battlefield)
                .find((c) => c.id === id);
            return card ? nameOf(card) : id;
        });
        expect(named).toEqual(["Hill Giant"]);
    });
});
