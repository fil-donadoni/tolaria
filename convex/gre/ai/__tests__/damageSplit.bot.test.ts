// The Bot's combat-damage split (issue #5662).
//
// `bun run cr 510.1c`: "If two or more creatures are blocking it, it assigns
// its combat damage to those creatures divided as its controller chooses among
// them." `bun run cr 510.1d`: the same freedom for a blocker blocking two or
// more creatures. `bun run cr 702.22k`: with banding the ACTIVE player assigns
// a blocker's damage among the creatures it blocks. `bun run cr 702.19b`:
// trample excess reaches the player only once every blocker has lethal.
// `bun run cr 702.2c`: one deathtouch point is lethal.
//
// Before the policy the Bot confirmed the engine's seed (everything on the
// first live blocker) and the search dropped a multi-blocked attacker's damage
// outright. Every board here is hand-built at the combat damage step with the
// engine's own seed in place, exactly as the step's entry leaves it.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup.helper";
import {
    hillGiant,
    monssGoblinRaiders,
} from "../../../cards/sets/lea/red.cards";
import {
    crawWurm,
    grizzlyBears,
    warMammoth,
} from "../../../cards/sets/lea/green.cards";
import { savannahLions } from "../../../cards/sets/lea/white.cards";
import { questingBeast } from "../../../cards/sets/eld/green.cards";
import type { CardInstanceState, GameState } from "../../state";
import { buildDefaultDamageAssignments } from "../../phases";
import {
    combatDamageAssignmentCompleteness,
    damageAssignmentLethalViolation,
    attackTargetExcessSink,
} from "../../damageAssignment";
import { damageSplitsFor, owedDamageSplits } from "../damageSplit";
import { applyMoveInSearch } from "../../search";
import { evaluateCreature } from "../../evaluate";
import { findPermanent } from "../../lookup";

function permanent(
    defId: string,
    id: string,
    controllerId: string,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return makeInstance(defId, {
        id,
        controllerId,
        ownerId: controllerId,
        isSummoningSick: false,
        ...overrides,
    });
}

/** p1 attacks with `attackers`; p2's `blockers` block per `blocks`
 *  (blockerId → attackerIds). The step is open with the engine's own seed and
 *  `assigners` (sourceId → playerId) recorded, as the step's entry leaves it. */
function damageStep(
    attackers: CardInstanceState[],
    blockers: CardInstanceState[],
    blocks: Record<string, string[]>,
    assigners: Record<string, string>
): GameState {
    const state = makeState({
        phase: "COMBAT_DAMAGE",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: attackers.map((a) => ({
                    ...a,
                    isAttacking: true,
                })),
            }),
            makePlayer("p2", {
                battlefield: blockers.map((b) => ({ ...b, isBlocking: true })),
            }),
        ],
        combat: {
            attackerIds: attackers.map((a) => a.id),
            confirmed: true,
            blockerAssignments: blocks,
            blockersConfirmed: true,
            blockedAttackerIds: attackers.map((a) => a.id),
            damageConfirmed: false,
            damageAssignments: {},
            damageAssignerIds: assigners,
            damageAssignmentConfirmedBy: [],
        },
    });
    state.combat!.damageAssignments = buildDefaultDamageAssignments(
        state,
        "regular"
    );
    return state;
}

/** The split `assignerId` chooses for `sourceId`. */
function splitOf(
    state: GameState,
    assignerId: string,
    sourceId: string
): Record<string, number> | undefined {
    return damageSplitsFor(state, assignerId).find(
        (s) => s.sourceId === sourceId
    )?.assignments;
}

/** The server's own acceptance of a split: no CR 702.19b violation, and the
 *  total equals the source's power (`confirmDamage`'s completeness gate). */
function expectAccepted(
    state: GameState,
    sourceId: string,
    split: Record<string, number>
) {
    const isAttacker = state.combat!.attackerIds.includes(sourceId);
    const sinks = isAttacker
        ? [attackTargetExcessSink(state, sourceId, "p2")]
        : [];
    expect(
        damageAssignmentLethalViolation(state, sourceId, split, sinks)
    ).toBeUndefined();
    expect(
        combatDamageAssignmentCompleteness(state, sourceId, split).complete
    ).toBe(true);
}

