// Effect Script grammar added by issue #3244 — the permanent tests each new
// member earns under the per-Op regime (`.claude/rules/gre-development.md`
// § DSL-first authoring). Nothing here names the card that needed them.
//
//  - `setSize` (CR 107.3 / 118.12) — HOW MANY ids a picks binding holds: the X
//    of a resolution-time "tap X untapped <things>" cost.
//  - `dealDamage.to: { attackTargetOf }` (CR 506.2 / 508.1b / 506.4) — the
//    player or planeswalker an attacking creature is attacking, untargeted.
//  - `EffectCardFilter.tapped` (CR 110.5 / 701.26a) — the tapped status, a
//    battlefield-only filter field gated like `isAttacking`.

import { describe, it, expect } from "vitest";
import type { EffectOp } from "../../../cards/types";
import { registerTokenDefinition } from "../../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup";
import {
    resolveTopOfStack,
    applyControlChange,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../state";
import { applyPendingChoiceSubmit } from "../../pendingChoiceSubmit";
import { getEffectivePower } from "../../layers";
import { validateAbilityEffectScript } from "../validate";

const SOLDIER_ID = "test-3244-soldier";
registerTokenDefinition({
    id: SOLDIER_ID,
    name: SOLDIER_ID,
    rarity: "common",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Soldier"],
    power: 1,
    toughness: 1,
});

const WALKER_ID = "test-3244-walker";
registerTokenDefinition({
    id: WALKER_ID,
    name: WALKER_ID,
    rarity: "common",
    manaCost: { U: 1 },
    types: ["Planeswalker"],
});

/** "Whenever this creature attacks, you may tap X untapped Soldiers you
 *  control. It gets +X/+0 and deals X damage to what it is attacking." — the
 *  full shape, on a test host. */
const TAP_X_SCRIPT: EffectOp[] = [
    {
        op: "choice",
        kind: "choose-permanents",
        player: "controller",
        zone: "battlefield",
        filter: { subtype: "Soldier", tapped: false },
        count: { min: 0, max: Number.MAX_SAFE_INTEGER },
        prompt: "Tap any number of untapped Soldiers you control.",
        bind: "$tapped",
    },
    {
        op: "forEach",
        select: { set: "bound", ref: "$tapped" },
        effects: [{ op: "tapUntap", action: "tap", target: { ref: "$each" } }],
    },
    {
        op: "pump",
        target: { ref: "$source" },
        power: { setSize: { of: { ref: "$tapped" } } },
        toughness: 0,
        duration: { phase: "end-of-turn" },
    },
    {
        op: "dealDamage",
        amount: { setSize: { of: { ref: "$tapped" } } },
        to: { attackTargetOf: { ref: "$source" } },
    },
];

const HOST_ID = "test-3244-host";
registerTokenDefinition({
    id: HOST_ID,
    name: HOST_ID,
    rarity: "common",
    manaCost: { X: 5 },
    types: ["Creature"],
    subtypes: ["Soldier"],
    power: 4,
    toughness: 7,
    triggeredAbilities: [
        {
            id: "test-3244-host-attack",
            event: ["ATTACKERS_DECLARED"],
            effects: TAP_X_SCRIPT,
        },
    ],
});

function soldier(id: string, extra: Partial<CardInstanceState> = {}) {
    return makeInstance(SOLDIER_ID, { id, ...extra });
}

/** p1's `host` attacks (tapped — it attacked), with soldiers s1 (untapped,
 *  ATTACKING alongside it), s2 (untapped, home) and s3 (already tapped). p2
 *  controls a planeswalker `pw` with 5 loyalty. */
function attackingState(attackTargets?: Record<string, string>): GameState {
    const host = makeInstance(HOST_ID, {
        id: "host",
        isTapped: true,
        isAttacking: true,
    });
    const state = makeState({
        phase: "DECLARE_ATTACKERS" as GameState["phase"],
        players: [
            makePlayer("p1", {
                battlefield: [
                    host,
                    soldier("s1", { isAttacking: true }),
                    soldier("s2"),
                    soldier("s3", { isTapped: true }),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(WALKER_ID, {
                        id: "pw",
                        controllerId: "p2",
                        ownerId: "p2",
                        counters: { loyalty: 5 },
                    }),
                ],
            }),
        ],
    });
    state.combat = {
        attackerIds: ["host", "s1"],
        confirmed: true,
        blockerAssignments: {},
        ...(attackTargets ? { attackTargets } : {}),
    };
    return state;
}

/** Puts the host's attack trigger on the stack and resolves it up to its
 *  choice. */
function triggerHost(state: GameState): void {
    const host = state.players[0].battlefield.find((c) => c.id === "host")!;
    const item: StackItem = {
        ...host,
        zone: "stack",
        castById: "p1",
        triggeredAbilityId: "test-3244-host-attack",
        triggerSourceId: "host",
        triggerEvent: {
            type: "ATTACKERS_DECLARED",
            attackingPlayerId: "p1",
            attackerIds: ["host", "s1"],
        } as StackItem["triggerEvent"],
        targets: [],
    };
    state.stack.push(item);
    resolveTopOfStack(state);
}

function pick(state: GameState, ids: string[]): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: ids,
    });
}

