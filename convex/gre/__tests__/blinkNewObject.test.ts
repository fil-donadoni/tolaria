// A blinked permanent is a NEW object (CR 400.7), issue #6333.
//
// CR 400.7 — "An object that moves from one zone to another becomes a new
// object with no memory of or relation to its previous existence." The engine
// never reallocates an instance id, so a permanent that leaves the battlefield
// and comes back (Ephemerate) sits under the SAME id. Two references held
// OUTSIDE the instance must still see the departure:
//
// - a stack target (CR 608.2b — "A target that's no longer in the zone it was
//   in when it was targeted is illegal"): the removal a blink answers must not
//   resolve on the returned object;
// - the combat record (CR 506.4 — "A permanent is removed from combat if it
//   leaves the battlefield"): a blinked attacker comes back out of combat, and
//   a blinked blocker leaves its attacker blocked (CR 509.1h).
//
// Last-known reads of a departed attacker's combat target (CR 608.2h) keep
// their own test in `effects/__tests__/attackTargetSetSize.test.ts`.

import { describe, it, expect } from "vitest";
import type { CardInstanceState, GameState } from "../state";
import {
    putReanimatedSetOnBattlefield,
    removePermanentTo,
    resolveTopOfStack,
} from "../state";
import { resolveCombatDamage } from "../applyMove";
import { advancePhase } from "../phases";
import { getEffectiveBlockGraph } from "../banding";
import { buildStateView } from "../replacements";
import { checkStateBasedActions } from "../sba";
import { buildStateFromScenario } from "../scenarioBuilder";
import { compactState, expandState } from "../serialize";
import { makePlayer, makeState } from "../../cards/__tests__/setup.helper";
import type { ScenarioSpec } from "../../debugScenarioSpec";
import type { CardDefinition } from "../../cards/types";
import { getDefinition } from "../../cards";
import { withTemporaryDefinition } from "../../cards/registry";
import { lightningBolt } from "../../cards/sets/lea/red.cards";

function build(spec: ScenarioSpec): GameState {
    return buildStateFromScenario(
        makeState({ players: [makePlayer("p1"), makePlayer("p2")] }),
        spec
    );
}

function nameOf(card: CardInstanceState): string | undefined {
    return getDefinition(card.card.id)?.name;
}

function permanentNamed(
    state: GameState,
    name: string
): CardInstanceState | undefined {
    for (const p of state.players) {
        const card = p.battlefield.find((c) => nameOf(c) === name);
        if (card) return card;
    }
    return undefined;
}

function idOf(state: GameState, name: string): string {
    const card = permanentNamed(state, name);
    if (!card) throw new Error(`${name} is not on the battlefield`);
    return card.id;
}

/** A blink through the two production funnels — `removePermanentTo` (the
 *  single battlefield-departure funnel) to exile, then the reanimation entry
 *  path back — under the SAME instance id, the shape every blink produces. */
function blink(state: GameState, instanceId: string): void {
    const left = removePermanentTo(state, instanceId, "exile");
    expect(left).not.toBeNull();
    const owner = state.players.find((p) => p.id === left!.ownerId)!;
    const idx = owner.exile.findIndex((c) => c.id === instanceId);
    const [card] = owner.exile.splice(idx, 1);
    putReanimatedSetOnBattlefield(state, [
        { card, controllerId: card.ownerId },
    ]);
}

