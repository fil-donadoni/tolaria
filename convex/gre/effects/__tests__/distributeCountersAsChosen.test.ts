// `distributeCountersAsChosen` — the Op's permanent test (CR 601.2d / 122.1).
//
// Driven through the real entry points: the spell is pushed and resolved by
// `resolveTopOfStack`, the delayed take-back fires through `advancePhase` into
// CLEANUP (CR 514.3a). Construct combinations covered: the Op's
// picks `bind`, read by a `delayedTrigger` list capture and walked by a
// `forEach` over the captured list in the delayed body.

import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../../cards/registry";
import type { CardDefinition, EffectOp } from "../../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../cards/__tests__/setup.helper";
import { getDefinition } from "../../../cards/index";
import { advancePhase } from "../../phases";
import { resolveTopOfStack, type GameState } from "../../state";
import { getEffectivePower } from "../../layers";
import { projectPublicState } from "../../../gameProjections";

const grizzlyBears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");
// Michelangelo, Weirdness to 11 — a CR 614 counter-placement replacement
// ("that many plus one +1/+1 counters are put on it instead").
const michelangelo = getDefinition("18477047-218d-4b2a-a086-37431b6a3025");

const DISTRIBUTE: EffectOp = {
    op: "distributeCountersAsChosen",
    counter: "+1/+1",
    total: 3,
    bind: "$placed",
};

const TAKE_BACK: EffectOp = {
    op: "delayedTrigger",
    timing: "next-cleanup-step",
    oracleText:
        "For each +1/+1 counter you put on a creature this way, remove a +1/+1 counter from that creature at the beginning of the next cleanup step.",
    capture: { $placed: { select: { set: "bound", ref: "$placed" } } },
    effects: [
        {
            op: "forEach",
            select: { set: "bound", ref: "$placed" },
            effects: [
                {
                    op: "counters",
                    action: "remove",
                    counter: "+1/+1",
                    target: { ref: "$each" },
                    count: 1,
                },
            ],
        },
    ],
};

function spellDef(effects: EffectOp[]): CardDefinition {
    return {
        id: "test-distribute-counters",
        name: "Distribute Probe",
        rarity: "common",
        oracleText: "",
        manaCost: { G: 1 },
        types: ["Instant"],
        targetRequirement: {
            type: "Creature",
            count: { min: 1, max: 3 },
            divideAsChosen: { total: 3, kind: "counters" },
        },
        effects,
    } as CardDefinition;
}

function bears(id: string, controllerId = "p1") {
    return makeInstance(grizzlyBears.id, {
        id,
        controllerId,
        ownerId: controllerId,
    });
}

function board(extra: ReturnType<typeof makeInstance>[] = []): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [bears("bearA"), bears("bearB"), ...extra],
            }),
            makePlayer("p2"),
        ],
    });
}

const counters = (state: GameState, id: string) =>
    state.players.flatMap((p) => p.battlefield).find((c) => c.id === id)
        ?.counters?.["+1/+1"] ?? 0;

function cast(
    state: GameState,
    definitionId: string,
    split: Record<string, number>
) {
    const item = pushSpell(
        state,
        definitionId,
        "p1",
        Object.keys(split).map((id) => ({ type: "permanent", id }))
    );
    item.targetAmounts = Object.fromEntries(
        Object.entries(split).map(([id, n]) => [`permanent:${id}`, n])
    );
    resolveTopOfStack(state);
}

/** END_STEP → CLEANUP through the real phase machine (CR 514.3a), then the
 *  delayed take-back resolves. */
function reachCleanup(state: GameState) {
    state.phase = "END_STEP";
    expect(advancePhase(state)).toEqual(["CLEANUP"]);
    expect(state.stack).toHaveLength(1);
    resolveTopOfStack(state);
}

describe("distributeCountersAsChosen (CR 601.2d / 122.1)", () => {
    it("puts the announced split on each target", () => {
        const def = spellDef([DISTRIBUTE]);
        withTemporaryDefinition(def, () => {
            const state = board();
            cast(state, def.id, { bearA: 2, bearB: 1 });
            expect(counters(state, "bearA")).toBe(2);
            expect(counters(state, "bearB")).toBe(1);
            expect(
                getEffectivePower(state, state.players[0].battlefield[0])
            ).toBe(4);
        });
    });

    it("a target that left loses only its own share (CR 608.2b)", () => {
        const def = spellDef([DISTRIBUTE]);
        withTemporaryDefinition(def, () => {
            const state = board();
            const item = pushSpell(state, def.id, "p1", [
                { type: "permanent", id: "bearA" },
                { type: "permanent", id: "bearB" },
            ]);
            item.targetAmounts = {
                "permanent:bearA": 1,
                "permanent:bearB": 2,
            };
            state.players[0].battlefield = state.players[0].battlefield.filter(
                (c) => c.id !== "bearB"
            );
            resolveTopOfStack(state);
            expect(counters(state, "bearA")).toBe(1);
        });
    });

    it("the delayed take-back removes, per creature, exactly the counters put on this way (CR 603.7a)", () => {
        const def = spellDef([DISTRIBUTE, TAKE_BACK]);
        withTemporaryDefinition(def, () => {
            const state = board();
            // A counter that was already there is not one put on this way.
            state.players[0].battlefield[1].counters = { "+1/+1": 1 };
            cast(state, def.id, { bearA: 2, bearB: 1 });
            expect(counters(state, "bearA")).toBe(2);
            expect(counters(state, "bearB")).toBe(2);
            expect(state.delayedTriggers?.[0]?.timing).toBe(
                "next-cleanup-step"
            );
            reachCleanup(state);
            expect(counters(state, "bearA")).toBe(0);
            expect(counters(state, "bearB")).toBe(1);
        });
    });

    it("a creature that left before the cleanup step is skipped (CR 603.7c)", () => {
        const def = spellDef([DISTRIBUTE, TAKE_BACK]);
        withTemporaryDefinition(def, () => {
            const state = board();
            cast(state, def.id, { bearA: 2, bearB: 1 });
            state.players[0].battlefield = state.players[0].battlefield.filter(
                (c) => c.id !== "bearA"
            );
            reachCleanup(state);
            expect(counters(state, "bearB")).toBe(0);
        });
    });

    it("binds what a CR 614 replacement actually put on, so the take-back matches it", () => {
        const def = spellDef([DISTRIBUTE, TAKE_BACK]);
        withTemporaryDefinition(def, () => {
            const state = board([
                makeInstance(michelangelo.id, {
                    id: "mike",
                    controllerId: "p1",
                    ownerId: "p1",
                }),
            ]);
            // Michelangelo adds one to each placement: 2 → 3, 1 → 2.
            cast(state, def.id, { bearA: 2, bearB: 1 });
            expect(counters(state, "bearA")).toBe(3);
            expect(counters(state, "bearB")).toBe(2);
            reachCleanup(state);
            expect(counters(state, "bearA")).toBe(0);
            expect(counters(state, "bearB")).toBe(0);
        });
    });

    it("the placed counters cross the wire (projectPublicState)", () => {
        const def = spellDef([DISTRIBUTE]);
        withTemporaryDefinition(def, () => {
            const state = board();
            cast(state, def.id, { bearA: 1, bearB: 2 });
            const projected = projectPublicState(state, 1, "p2");
            const slim = projected.players[0].battlefield.find(
                (c) => c.id === "bearB"
            )!;
            expect(slim.counters).toEqual({ "+1/+1": 2 });
            expect(getEffectivePower(projected, slim)).toBe(4);
        });
    });
});