const perm = (state: GameState, id: string) =>
    state.players.flatMap((p) => p.battlefield).find((c) => c.id === id)!;

describe("tapped filter + setSize: tap X, X is how many were picked (CR 118.12 / 701.26a)", () => {
    it("offers only UNTAPPED matches, attacking or not (CR 701.26a)", () => {
        const state = attackingState();
        triggerHost(state);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("choose-permanents");
        // The status filter crossed onto the PendingChoice — the ONE record
        // the submit re-check, the client highlight and the Bot's candidate
        // pool all read. `host` is a Soldier too, but it attacked (tapped).
        expect(head.filter?.tapped).toBe(false);
        expect(() => pick(state, ["s3"])).toThrow();
        expect(() => pick(state, ["host"])).toThrow();
    });

    it("X = picks: taps each, +X/+0, X damage to the defending player", () => {
        const state = attackingState();
        triggerHost(state);
        pick(state, ["s1", "s2"]);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(perm(state, "s1").isTapped).toBe(true);
        expect(perm(state, "s2").isTapped).toBe(true);
        expect(getEffectivePower(state, perm(state, "host"))).toBe(6);
        expect(state.players[1].life).toBe(18);
        expect(perm(state, "pw").counters?.loyalty).toBe(5);
    });

    it("tapping an attacking creature does not remove it from combat (CR 506.4)", () => {
        const state = attackingState();
        triggerHost(state);
        pick(state, ["s1"]);
        expect(perm(state, "s1").isTapped).toBe(true);
        expect(perm(state, "s1").isAttacking).toBe(true);
        expect(state.combat!.attackerIds).toContain("s1");
    });

    it("X = 0 is a legal pick: nothing tapped, +0/+0, no damage", () => {
        const state = attackingState();
        triggerHost(state);
        pick(state, []);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(perm(state, "s2").isTapped).toBe(false);
        expect(getEffectivePower(state, perm(state, "host"))).toBe(4);
        expect(state.players[1].life).toBe(20);
        expect(state.stack).toHaveLength(0);
    });

    it("an UNCAPTURED binding (no candidates at all) reads as the number 0, not unresolvable", () => {
        // Only a comparison tells 0 from undefined: an unresolvable operand
        // makes the predicate false (CR 608.2b), a genuine 0 satisfies `lt 1`.
        const PROBE_ID = "test-3244-setsize-zero";
        registerTokenDefinition({
            id: PROBE_ID,
            name: PROBE_ID,
            rarity: "common",
            manaCost: { R: 1 },
            types: ["Sorcery"],
            effects: [
                {
                    op: "choice",
                    kind: "choose-permanents",
                    player: "controller",
                    zone: "battlefield",
                    filter: { subtype: "Nothing-Has-This" },
                    count: { min: 0, max: Number.MAX_SAFE_INTEGER },
                    prompt: "Pick.",
                    bind: "$none",
                },
                {
                    op: "if",
                    predicate: {
                        left: { setSize: { of: { ref: "$none" } } },
                        op: "lt",
                        right: 1,
                    },
                    then: [{ op: "gainLife", player: "controller", amount: 3 }],
                },
            ],
        });
        const state = makeState();
        state.stack.push({
            ...makeInstance(PROBE_ID, { zone: "hand" }),
            castById: "p1",
            targets: [],
        });
        resolveTopOfStack(state);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].life).toBe(23);
    });
});

