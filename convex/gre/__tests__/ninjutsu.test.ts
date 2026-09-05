// Ninjutsu (CR 702.49) — the keyword's permanent test (issue #2390).
//
// Full path on purpose: every assertion drives the real mutation entry point
// (`activateAbilityOnState`) and the real resolution (`resolveTopOfStack`),
// never a hand-assembled stack item, because the three things most likely to
// break here live between those two — the cost's candidate set, the CR 702.49c
// stamp captured at commit, and the `moveZone` hand carrier that consumes it.
//
// CR sections exercised: 702.49a (the ability, its cost, its from-hand
// permission), 702.49b (the reveal), 702.49c (the inherited defender),
// 509.1h (which attackers are unblocked, and therefore the timing window),
// 506.3c (attacking without ever having been declared as an attacker).

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { activateAbilityOnState } from "../../game";
import { resolveTopOfStack } from "../state";
import type { CardInstanceState, GameState } from "../state";
import { projectPublicState } from "../../gameProjections";
import { unblockedAttackerIds } from "../combat";
import { ninjutsuReturnCandidateIds } from "../ninjutsu";
import { refreshExpectedInput } from "../expectedInput";
import { drought } from "../../cards/sets/ice/white";
import { swamp } from "../../cards/sets/lea/colorless";

const FALLEN_SHINOBI = "900c9dfd-ece1-4b09-a801-0fa05e1994b9";
/** Grizzly Bears — a vanilla body to attack with. */
const BEARS = "b0a9e5e1-9f1e-4d3a-9a0a-0e0f5f8f7e3a";

/** A 2/2 stand-in attacker built without leaning on any particular card id:
 *  the tests care about combat bookkeeping, not about the creature. */
function attacker(id: string, controllerId = "p1"): CardInstanceState {
    return {
        id,
        card: { id: BEARS },
        types: ["Creature"],
        subtypes: ["Bear"],
        power: 2,
        toughness: 2,
        staticAbilities: [],
        controllerId,
        ownerId: controllerId,
        zone: "battlefield",
        isTapped: true,
        isAttacking: true,
    } as CardInstanceState;
}

/** p1 is attacking p2 with `attackerIds`; blockers have been declared, and
 *  `blockedIds` are the attackers that got blocked (CR 509.1h). Fallen Shinobi
 *  sits in p1's hand with the mana to ninjutsu it already floating. */
function combatBoard(opts: {
    attackerIds: string[];
    blockedIds?: string[];
    blockersConfirmed?: boolean;
    attackTargets?: Record<string, string>;
}): { state: GameState; shinobiId: string } {
    const attackers = opts.attackerIds.map((id) => attacker(id));
    const shinobi = makeInstance(FALLEN_SHINOBI, {
        id: "shinobi",
        zone: "hand",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        phase: "DECLARE_BLOCKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: attackers,
                hand: [shinobi],
                // {2}{U}{B} pre-floated: the mana payment is not what these
                // tests are about, and a covered cost keeps the activation on
                // the immediate-commit path unless a real pick is owed.
                manaPool: { W: 0, U: 1, B: 1, R: 0, G: 0, C: 2 },
            }),
            makePlayer("p2"),
        ],
        combat: {
            attackerIds: [...opts.attackerIds],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: opts.blockersConfirmed ?? true,
            ...(opts.blockedIds ? { blockedAttackerIds: opts.blockedIds } : {}),
            ...(opts.attackTargets
                ? { attackTargets: opts.attackTargets }
                : {}),
        },
    });
    refreshExpectedInput(state);
    return { state, shinobiId: shinobi.id };
}

function ninjutsu(state: GameState, shinobiId: string): void {
    activateAbilityOnState(state, {
        playerId: "p1",
        cardInstanceId: shinobiId,
        abilityId: "ninjutsu",
    });
}

function battlefieldOf(state: GameState, playerId: string) {
    return state.players.find((p) => p.id === playerId)!.battlefield;
}

describe("unblocked attackers (CR 509.1h)", () => {
    it("negates the explicit blocked list rather than counting live blockers", () => {
        const { state } = combatBoard({
            attackerIds: ["a1", "a2"],
            blockedIds: ["a2"],
        });
        expect(unblockedAttackerIds(state, "p1")).toEqual(["a1"]);
        // The blocker is GONE from `blockerAssignments` (it died, or never was
        // recorded there) and a2 is still blocked — CR 509.1h keeps it blocked
        // even when every creature blocking it leaves combat. A derivation from
        // the assignment map would call a2 unblocked here.
        expect(state.combat!.blockerAssignments).toEqual({});
    });

    it("does not report an attacker another player controls", () => {
        const { state } = combatBoard({ attackerIds: ["a1"] });
        expect(unblockedAttackerIds(state, "p2")).toEqual([]);
    });
});

