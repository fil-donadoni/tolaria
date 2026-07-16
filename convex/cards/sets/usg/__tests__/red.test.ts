// usg red — Echo (CR 702.30) via Goblin Patrol (#990).
//
// Echo is a NEW keyword this set introduces: the `echoPending` instance flag +
// the `echoTrigger` template (convex/cards/abilities/echo.ts). Per the per-Op /
// new-mechanic test regime (.claude/rules/gre-development.md), the mechanic
// earns a full test here — ETB flag set, the upkeep pay-or-sacrifice both ways,
// the fire-exactly-once intervening-if, and a wire-format re-assert of the
// board-visible outcome (survives / sacrificed).

import { describe, it, expect } from "vitest";
import { goblinPatrol, goblinCadets, arcLightning } from "..";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";

const ECHO_ABILITY = "goblin-patrol-echo";

/** A PHASE_BEGIN UPKEEP trigger event for `playerId`'s upkeep (CR 500.1). */
const upkeepEvent = (playerId: string): StackItem["triggerEvent"] =>
    ({
        type: "PHASE_BEGIN" as const,
        phase: "UPKEEP" as const,
        activePlayerId: playerId,
    }) as StackItem["triggerEvent"];

/** Push the echo trigger onto the stack with the source's upkeep event and
 *  resolve it (mirrors the ice cumulative-upkeep test harness). */
function fireEcho(state: GameState, source: CardInstanceState): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: ECHO_ABILITY,
        triggerSourceId: source.id,
        triggerEvent: upkeepEvent(source.controllerId),
        targets: [],
    });
    resolveTopOfStack(state);
}

/** Answer the head may-pay choice, resuming the suspended resolution. */
function answerMayPay(state: GameState, accept: boolean): void {
    const head = state.pendingChoices![0];
    applyMayPaySubmit(state, { playerId: head.playerId, accept });
}

describe("Goblin Patrol — Echo {R} (CR 702.30)", () => {
    it("is a {R} 2/1 Goblin that declares the echo keyword", () => {
        expect(goblinPatrol.manaCost).toEqual({ R: 1 });
        expect(goblinPatrol.power).toBe(2);
        expect(goblinPatrol.toughness).toBe(1);
        expect(goblinPatrol.subtypes).toContain("Goblin");
        // Keyword census (CR 702.30) — the string drives the ETB echoPending flag.
        expect(goblinPatrol.staticAbilities).toContain("echo");
        // The upkeep trigger is present with the expected id.
        expect(
            (goblinPatrol.triggeredAbilities ?? []).some(
                (t) => t.id === ECHO_ABILITY
            )
        ).toBe(true);
    });

    it("sets echoPending when it enters the battlefield (CR 702.30a)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, goblinPatrol.id, "p1");
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find(
            (c) => (c.card as { id: string }).id === goblinPatrol.id
        )!;
        expect(live).toBeDefined();
        expect(live.echoPending).toBe(true);
    });

    it("declining the echo cost sacrifices it (CR 702.30a) — survives wire", () => {
        const patrol = makeInstance(goblinPatrol.id, {
            id: "patrol",
            controllerId: "p1",
            ownerId: "p1",
            echoPending: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [patrol], manaPool: { R: 1 } }),
                makePlayer("p2"),
            ],
        });
        fireEcho(state, patrol);
        answerMayPay(state, false);
        // Sacrificed to the graveyard.
        expect(
            state.players[0].battlefield.find((c) => c.id === "patrol")
        ).toBeUndefined();
        expect(state.players[0].graveyard.some((c) => c.id === "patrol")).toBe(
            true
        );
        // Wire format — the board-visible sacrifice survives the projection.
        const projected = projectPublicState(state, 1, "p1");
        expect(
            projected.players[0].battlefield.some((c) => c.id === "patrol")
        ).toBe(false);
    });

    it("paying the echo cost keeps it and never re-fires (CR 702.30a)", () => {
        const patrol = makeInstance(goblinPatrol.id, {
            id: "patrol",
            controllerId: "p1",
            ownerId: "p1",
            echoPending: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [patrol], manaPool: { R: 1 } }),
                makePlayer("p2"),
            ],
        });
        fireEcho(state, patrol);
        answerMayPay(state, true);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "patrol"
        )!;
        expect(live).toBeDefined();
        // Paid → flag cleared so echo never re-triggers.
        expect(live.echoPending).toBeUndefined();

        // Second upkeep: the intervening-if is now false → the trigger fizzles
        // with no may-pay prompt, and the creature stays.
        state.players[0].manaPool = { R: 1 };
        fireEcho(state, live);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(
            state.players[0].battlefield.some((c) => c.id === "patrol")
        ).toBe(true);

        // Wire format — the survivor is present in the projected board.
        const projected = projectPublicState(state, 1, "p1");
        expect(
            projected.players[0].battlefield.some((c) => c.id === "patrol")
        ).toBe(true);
    });

    it("does not fire when echoPending is unset (CR 603.4d intervening-if)", () => {
        const patrol = makeInstance(goblinPatrol.id, {
            id: "patrol",
            controllerId: "p1",
            ownerId: "p1",
            // no echoPending — controlled since before the last upkeep
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [patrol], manaPool: { R: 1 } }),
                makePlayer("p2"),
            ],
        });
        fireEcho(state, patrol);
        // Trigger fizzles: no prompt, creature untouched.
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(
            state.players[0].battlefield.some((c) => c.id === "patrol")
        ).toBe(true);
    });
});