describe("a blinked target is illegal on resolution (CR 400.7 / 608.2b)", () => {
    const BOLT_THEN_EPHEMERATE: ScenarioSpec = {
        cards: [
            { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
            { name: "Mountain", owner: "opp", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        stack: [
            {
                kind: "spell",
                name: "Lightning Bolt",
                controller: "opp",
                targets: [
                    { kind: "permanent", name: "Grizzly Bears", seat: "me" },
                ],
            },
            {
                kind: "spell",
                name: "Ephemerate",
                controller: "me",
                targets: [
                    { kind: "permanent", name: "Grizzly Bears", seat: "me" },
                ],
            },
        ],
    };

    it("Lightning Bolt on a creature blinked by Ephemerate in response does not resolve; the creature lives", () => {
        const state = build(BOLT_THEN_EPHEMERATE);
        const bears = idOf(state, "Grizzly Bears");

        resolveTopOfStack(state); // Ephemerate: exile, then return
        // Precondition — the returned Bears really are under the SAME id, so
        // a zone-existence lookup alone would find the Bolt's target.
        expect(idOf(state, "Grizzly Bears")).toBe(bears);
        expect(state.stack).toHaveLength(1);

        resolveTopOfStack(state); // Lightning Bolt: every target illegal
        checkStateBasedActions(state);

        const returned = permanentNamed(state, "Grizzly Bears");
        expect(returned).toBeDefined();
        expect(returned!.damageMarked ?? 0).toBe(0);
        expect(state.stack).toHaveLength(0);
        // The Bolt left the stack countered by the rules (CR 608.2b).
        const opp = state.players[1];
        expect(opp.graveyard.some((c) => nameOf(c) === "Lightning Bolt")).toBe(
            true
        );
    });

    it("the departure survives a save/load round trip between the blink and the Bolt", () => {
        const state = build(BOLT_THEN_EPHEMERATE);
        resolveTopOfStack(state);
        const reloaded = expandState(compactState(state));

        resolveTopOfStack(reloaded);
        checkStateBasedActions(reloaded);

        expect(permanentNamed(reloaded, "Grizzly Bears")).toBeDefined();
        expect(
            permanentNamed(reloaded, "Grizzly Bears")!.damageMarked ?? 0
        ).toBe(0);
    });
});

describe("a spell with one blinked target still affects the other (CR 608.2b)", () => {
    // "deals 3 damage to each of two target creatures" — a two-slot variant
    // of Lightning Bolt (no such card ships in the pool), so CR 608.2b's
    // partial clause has two permanent slots to tell apart.
    const twinBolt: CardDefinition = {
        ...lightningBolt(),
        targetRequirement: { type: "Creature", count: 2 },
        effects: [
            { op: "dealDamage", amount: 3, to: { target: 0 } },
            { op: "dealDamage", amount: 3, to: { target: 1 } },
        ],
    };

    it("the blinked slot is skipped, the other slot resolves", () => {
        withTemporaryDefinition(twinBolt, () => {
            const state = build({
                cards: [
                    { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                    {
                        name: "Savannah Lions",
                        owner: "me",
                        zone: "battlefield",
                    },
                ],
                phase: "PRECOMBAT_MAIN",
                stack: [
                    {
                        kind: "spell",
                        name: "Lightning Bolt",
                        controller: "opp",
                        targets: [
                            {
                                kind: "permanent",
                                name: "Savannah Lions",
                                seat: "me",
                            },
                            {
                                kind: "permanent",
                                name: "Grizzly Bears",
                                seat: "me",
                            },
                        ],
                    },
                ],
            });
            blink(state, idOf(state, "Savannah Lions"));

            resolveTopOfStack(state);
            checkStateBasedActions(state);

            // Slot 0 — the blinked Lions — was skipped…
            expect(permanentNamed(state, "Savannah Lions")).toBeDefined();
            expect(
                permanentNamed(state, "Savannah Lions")!.damageMarked ?? 0
            ).toBe(0);
            // …and slot 1 still resolved: the Bears took 3 and died.
            expect(permanentNamed(state, "Grizzly Bears")).toBeUndefined();
            expect(state.stack).toHaveLength(0);
        });
    });
});

describe("leaving the battlefield removes a permanent from combat (CR 506.4)", () => {
    function blockedCombat(
        blockerName: string,
        stack: ScenarioSpec["stack"] = []
    ): GameState {
        return build({
            cards: [
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: blockerName,
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackers: ["Grizzly Bears"],
                confirmed: true,
                blockers: [{ blocker: blockerName, blocking: [0] }],
                blockersConfirmed: true,
            },
            stack,
        });
    }

    it("an attacker blinked after blocks comes back out of combat, and deals and takes no combat damage", () => {
        const state = blockedCombat("Hill Giant");
        const bears = idOf(state, "Grizzly Bears");
        const giant = idOf(state, "Hill Giant");

        blink(state, bears);

        expect(state.combat!.attackerIds).not.toContain(bears);
        expect(state.combat!.blockedAttackerIds ?? []).not.toContain(bears);
        expect(state.combat!.blockerAssignments[giant]).not.toContain(bears);
        expect(permanentNamed(state, "Grizzly Bears")!.isAttacking).toBeFalsy();

        // The combat damage steps, assignments derived from the record the
        // phase machine reads: nothing in combat is left to deal or take it.
        resolveCombatDamage(state);

        const returned = permanentNamed(state, "Grizzly Bears");
        expect(returned).toBeDefined();
        expect(returned!.damageMarked ?? 0).toBe(0);
        expect(permanentNamed(state, "Hill Giant")!.damageMarked ?? 0).toBe(0);
    });

    it("Ephemerate on the blocked attacker removes it from combat through the real resolution path", () => {
        const state = blockedCombat("Hill Giant", [
            {
                kind: "spell",
                name: "Ephemerate",
                controller: "me",
                targets: [
                    { kind: "permanent", name: "Grizzly Bears", seat: "me" },
                ],
            },
        ]);
        const bears = idOf(state, "Grizzly Bears");

        resolveTopOfStack(state);

        expect(idOf(state, "Grizzly Bears")).toBe(bears);
        expect(state.combat!.attackerIds).not.toContain(bears);
        expect(permanentNamed(state, "Grizzly Bears")!.isAttacking).toBeFalsy();
    });

    it("a blinked BLOCKER leaves the attacker blocked (CR 509.1h): no damage to the defending player, none to the returned blocker", () => {
        const state = blockedCombat("Hill Giant");
        const bears = idOf(state, "Grizzly Bears");
        const giant = idOf(state, "Hill Giant");
        const oppLife = state.players[1].life;

        blink(state, giant);

        expect(state.combat!.blockerAssignments[giant]).toBeUndefined();
        expect(state.combat!.blockedAttackerIds).toContain(bears);
        expect(permanentNamed(state, "Hill Giant")!.isBlocking).toBeFalsy();

        // A blocked attacker with no blocker left and no trample assigns
        // nothing (CR 510.1c).
        resolveCombatDamage(state);

        expect(state.players[1].life).toBe(oppLife);
        expect(permanentNamed(state, "Hill Giant")!.damageMarked ?? 0).toBe(0);
    });

    it("the combat steps a declared attack owes still happen when its only attacker has left (CR 508.8)", () => {
        // CR 508.8 skips the rest of combat only when NO creature was declared
        // as an attacker; retiring the departed one from `attackerIds` must
        // not read as "nobody attacked" and jump straight to the second main
        // phase past the combat damage and end of combat steps.
        const state = blockedCombat("Hill Giant");
        blink(state, idOf(state, "Grizzly Bears"));
        expect(state.combat!.attackerIds).not.toContain(
            idOf(state, "Grizzly Bears")
        );

        const traversed = advancePhase(state);

        expect(traversed).toContain("COMBAT_DAMAGE");
        expect(state.phase).not.toBe("POSTCOMBAT_MAIN");
    });

    it("a departed co-blocker still counts in the combat's history: the attacker had become blocked by two (CR 509.1h)", () => {
        // False Orders / Ydwen Efreet ("had become blocked by only that
        // creature") and Veteran Bodyguard ("unblocked creatures") read the
        // block graph; a blocker that left keeps its edge there, under an id
        // nothing on the battlefield answers to, exactly as a dead one does.
        const state = build({
            cards: [
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Hill Giant",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Savannah Lions",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackers: ["Grizzly Bears"],
                confirmed: true,
                blockers: [
                    { blocker: "Hill Giant", blocking: [0] },
                    { blocker: "Savannah Lions", blocking: [0] },
                ],
                blockersConfirmed: true,
            },
        });
        const bears = idOf(state, "Grizzly Bears");
        const lions = idOf(state, "Savannah Lions");

        blink(state, lions);

        const blockers =
            getEffectiveBlockGraph(state).blockersByAttacker[bears];
        expect(blockers).toHaveLength(2);
        expect(blockers).not.toContain(lions);
        expect(
            buildStateView(state).combat!.blockersByAttacker[bears]
        ).toHaveLength(2);
    });

    it("a blinked PLANESWALKER being attacked comes back out of combat: its attacker attacks nothing and deals no damage (CR 506.4c)", () => {
        const state = build({
            cards: [
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Wrenn and Six", owner: "opp", zone: "battlefield" },
            ],
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackers: ["Grizzly Bears"],
                confirmed: true,
                blockersConfirmed: true,
            },
        });
        const bears = idOf(state, "Grizzly Bears");
        const walker = idOf(state, "Wrenn and Six");
        state.combat!.attackTargets = { [bears]: walker };
        const oppLife = state.players[1].life;

        blink(state, walker);
        const loyalty = permanentNamed(state, "Wrenn and Six")!.counters
            ?.loyalty;
        expect(loyalty).toBeGreaterThan(0);

        resolveCombatDamage(state);

        expect(permanentNamed(state, "Wrenn and Six")!.counters?.loyalty).toBe(
            loyalty
        );
        expect(state.players[1].life).toBe(oppLife);
    });
});