describe("Ninjutsu timing window (CR 702.49a / 509.1h)", () => {
    it("offers no candidate before blockers are declared", () => {
        const { state, shinobiId } = combatBoard({
            attackerIds: ["a1"],
            blockersConfirmed: false,
        });
        // The window is the COST's affordability, not a phase test: with
        // blockers undeclared there is nothing legal to return, so the cost is
        // unpayable and both the mutation's gate and the hand menu read the
        // same empty set. (The mutation itself is unreachable here for a
        // second, independent reason — p1 does not hold priority while p2 owes
        // a blocker declaration, ADR 0047 — which is why this asserts the
        // authority rather than the throw.)
        expect(ninjutsuReturnCandidateIds(state, "p1")).toEqual([]);
        void shinobiId;
    });

    it("refuses when every attacker is blocked", () => {
        const { state, shinobiId } = combatBoard({
            attackerIds: ["a1"],
            blockedIds: ["a1"],
        });
        expect(() => ninjutsu(state, shinobiId)).toThrow(
            /No unblocked attacker to return/
        );
    });
});

describe("Ninjutsu activation and resolution (CR 702.49a)", () => {
    it("returns the attacker at COST time and puts the ninja onto the battlefield tapped and attacking on resolution", () => {
        const { state, shinobiId } = combatBoard({ attackerIds: ["a1"] });

        ninjutsu(state, shinobiId);

        // CR 118.1 / 601.2h — costs are paid at ACTIVATION: the attacker is
        // already in hand while the ability is still on the stack, so the
        // opponent cannot respond by killing it.
        expect(state.stack).toHaveLength(1);
        expect(battlefieldOf(state, "p1").map((c) => c.id)).toEqual([]);
        const hand = state.players[0].hand.map((c) => c.id);
        expect(hand).toContain("a1");
        // NOTE: `combat.attackerIds` keeps the departed id — this engine
        // live-filters attacker lists by battlefield presence at every read
        // site (`phases.ts`) rather than pruning them on departure, so a stale
        // entry is inert. What CR 506.4 makes observable is asserted instead:
        // the creature is off the battlefield and in hand.
        expect(battlefieldOf(state, "p1").some((c) => c.id === "a1")).toBe(
            false
        );
        // CR 702.49a — the ninja is STILL IN HAND while the ability is on the
        // stack; it is put onto the battlefield by the ability's resolution.
        expect(hand).toContain(shinobiId);

        resolveTopOfStack(state);

        const shinobi = battlefieldOf(state, "p1").find(
            (c) => c.id === shinobiId
        );
        expect(shinobi).toBeDefined();
        // CR 702.49a — "tapped and attacking".
        expect(shinobi!.isTapped).toBe(true);
        expect(shinobi!.isAttacking).toBe(true);
        expect(state.combat!.attackerIds).toContain(shinobiId);
        // CR 506.3c — attacking, but never DECLARED as an attacker, so
        // "whenever a creature attacks" watchers must not see it.
        expect(shinobi!.hasAttackedThisTurn).toBeUndefined();
        // It left the hand exactly once.
        expect(state.players[0].hand.map((c) => c.id)).not.toContain(shinobiId);
    });

    it("inherits the returned creature's planeswalker defender (CR 702.49c)", () => {
        const { state, shinobiId } = combatBoard({
            attackerIds: ["a1"],
            attackTargets: { a1: "pw-1" },
        });

        ninjutsu(state, shinobiId);
        resolveTopOfStack(state);

        expect(state.combat!.attackTargets?.[shinobiId]).toBe("pw-1");
        // The ninja carries the defender in its own right — the returned
        // creature is off the battlefield, so its own (inert) entry says
        // nothing about what the ninja is attacking.
        expect(battlefieldOf(state, "p1").some((c) => c.id === "a1")).toBe(
            false
        );
    });

    it("attacks the defending player when the returned creature did (CR 702.49c)", () => {
        const { state, shinobiId } = combatBoard({ attackerIds: ["a1"] });

        ninjutsu(state, shinobiId);
        resolveTopOfStack(state);

        // No stamp means the defending player, for which `attackTargets`
        // records nothing — not an "unknown" the ninja could inherit later.
        expect(state.combat!.attackTargets?.[shinobiId]).toBeUndefined();
        const shinobi = battlefieldOf(state, "p1").find(
            (c) => c.id === shinobiId
        )!;
        expect(shinobi.enterAttackingTarget).toBeUndefined();
    });

    it("reveals the card from hand as part of the cost (CR 702.49a/b)", () => {
        const { state, shinobiId } = combatBoard({ attackerIds: ["a1"] });

        ninjutsu(state, shinobiId);

        const inHand = state.players[0].hand.find((c) => c.id === shinobiId)!;
        expect(inHand.knownTo).toContain("p2");
    });

    it("parks a real choice when more than one attacker is unblocked (CR 702.49a)", () => {
        const { state, shinobiId } = combatBoard({
            attackerIds: ["a1", "a2"],
        });

        ninjutsu(state, shinobiId);

        // WHICH attacker goes back is the payer's decision, so the activation
        // parks on the unified selection rather than auto-picking a victim.
        const sel = state.pendingActivation?.sacrificeSelection;
        expect(sel).toBeDefined();
        // CR 702.49a — the terminal action rides the REQUIREMENT, not the
        // selection, so this leg can share one payment with a static
        // additional-SACRIFICE tax the same activation owes (Drought).
        expect(sel!.requirements[0].action).toBe("return");
        expect(sel!.picked).toEqual([]);
        // The requirement is narrowed to the unblocked attackers — a plain
        // creature filter would offer any creature p1 controls.
        expect(sel!.requirements[0].candidateIds).toEqual(["a1", "a2"]);
        // Nothing has moved yet.
        expect(state.stack).toHaveLength(0);
        expect(battlefieldOf(state, "p1").map((c) => c.id)).toEqual([
            "a1",
            "a2",
        ]);
    });

    it("excludes a blocked attacker from the candidate set (CR 509.1h)", () => {
        const { state, shinobiId } = combatBoard({
            attackerIds: ["a1", "a2"],
            blockedIds: ["a1"],
        });

        ninjutsu(state, shinobiId);

        // Exactly one legal victim, so the pick auto-resolves and the blocked
        // attacker is untouched.
        expect(state.pendingActivation).toBeUndefined();
        expect(state.players[0].hand.map((c) => c.id)).toContain("a2");
        expect(battlefieldOf(state, "p1").map((c) => c.id)).toEqual(["a1"]);
    });
});