/** 3/3 Hill Giant blocked by a 1/1 and a 2/1 — the seed puts all 3 on the
 *  first blocker and kills only it. */
function threeIntoOneOneAndTwoOne(): GameState {
    return damageStep(
        [permanent(hillGiant().id, "atk", "p1")],
        [
            permanent(monssGoblinRaiders().id, "goblin", "p2"),
            permanent(savannahLions().id, "lions", "p2"),
        ],
        { goblin: ["atk"], lions: ["atk"] },
        { atk: "p1" }
    );
}

describe("Bot combat-damage split (issue #5662, CR 510.1c)", () => {
    it("kills both blockers when the damage allows it: 1 to the 1/1, 2 to the 2/1", () => {
        const state = threeIntoOneOneAndTwoOne();
        // The engine's seed is the one the Bot used to confirm unedited.
        expect(state.combat!.damageAssignments!.atk).toEqual({
            goblin: 3,
            lions: 0,
        });
        const split = splitOf(state, "p1", "atk")!;
        expect(split).toEqual({ goblin: 1, lions: 2 });
        expectAccepted(state, "atk", split);
        // It differs from the seed, so the driver owes a submission.
        expect(owedDamageSplits(state, "p1")).toHaveLength(1);
    });

    it("kills the more valuable blocker when it cannot kill both, whatever the declaration order", () => {
        for (const order of [
            ["giant", "goblin"],
            ["goblin", "giant"],
        ]) {
            const cards: Record<string, CardInstanceState> = {
                giant: permanent(hillGiant().id, "giant", "p2"),
                goblin: permanent(monssGoblinRaiders().id, "goblin", "p2"),
            };
            const state = damageStep(
                [permanent(hillGiant().id, "atk", "p1")],
                order.map((id) => cards[id]),
                Object.fromEntries(order.map((id) => [id, ["atk"]])),
                { atk: "p1" }
            );
            const split = splitOf(state, "p1", "atk")!;
            expect(split.giant).toBe(3);
            expect(split.goblin ?? 0).toBe(0);
            expectAccepted(state, "atk", split);
        }
    });

    it("tramples only after lethal on every blocker (CR 702.19b)", () => {
        // 3/3 trample into a 1/1 and a 2/1: lethal is 1 + 1, one point over.
        const state = damageStep(
            [permanent(warMammoth().id, "atk", "p1")],
            [
                permanent(monssGoblinRaiders().id, "goblin", "p2"),
                permanent(savannahLions().id, "lions", "p2"),
            ],
            { goblin: ["atk"], lions: ["atk"] },
            { atk: "p1" }
        );
        const split = splitOf(state, "p1", "atk")!;
        expect(split).toEqual({ goblin: 1, lions: 1, p2: 1 });
        expectAccepted(state, "atk", split);
    });

    it("sends nothing to the player when not every blocker can get lethal (CR 702.19b)", () => {
        // 3/3 trample into a 3/3 and a 1/1: lethal is 3 + 1 > 3.
        const state = damageStep(
            [permanent(warMammoth().id, "atk", "p1")],
            [
                permanent(hillGiant().id, "giant", "p2"),
                permanent(monssGoblinRaiders().id, "goblin", "p2"),
            ],
            { giant: ["atk"], goblin: ["atk"] },
            { atk: "p1" }
        );
        const split = splitOf(state, "p1", "atk")!;
        expect(split.p2 ?? 0).toBe(0);
        expect(split.giant).toBe(3);
        expectAccepted(state, "atk", split);
    });

    it("keeps leftover damage off the player when the kill set is partial (CR 702.19b)", () => {
        // 3/3 trample into a 6/4 and a 1/1: it kills the 1/1 (lethal 1) and
        // cannot kill the 6/4 (lethal 4), so the 2 left over stay on a
        // blocker — the player may not receive any while the 6/4 is short.
        const state = damageStep(
            [permanent(warMammoth().id, "atk", "p1")],
            [
                permanent(crawWurm().id, "wurm", "p2"),
                permanent(monssGoblinRaiders().id, "goblin", "p2"),
            ],
            { wurm: ["atk"], goblin: ["atk"] },
            { atk: "p1" }
        );
        const split = splitOf(state, "p1", "atk")!;
        expect(split).toEqual({ wurm: 2, goblin: 1 });
        expectAccepted(state, "atk", split);
    });

    it("uses deathtouch: one point is lethal per blocker (CR 702.2c)", () => {
        // 4/4 deathtouch into a 3/3 and a 6/4 — without deathtouch it could
        // kill only the 3/3.
        const state = damageStep(
            [permanent(questingBeast().id, "atk", "p1")],
            [
                permanent(hillGiant().id, "giant", "p2"),
                permanent(crawWurm().id, "wurm", "p2"),
            ],
            { giant: ["atk"], wurm: ["atk"] },
            { atk: "p1" }
        );
        const split = splitOf(state, "p1", "atk")!;
        expect(split.giant).toBeGreaterThanOrEqual(1);
        expect(split.wurm).toBeGreaterThanOrEqual(1);
        expect(split.giant + split.wurm).toBe(4);
        expectAccepted(state, "atk", split);
    });

    it("counts damage already marked on a blocker", () => {
        // The 3/3 already carries 2: 1 more is lethal, so a 3/3 attacker kills
        // both it and the 2/2 (1 + 2). Read at raw toughness it would kill one.
        const state = damageStep(
            [permanent(hillGiant().id, "atk", "p1")],
            [
                permanent(hillGiant().id, "giant", "p2", { damageMarked: 2 }),
                permanent(grizzlyBears().id, "bears", "p2"),
            ],
            { giant: ["atk"], bears: ["atk"] },
            { atk: "p1" }
        );
        expect(splitOf(state, "p1", "atk")).toEqual({ giant: 1, bears: 2 });
    });

    it("assigns a blocker's damage among the creatures it blocks by the same policy (CR 510.1d)", () => {
        // p2's 3/3 blocks a 2/2 and a 2/1: 2 + 1 kills both.
        const state = damageStep(
            [
                permanent(grizzlyBears().id, "bears", "p1"),
                permanent(savannahLions().id, "lions", "p1"),
            ],
            [permanent(hillGiant().id, "giant", "p2")],
            { giant: ["bears", "lions"] },
            { giant: "p2" }
        );
        const split = splitOf(state, "p2", "giant")!;
        expect(split).toEqual({ bears: 2, lions: 1 });
        expectAccepted(state, "giant", split);
    });

    it("kills as little as possible when it assigns onto its OWN creatures (CR 702.22k)", () => {
        // The same block, but the active player p1 assigns the blocker's
        // damage (banding): 3 damage over a 2/2 and a 2/1 must kill one, and
        // the other soaks one below its lethal.
        const state = damageStep(
            [
                permanent(grizzlyBears().id, "bears", "p1"),
                permanent(savannahLions().id, "lions", "p1"),
            ],
            [permanent(hillGiant().id, "giant", "p2")],
            { giant: ["bears", "lions"] },
            { giant: "p1" }
        );
        const split = splitOf(state, "p1", "giant")!;
        const lethal: Record<string, number> = { bears: 2, lions: 1 };
        const dead = Object.keys(lethal).filter(
            (id) => (split[id] ?? 0) >= lethal[id]
        );
        expect(split.bears + split.lions).toBe(3);
        // The one given up is the LESS valuable of the two, by the same
        // valuation the policy reads.
        const value = (id: string) =>
            evaluateCreature(state, findPermanent(state, id)!);
        expect(value("bears")).not.toBe(value("lions"));
        const cheaper = value("bears") < value("lions") ? "bears" : "lions";
        expect(dead).toEqual([cheaper]);
    });
});

describe("search-side combat damage (issue #5662)", () => {
    it("deals a multi-blocked attacker's damage by the split instead of dropping it", () => {
        const state = threeIntoOneOneAndTwoOne();
        applyMoveInSearch(state, "p1", { kind: "pass" });
        const p2 = state.players[1];
        expect(p2.battlefield.map((c) => c.id)).toEqual([]);
        expect(p2.graveyard.map((c) => c.id).sort()).toEqual([
            "goblin",
            "lions",
        ]);
    });
});