const CADETS_ABILITY = "goblin-cadets-donate";

/** Push the donate trigger onto the stack with a BLOCKERS_CONFIRMED event and
 *  resolve it (the pair details are irrelevant to the effect — it acts on
 *  $source; `matches` already gated the pair at collection). */
function fireDonate(
    state: GameState,
    source: CardInstanceState,
    event: StackItem["triggerEvent"]
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: CADETS_ABILITY,
        triggerSourceId: source.id,
        triggerEvent: event,
        targets: [],
    });
    resolveTopOfStack(state);
}

/** A BLOCKERS_CONFIRMED pair event (CR 509.1). */
const blockPair = (
    attackerId: string,
    blockerId: string
): StackItem["triggerEvent"] =>
    ({
        type: "BLOCKERS_CONFIRMED" as const,
        attackerId,
        attackerControllerId: "x",
        attackerTypes: ["Creature"],
        attackerSubtypes: [],
        blockerId,
        blockerControllerId: "x",
        blockerTypes: ["Creature"],
        blockerSubtypes: [],
    }) as StackItem["triggerEvent"];

describe("Goblin Cadets — control-donation drawback (CR 509.1 / 613.1b / 506.4c)", () => {
    it("is a {R} 2/1 Goblin whose trigger donates control to the opponent", () => {
        expect(goblinCadets.manaCost).toEqual({ R: 1 });
        expect(goblinCadets.power).toBe(2);
        expect(goblinCadets.toughness).toBe(1);
        expect(goblinCadets.subtypes).toContain("Goblin");
        const trig = (goblinCadets.triggeredAbilities ?? []).find(
            (t) => t.id === CADETS_ABILITY
        )!;
        expect(trig).toBeDefined();
        expect(trig.event).toBe("BLOCKERS_CONFIRMED");
        // DSL-first: the effect is a gainControl Op to the opponent (no resolve()).
        expect(trig.effects?.[0]).toMatchObject({
            op: "gainControl",
            controller: "opponent",
        });
    });

    it("blocks → opponent gains control and it leaves combat, survives wire", () => {
        // p2 attacks with A; p1's Goblin Cadets blocks it (it "blocks").
        const cadets = makeInstance(goblinCadets.id, {
            id: "cadets",
            controllerId: "p1",
            ownerId: "p1",
            isBlocking: true,
        });
        const attacker = makeInstance(goblinCadets.id, {
            id: "attacker",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const state = makeState({
            activePlayerId: "p2",
            phase: "COMBAT_DAMAGE" as GameState["phase"],
            players: [
                makePlayer("p1", { battlefield: [cadets] }),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
            combat: {
                attackerIds: ["attacker"],
                confirmed: true,
                blockerAssignments: { cadets: ["attacker"] },
                blockedAttackerIds: ["attacker"],
                blockersConfirmed: true,
            },
        });
        fireDonate(state, cadets, blockPair("attacker", "cadets"));

        // Control moved to the opponent (p2): Cadets left p1's battlefield.
        expect(
            state.players[0].battlefield.some((c) => c.id === "cadets")
        ).toBe(false);
        const moved = state.players[1].battlefield.find(
            (c) => c.id === "cadets"
        )!;
        expect(moved).toBeDefined();
        expect(moved.controllerId).toBe("p2");
        // CR 506.4c — removed from combat: no longer a blocker.
        expect(moved.isBlocking).toBeUndefined();
        expect(state.combat!.blockerAssignments["cadets"]).toBeUndefined();

        // Wire format — the donated creature shows on the opponent's board.
        const projected = projectPublicState(state, 1, "p1");
        expect(
            projected.players[0].battlefield.some((c) => c.id === "cadets")
        ).toBe(false);
        expect(
            projected.players[1].battlefield.some((c) => c.id === "cadets")
        ).toBe(true);
    });

    it("becomes blocked → opponent gains control and it leaves combat", () => {
        // p1 attacks with Goblin Cadets; p2 blocks with B (it "becomes blocked").
        const cadets = makeInstance(goblinCadets.id, {
            id: "cadets",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const blocker = makeInstance(goblinCadets.id, {
            id: "blocker",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const state = makeState({
            activePlayerId: "p1",
            phase: "COMBAT_DAMAGE" as GameState["phase"],
            players: [
                makePlayer("p1", { battlefield: [cadets] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
            combat: {
                attackerIds: ["cadets"],
                confirmed: true,
                blockerAssignments: { blocker: ["cadets"] },
                blockedAttackerIds: ["cadets"],
                blockersConfirmed: true,
            },
        });
        fireDonate(state, cadets, blockPair("cadets", "blocker"));

        // Control moved to the opponent (p2).
        const moved = state.players[1].battlefield.find(
            (c) => c.id === "cadets"
        )!;
        expect(moved).toBeDefined();
        expect(moved.controllerId).toBe("p2");
        // CR 506.4c — removed from combat as an attacker in BOTH directions:
        // dropped from attackerIds + blockedAttackerIds, and its blocker no
        // longer points at it (deals/takes no further combat damage).
        expect(moved.isAttacking).toBeUndefined();
        expect(state.combat!.attackerIds).not.toContain("cadets");
        expect(state.combat!.blockedAttackerIds).not.toContain("cadets");
        expect(state.combat!.blockerAssignments["blocker"]).not.toContain(
            "cadets"
        );
    });
});

describe("Arc Lightning ({2}{R} — 3 damage divided as you choose, CR 601.2d / 120.4)", () => {
    it("definitional: any-target, open-ended count, divide total 3", () => {
        expect(arcLightning.manaCost).toEqual({ X: 2, R: 1 });
        expect(arcLightning.types).toEqual(["Sorcery"]);
        expect(arcLightning.targetRequirement?.type).toBe("any");
        expect(arcLightning.targetRequirement?.count).toEqual({ min: 1 });
        expect(arcLightning.targetRequirement?.divideAsChosen).toEqual({
            total: 3,
        });
    });

    it("divides 3 unevenly across two targets from the assigned split", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, arcLightning.id, "p1", [
            { type: "player", id: "p1" },
            { type: "player", id: "p2" },
        ]);
        item.targetAmounts = { "player:p1": 1, "player:p2": 2 };
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(19); // p1 took 1
        expect(state.players[1].life).toBe(18); // p2 took 2
    });

    it("a single target absorbs the whole 3 (auto ≥1-each fallback)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, arcLightning.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(17); // 20 - 3
    });

    it("wire format: the divided damage survives projectPublicState", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, arcLightning.id, "p1", [
            { type: "player", id: "p1" },
            { type: "player", id: "p2" },
        ]);
        item.targetAmounts = { "player:p1": 2, "player:p2": 1 };
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].life).toBe(18); // p1 took 2
        expect(projected.players[1].life).toBe(19); // p2 took 1
    });
});