describe("dealDamage to { attackTargetOf } (CR 506.2 / 508.1b / 506.4)", () => {
    it("routes to the attacked PLANESWALKER, not its controller (CR 120.3c)", () => {
        const state = attackingState({ host: "pw" });
        triggerHost(state);
        pick(state, ["s1", "s2"]);
        expect(perm(state, "pw").counters?.loyalty).toBe(3);
        expect(state.players[1].life).toBe(20);
    });

    it("a creature removed from combat before resolution deals nothing (CR 506.4)", () => {
        const state = attackingState();
        state.combat!.attackerIds = ["s1"];
        perm(state, "host").isAttacking = undefined;
        triggerHost(state);
        pick(state, ["s2"]);
        // The pump still happens — only the damage has no recipient.
        expect(getEffectivePower(state, perm(state, "host"))).toBe(5);
        expect(state.players[1].life).toBe(20);
        expect(perm(state, "pw").counters?.loyalty).toBe(5);
    });

    it("a planeswalker that changed controller was removed from combat: no damage, no fallback to the player (CR 506.4)", () => {
        const state = attackingState({ host: "pw" });
        applyControlChange(state, "pw", "p1", "host");
        triggerHost(state);
        pick(state, ["s2"]);
        expect(perm(state, "pw").counters?.loyalty).toBe(5);
        expect(state.players[1].life).toBe(20);
    });

    it("a planeswalker that left the battlefield: no damage, no fallback to the player (CR 506.4)", () => {
        const state = attackingState({ host: "pw" });
        state.players[1].battlefield = [];
        triggerHost(state);
        pick(state, ["s2"]);
        expect(state.players[1].life).toBe(20);
    });
});

describe("validator: the new members are accepted exactly where they are honest", () => {
    const host = (effects: EffectOp[]) =>
        validateAbilityEffectScript(
            { id: "test-3244-validate", effects },
            "test-3244-validate",
            "ATTACKERS_DECLARED"
        );

    it("accepts the whole tap-X script", () => {
        expect(host(TAP_X_SCRIPT)).toEqual([]);
    });

    it("rejects `filter.tapped` off the battlefield (a hidden-zone card has no status)", () => {
        const errors = host([
            {
                op: "choice",
                kind: "choose-graveyard-card",
                player: "controller",
                zone: "graveyard",
                filter: { tapped: false },
                count: 1,
                prompt: "Pick.",
                bind: "$g",
            },
        ]);
        expect(errors.join("\n")).toMatch(/filter\.tapped/);
    });

    it("rejects `setSize` over an OBJECT binding (it reads a picks set)", () => {
        const errors = host([
            {
                op: "tapUntap",
                action: "tap",
                target: { ref: "$source" },
                bind: "$obj",
            } as EffectOp,
            {
                op: "gainLife",
                player: "controller",
                amount: { setSize: { of: { ref: "$obj" } } },
            },
        ]);
        expect(errors).not.toEqual([]);
    });

    it("rejects `attackTargetOf` anywhere but a damage recipient", () => {
        const errors = host([
            {
                op: "destroy",
                target: { attackTargetOf: { ref: "$source" } },
            } as unknown as EffectOp,
        ]);
        expect(errors).not.toEqual([]);
    });
});