describe("Ninjutsu alongside a static additional-sacrifice tax (CR 601.2f)", () => {
    // Review finding on PR #3084. The ninjutsu leg used to short-circuit
    // `buildActivationSacrificeSelection`, which skipped the static tax loop
    // entirely: with Drought on the battlefield the {2}{U}{B} ninjutsu cost
    // owed a Swamp per black pip and paid none. Both legs now share ONE
    // selection, each carrying its own terminal action.
    function boardWithDrought(): { state: GameState; shinobiId: string } {
        const { state, shinobiId } = combatBoard({ attackerIds: ["a1"] });
        const p1 = state.players[0];
        p1.battlefield.push(
            makeInstance(drought.id, {
                id: "drought",
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        p1.battlefield.push(
            makeInstance(swamp.id, {
                id: "swamp-1",
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        refreshExpectedInput(state);
        return { state, shinobiId };
    }

    it("pays BOTH legs — the attacker goes to hand, the Swamp to the graveyard", () => {
        const { state, shinobiId } = boardWithDrought();

        ninjutsu(state, shinobiId);

        const p1 = state.players[0];
        // CR 702.49a — the attacker was RETURNED.
        expect(p1.hand.map((c) => c.id)).toContain("a1");
        expect(p1.graveyard.map((c) => c.id)).not.toContain("a1");
        // CR 601.2f — the Swamp was SACRIFICED, in the same payment.
        expect(p1.graveyard.map((c) => c.id)).toContain("swamp-1");
        expect(p1.battlefield.map((c) => c.id)).not.toContain("swamp-1");
    });

    it("is illegal with no Swamp to pay the tax (CR 601.2f)", () => {
        const { state, shinobiId } = boardWithDrought();
        const p1 = state.players[0];
        p1.battlefield = p1.battlefield.filter((c) => c.id !== "swamp-1");
        refreshExpectedInput(state);

        expect(() => ninjutsu(state, shinobiId)).toThrow();
        // Nothing was paid: the attacker is still attacking.
        expect(p1.battlefield.map((c) => c.id)).toContain("a1");
    });
});

describe("Ninjutsu wire format (projectPublicState)", () => {
    it("both players see the ninja tapped and attacking, and the returned creature in hand", () => {
        const { state, shinobiId } = combatBoard({ attackerIds: ["a1"] });
        ninjutsu(state, shinobiId);
        resolveTopOfStack(state);

        for (const viewerId of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewerId);
            const p1 = projected.players.find((p) => p.id === "p1")!;
            const shinobi = p1.battlefield.find((c) => c.id === shinobiId);
            expect(shinobi, `viewer ${viewerId}`).toBeDefined();
            // The projection strips fat fields; these two drive every combat
            // read on the client, so a GRE-only assertion would pass while the
            // board rendered an untapped non-attacker.
            expect(shinobi!.isTapped, `viewer ${viewerId}`).toBe(true);
            expect(shinobi!.isAttacking, `viewer ${viewerId}`).toBe(true);
            expect(
                projected.combat?.attackerIds,
                `viewer ${viewerId}`
            ).toContain(shinobiId);
            // The returned attacker is off the battlefield for both viewers.
            expect(p1.battlefield.map((c) => c.id)).not.toContain("a1");
        }
        // The owner sees the returned card itself; the opponent sees only a
        // hand of the right size (ADR 0026).
        const own = projectPublicState(state, 1, "p1");
        expect(
            own.players.find((p) => p.id === "p1")!.hand.map((c) => c?.id)
        ).toContain("a1");
    });
});
