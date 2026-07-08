// legalActions(state) — Expected-Input-driven enumeration + gate parity
// (ADR 0047, issue #801, PRD #795).
//
// The enumeration must be the exact dual of the Expected Input gate:
//
//   1. enumerated ⊆ gate-accepted — every action legalActions yields carries a
//      GateRequest that `assertExpectedInput` admits on the same state;
//   2. gate-accepted ⊆ enumerated — for every (kind × player) class the gate
//      admits, legalActions yields at least one action of that class, and for
//      every class the gate rejects it yields none.
//
// `assertGateParity` proves both directions on each representative scenario
// required by the issue: open priority (CR 117), pending choice (CR 608.2),
// blocker declaration (CR 509.1), and mid-cast targeting (CR 601.2c) — plus
// the pre-game mulligan window (CR 103.4), an in-progress payment
// (CR 601.2g), and a finished game (CR 104.2a).

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import type { GameState, PendingChoice } from "../state";
import {
    assertExpectedInput,
    EXPECTED_INPUT_KINDS,
    type GateRequest,
} from "../expectedInput";
import {
    gateRequestFor,
    legalActions,
    type LegalAction,
} from "../legalActions";

const MOUNTAIN = getCardByName("Mountain").id;
const FOREST = getCardByName("Forest").id;
const BOLT = getCardByName("Lightning Bolt").id; // R, target any
const BEARS = getCardByName("Grizzly Bears").id; // 1G 2/2

function gateAccepts(state: GameState, request: GateRequest): boolean {
    try {
        assertExpectedInput(state, request);
        return true;
    } catch {
        return false;
    }
}

/** Both parity directions (ADR 0047, issue #801):
 *  - every enumerated action's gate request is admitted by the gate;
 *  - for every (kind × player) class, the gate admits it iff at least one
 *    enumerated action belongs to it. */
function assertGateParity(state: GameState): LegalAction[] {
    const actions = legalActions(state);

    // Direction 1 — enumerated ⊆ gate-accepted.
    for (const action of actions) {
        expect(
            gateAccepts(state, gateRequestFor(action)),
            `enumerated action rejected by the gate: ${JSON.stringify(action)}`
        ).toBe(true);
    }

    // Direction 2 — gate-accepted ⊆ enumerated, over the full kind × player
    // matrix (EXPECTED_INPUT_KINDS is compiler-checked exhaustive). The gate is
    // probed through the SAME contract the production mutation submits
    // (`gateRequestFor`), NOT a hand-rolled `{playerId, expect}`. Sub-flows that
    // fold into a priority window — combat-damage confirmation (CR 510.1c) — are
    // owned by their acting player via `anyPlayer`, not by `priorityPlayerId`,
    // so a bare probe would spuriously reject a legal assigner action whose
    // playerId differs from the priority holder. Reusing `gateRequestFor` on a
    // representative enumerated action makes this direction reflect the real
    // gate contract; when no action is enumerated for the class the canonical
    // bare request is the right probe (that is exactly what a normal mutation of
    // that class would send).
    for (const kind of EXPECTED_INPUT_KINDS) {
        for (const player of state.players) {
            const rep = actions.find(
                (a) => a.expect === kind && a.playerId === player.id
            );
            const request: GateRequest = rep
                ? gateRequestFor(rep)
                : { playerId: player.id, expect: kind };
            const accepted = gateAccepts(state, request);
            const enumerated = rep !== undefined;
            expect(
                enumerated,
                `gate/enumeration mismatch for (${kind}, ${player.id}): ` +
                    `gate ${accepted ? "accepts" : "rejects"}, enumeration ` +
                    `${enumerated ? "has" : "lacks"} an action`
            ).toBe(accepted);
        }
    }

    return actions;
}

// ---------------------------------------------------------------------------
// Open priority (CR 117)
// ---------------------------------------------------------------------------

describe("legalActions — open priority window (CR 117)", () => {
    function openPriorityState(): GameState {
        const bolt = makeInstance(BOLT, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const landInHand = makeInstance(MOUNTAIN, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const p1 = makePlayer("p1", {
            hand: [bolt, landInHand],
            battlefield: [makeInstance(MOUNTAIN, { controllerId: "p1" })],
        });
        const p2 = makePlayer("p2", {
            battlefield: [
                makeInstance(BEARS, { controllerId: "p2", ownerId: "p2" }),
            ],
        });
        return makeState({ players: [p1, p2] });
    }

    it("holds gate parity and enumerates pass / play-land / cast-spell for the priority holder", () => {
        const state = openPriorityState();
        const actions = assertGateParity(state);

        expect(actions.every((a) => a.expect === "priority")).toBe(true);
        expect(actions.every((a) => a.playerId === "p1")).toBe(true);
        const kinds = actions.map((a) => a.action.kind);
        expect(kinds).toContain("pass");
        expect(kinds).toContain("play-land");
        // Bolt targets "any": opponent creature + both players = 3 casts.
        expect(kinds.filter((k) => k === "cast-spell")).toHaveLength(3);
    });

    it("is pure — enumeration does not mutate the state (issue #801 AC)", () => {
        const state = openPriorityState();
        const before = structuredClone(state);
        legalActions(state);
        expect(state).toEqual(before);
    });

    it("enumerates nothing once the game is over (CR 104.2a)", () => {
        const state = makeState({
            gameOver: { winnerId: "p2", loserId: "p1", reason: "life" },
        });
        expect(legalActions(state)).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Pre-game mulligan window (CR 103.4)
// ---------------------------------------------------------------------------

describe("legalActions — mulligan declaration window (CR 103.4)", () => {
    it("holds gate parity and offers keep / mull to the declaring player", () => {
        const state = makeState({
            phase: "MULLIGAN",
            priorityPlayerId: "p1",
            mulligan: {
                mulligansTaken: [0, 0],
                declarations: [null, null],
                locked: [false, false],
                declaringPlayerId: "p1",
                bottoming: false,
            },
        });
        const actions = assertGateParity(state);
        expect(actions).toEqual([
            {
                expect: "priority",
                playerId: "p1",
                action: { kind: "mulligan", decision: "keep" },
            },
            {
                expect: "priority",
                playerId: "p1",
                action: { kind: "mulligan", decision: "mull" },
            },
        ]);
    });
});

// ---------------------------------------------------------------------------
// Pending choice (CR 608.2)
// ---------------------------------------------------------------------------

describe("legalActions — pending choice (CR 608.2 / 101.4)", () => {
    it("holds gate parity and enumerates one valid submission per pickable hand card", () => {
        const cardA = makeInstance(BEARS, {
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const cardB = makeInstance(MOUNTAIN, {
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const choice: PendingChoice = {
            stackItemId: "s1",
            step: 0,
            choiceId: "p2",
            playerId: "p2",
            kind: "discard-hand",
            zone: "hand",
            count: 1,
            prompt: "Discard a card",
        };
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { hand: [cardA, cardB] }),
            ],
            pendingChoices: [choice],
        });

        const actions = assertGateParity(state);
        expect(actions).toHaveLength(2);
        for (const a of actions) {
            expect(a.expect).toBe("choice");
            expect(a.playerId).toBe("p2");
            if (a.expect !== "choice" || a.action.kind !== "submit-choice") {
                throw new Error("expected submit-choice actions");
            }
            // Payload validity — mirrors applyPendingChoiceSubmit's contract:
            // identity from the head, exactly `count` ids, ids from the zone.
            expect(a.action.stackItemId).toBe("s1");
            expect(a.action.step).toBe(0);
            expect(a.action.choiceId).toBe("p2");
            expect(a.action.cardInstanceIds).toHaveLength(1);
        }
        const pickedIds = actions.map(
            (a) =>
                (a.action as { cardInstanceIds: string[] }).cardInstanceIds[0]
        );
        expect(pickedIds).toContain(cardA.id);
        expect(pickedIds).toContain(cardB.id);
    });

    it("range counts enumerate every size in [min, max] (ADR 0003 cap-style)", () => {
        const tappedA = makeInstance(MOUNTAIN, {
            controllerId: "p1",
            isTapped: true,
        });
        const tappedB = makeInstance(MOUNTAIN, {
            controllerId: "p1",
            isTapped: true,
        });
        const choice: PendingChoice = {
            stackItemId: "",
            step: 0,
            choiceId: "p1",
            playerId: "p1",
            kind: "untap-pick",
            zone: "battlefield",
            count: { min: 0, max: 1 },
            prompt: "Untap up to 1 permanent",
        };
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tappedA, tappedB] }),
                makePlayer("p2"),
            ],
            pendingChoices: [choice],
        });

        const actions = assertGateParity(state);
        const payloads = actions.map(
            (a) => (a.action as { cardInstanceIds: string[] }).cardInstanceIds
        );
        // Size 0 (the tactical zero-branch) + one per tapped permanent.
        expect(payloads).toContainEqual([]);
        expect(payloads).toContainEqual([tappedA.id]);
        expect(payloads).toContainEqual([tappedB.id]);
        expect(payloads).toHaveLength(3);
    });

    it("may-pay: decline always, accept only when the cost is payable (CR 117.3a / 118.4)", () => {
        const mayPay = (cost?: { R: number }): PendingChoice => ({
            stackItemId: "s1",
            step: 0,
            choiceId: "p2",
            playerId: "p2",
            kind: "may-pay",
            count: 1,
            prompt: "Pay {R}?",
            ...(cost ? { cost } : {}),
        });

        // Unpayable: empty mana pool → only the decline is legal.
        const broke = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
            pendingChoices: [mayPay({ R: 1 })],
        });
        const brokeActions = assertGateParity(broke);
        expect(brokeActions).toEqual([
            {
                expect: "choice",
                playerId: "p2",
                action: { kind: "submit-may-pay", accept: false },
            },
        ]);

        // Payable: {R} floating → both answers are legal.
        const funded = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
                }),
            ],
            pendingChoices: [mayPay({ R: 1 })],
        });
        const fundedActions = assertGateParity(funded);
        expect(fundedActions.map((a) => a.action)).toEqual([
            { kind: "submit-may-pay", accept: true },
            { kind: "submit-may-pay", accept: false },
        ]);
    });

    it("option-pick: one submission per author-supplied option (CR 614.12)", () => {
        const choice: PendingChoice = {
            stackItemId: "s1",
            step: 0,
            choiceId: "p1",
            playerId: "p1",
            kind: "option-pick",
            count: 1,
            prompt: "Choose a body",
            options: [
                { id: "3/3", label: "3/3" },
                { id: "2/2-flyer", label: "2/2 with flying" },
            ],
        };
        const state = makeState({ pendingChoices: [choice] });
        const actions = assertGateParity(state);
        expect(
            actions.map(
                (a) =>
                    (a.action as { cardInstanceIds: string[] })
                        .cardInstanceIds[0]
            )
        ).toEqual(["3/3", "2/2-flyer"]);
    });
});

// ---------------------------------------------------------------------------
// Blocker declaration (CR 509.1)
// ---------------------------------------------------------------------------

describe("legalActions — blocker declaration (CR 509.1)", () => {
    it("holds gate parity and enumerates no-block plus each legal assignment for the defender", () => {
        const attacker = makeInstance(BEARS, {
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const blocker = makeInstance(BEARS, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            phase: "DECLARE_BLOCKERS",
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
            combat: {
                attackerIds: [attacker.id],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });

        const actions = assertGateParity(state);
        // The defending player (p2) declares (CR 509.1): the empty
        // declaration and the single-block assignment.
        expect(actions).toEqual([
            {
                expect: "blockers",
                playerId: "p2",
                action: { kind: "declare-blockers", assignments: [] },
            },
            {
                expect: "blockers",
                playerId: "p2",
                action: {
                    kind: "declare-blockers",
                    assignments: [
                        { blockerId: blocker.id, attackerId: attacker.id },
                    ],
                },
            },
        ]);
    });
});

// ---------------------------------------------------------------------------
// Mid-cast targeting (CR 601.2c)
// ---------------------------------------------------------------------------

describe("legalActions — mid-cast targeting (CR 601.2c)", () => {
    it("holds gate parity and enumerates each legal target plus cancel for the chooser", () => {
        const bolt = makeInstance(BOLT, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const creature = makeInstance(BEARS, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [bolt] }),
                makePlayer("p2", { battlefield: [creature] }),
            ],
            pendingTarget: {
                playerId: "p1",
                cardInstanceId: bolt.id,
                targetType: "any",
                count: 1,
                selected: [],
            },
        });

        const actions = assertGateParity(state);
        expect(actions.every((a) => a.expect === "target")).toBe(true);
        expect(actions.every((a) => a.playerId === "p1")).toBe(true);

        const selects = actions.filter(
            (a) => a.action.kind === "select-target"
        );
        // "any" target (CR 115.4): the opponent creature + both players.
        const ids = selects.map(
            (a) => (a.action as { target: { id: string } }).target.id
        );
        expect(ids).toContain(creature.id);
        expect(ids).toContain("p1");
        expect(ids).toContain("p2");
        expect(selects).toHaveLength(3);

        // Fixed-N selection: no confirm (auto-finalizes on the last pick),
        // cancel always available (CR 601.2g).
        expect(actions.map((a) => a.action.kind)).toContain("cancel-target");
        expect(actions.map((a) => a.action.kind)).not.toContain(
            "confirm-targets"
        );
    });

    it("variable-count selection offers confirm at ≥ min and excludes already-selected targets", () => {
        const bolt = makeInstance(BOLT, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const bearsA = makeInstance(BEARS, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const bearsB = makeInstance(BEARS, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [bolt] }),
                makePlayer("p2", { battlefield: [bearsA, bearsB] }),
            ],
            pendingTarget: {
                playerId: "p1",
                cardInstanceId: bolt.id,
                targetType: "Creature",
                count: { min: 1, max: 2 },
                selected: [{ type: "permanent", id: bearsA.id }],
            },
        });

        const actions = assertGateParity(state);
        const kinds = actions.map((a) => a.action.kind);
        // One target already chosen (≥ min): confirm is offered (CR 601.2c).
        expect(kinds).toContain("confirm-targets");
        expect(kinds).toContain("cancel-target");
        // CR 601.2c — targets must be distinct: only the unselected creature
        // remains selectable.
        const selects = actions.filter(
            (a) => a.action.kind === "select-target"
        );
        expect(selects).toHaveLength(1);
        expect(
            (selects[0].action as { target: { id: string } }).target.id
        ).toBe(bearsB.id);
    });
});

// ---------------------------------------------------------------------------
// In-progress payment (CR 601.2g)
// ---------------------------------------------------------------------------

describe("legalActions — in-progress spell payment (CR 601.2g)", () => {
    it("holds gate parity and offers cancel-cast and pass to the paying priority holder", () => {
        const bolt = makeInstance(BOLT, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1", { hand: [bolt] }), makePlayer("p2")],
            pendingCast: {
                playerId: "p1",
                cardInstanceId: bolt.id,
                manaCost: { R: 1 },
                tappedLandIds: [],
            },
        });

        const actions = assertGateParity(state);
        expect(actions).toEqual([
            {
                expect: "priority",
                playerId: "p1",
                action: { kind: "cancel-cast" },
            },
            { expect: "priority", playerId: "p1", action: { kind: "pass" } },
        ]);
    });
});

// ---------------------------------------------------------------------------
// In-progress ability activation payment (CR 602.2b)
// ---------------------------------------------------------------------------

describe("legalActions — in-progress ability activation (CR 602.2b)", () => {
    it("holds gate parity and offers cancel-activation and pass to the paying priority holder", () => {
        const source = makeInstance(MOUNTAIN, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [source] }),
                makePlayer("p2"),
            ],
            pendingActivation: {
                playerId: "p1",
                cardInstanceId: source.id,
                abilityId: "a1",
                manaCost: { R: 1 },
                tappedLandIds: [],
                tapSource: false,
                sacrificeSource: false,
            },
        });

        const actions = assertGateParity(state);
        expect(actions).toEqual([
            {
                expect: "priority",
                playerId: "p1",
                action: { kind: "cancel-activation" },
            },
            { expect: "priority", playerId: "p1", action: { kind: "pass" } },
        ]);
    });
});

// ---------------------------------------------------------------------------
// name-card choice (CR 201.2 / 202.3)
// ---------------------------------------------------------------------------

describe("legalActions — name-card choice (CR 201.2 / 202.3)", () => {
    it("holds gate parity and offers a single open submit-name-card action", () => {
        const choice: PendingChoice = {
            stackItemId: "s1",
            step: 0,
            choiceId: "c1",
            playerId: "p2",
            kind: "name-card",
            count: 1,
            prompt: "Name a card",
        };
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
            pendingChoices: [choice],
        });

        const actions = assertGateParity(state);
        // The registry is the payload domain (CR 202.3), so one open action
        // stands for the whole family — the caller supplies the name.
        expect(actions).toEqual([
            {
                expect: "choice",
                playerId: "p2",
                action: { kind: "submit-name-card" },
            },
        ]);
    });
});

// ---------------------------------------------------------------------------
// random-reveal acknowledgement (CR 705.2, ADR 0023)
// ---------------------------------------------------------------------------

describe("legalActions — random-reveal ack (CR 705.2, ADR 0023)", () => {
    it("holds gate parity and offers the no-decision acknowledgement", () => {
        const choice: PendingChoice = {
            stackItemId: "s1",
            step: 0,
            choiceId: "c1",
            playerId: "p1",
            kind: "random-reveal",
            count: 1,
            prompt: "Flip a coin",
            randomKind: "coin",
            sides: 2,
            result: 1,
        };
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
            pendingChoices: [choice],
        });

        const actions = assertGateParity(state);
        // A suspended random reveal resumes with a single acknowledgement that
        // carries the head's identity (CR 705.2) — no branch to choose.
        expect(actions).toEqual([
            {
                expect: "choice",
                playerId: "p1",
                action: {
                    kind: "submit-random-reveal-ack",
                    stackItemId: "s1",
                    choiceId: "c1",
                },
            },
        ]);
    });
});

// ---------------------------------------------------------------------------
// choose-damage-target choice (CR 115.4)
// ---------------------------------------------------------------------------

describe("legalActions — choose-damage-target (CR 115.4)", () => {
    it("holds gate parity and enumerates one submission per damageable permanent and player", () => {
        const creature = makeInstance(BEARS, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const choice: PendingChoice = {
            stackItemId: "s1",
            step: 0,
            choiceId: "c1",
            playerId: "p1",
            kind: "choose-damage-target",
            count: 1,
            prompt: "Choose any target for the damage",
            candidateIds: [creature.id],
            candidatePlayerIds: ["p1", "p2"],
        };
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [creature] }),
                makePlayer("p2"),
            ],
            pendingChoices: [choice],
        });

        const actions = assertGateParity(state);
        // "Any target" (CR 115.4): the damageable permanent + both players.
        const payloads = actions.map(
            (a) => (a.action as { cardInstanceIds: string[] }).cardInstanceIds
        );
        expect(payloads).toContainEqual([creature.id]);
        expect(payloads).toContainEqual(["p1"]);
        expect(payloads).toContainEqual(["p2"]);
        expect(payloads).toHaveLength(3);
        expect(actions.every((a) => a.expect === "choice")).toBe(true);
        expect(actions.every((a) => a.playerId === "p1")).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Divide-as-you-choose targeting (CR 601.2d)
// ---------------------------------------------------------------------------

describe("legalActions — divide-as-you-choose targeting (CR 601.2d)", () => {
    it("holds gate parity and carries the minimal legal amount (1) on each select", () => {
        const bolt = makeInstance(BOLT, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const creature = makeInstance(BEARS, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [bolt] }),
                makePlayer("p2", { battlefield: [creature] }),
            ],
            pendingTarget: {
                playerId: "p1",
                cardInstanceId: bolt.id,
                targetType: "any",
                count: { min: 1, max: 3 },
                selected: [],
                divideTotal: 3,
            },
        });

        const actions = assertGateParity(state);
        const selects = actions.filter(
            (a) => a.action.kind === "select-target"
        );
        // "any" target: opponent creature + both players.
        expect(selects).toHaveLength(3);
        // CR 601.2d — every enumerated select carries the minimal legal
        // division (1 point of the budget).
        for (const s of selects) {
            expect((s.action as { amount?: number }).amount).toBe(1);
        }
        // Budget still open with 0 assigned, and cancel always legal.
        expect(actions.map((a) => a.action.kind)).toContain("cancel-target");
    });
});

// ---------------------------------------------------------------------------
// Combat damage confirmation (CR 510.1c)
// ---------------------------------------------------------------------------

describe("legalActions — combat damage confirmation (CR 510.1c)", () => {
    /** phase = COMBAT_DAMAGE with an open assignment owned by two distinct
     *  assigners — an attacker with 2+ blockers (the active player) and a
     *  blocker blocking 2+ attackers (the defender). The defender-assigner
     *  differs from `priorityPlayerId`, the exact case the parity probe must
     *  reflect via the mutation's `anyPlayer` contract. */
    function damageState(confirmedBy: string[] = []): GameState {
        const attacker = makeInstance(BEARS, {
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const blocker = makeInstance(BEARS, {
            controllerId: "p2",
            ownerId: "p2",
        });
        return makeState({
            phase: "COMBAT_DAMAGE",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
            combat: {
                attackerIds: [attacker.id],
                confirmed: true,
                blockerAssignments: { [blocker.id]: [attacker.id] },
                blockersConfirmed: true,
                damageConfirmed: false,
                damageAssignerIds: {
                    [attacker.id]: "p1",
                    [blocker.id]: "p2",
                },
                damageAssignmentConfirmedBy: confirmedBy,
            },
        });
    }

    it("holds gate parity and offers a confirm-damage per outstanding assigner (incl. a non-priority assigner)", () => {
        const state = damageState();
        const actions = assertGateParity(state);
        // Both distinct assigners are outstanding — the active-player attacker
        // (also the priority holder) and the defender blocker (NOT the priority
        // holder). Parity holds because each probe uses the `anyPlayer` contract
        // `gateRequestFor` builds for confirm-damage (CR 510.1c).
        expect(actions).toEqual([
            {
                expect: "priority",
                playerId: "p1",
                action: { kind: "confirm-damage" },
            },
            {
                expect: "priority",
                playerId: "p2",
                action: { kind: "confirm-damage" },
            },
        ]);
    });

    it("drops an assigner that already confirmed (CR 510.1c wait-for-all)", () => {
        const state = damageState(["p1"]);
        const actions = legalActions(state);
        // Only the still-outstanding defender assigner remains.
        expect(actions).toEqual([
            {
                expect: "priority",
                playerId: "p2",
                action: { kind: "confirm-damage" },
            },
        ]);
        // Direction 1 still holds for the remaining action: its production
        // gate request (anyPlayer) is admitted even though p2 isn't the
        // priority holder.
        expect(gateAccepts(state, gateRequestFor(actions[0]))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Attack-declaration land tax (CR 508.1c/1g / 701.21a — Flooded Woodlands)
// ---------------------------------------------------------------------------

describe("legalActions — parked attack-tax sacrifice (CR 508.1c/1g)", () => {
    it("holds gate parity and enumerates one select-sacrifice per legal land", () => {
        const forest = makeInstance(FOREST, {
            id: "forest",
            controllerId: "p1",
            ownerId: "p1",
        });
        const mountain = makeInstance(MOUNTAIN, {
            id: "mountain",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [forest, mountain] }),
                makePlayer("p2"),
            ],
            combat: {
                attackerIds: ["atk1"],
                confirmed: false,
                blockerAssignments: {},
                blockersConfirmed: false,
                pendingAttackSacrifice: {
                    playerId: "p1",
                    reason: "Flooded Woodlands",
                    requirements: [{ filter: { types: ["Land"] }, count: 1 }],
                    picked: [],
                },
            },
        });

        const actions = assertGateParity(state);
        // Every enumerated action is a sacrifice pick for the attacking player,
        // one per candidate land (both distinct basics are legal).
        expect(actions.every((a) => a.expect === "sacrifice")).toBe(true);
        expect(
            actions
                .map((a) =>
                    a.action.kind === "select-sacrifice"
                        ? a.action.cardInstanceId
                        : null
                )
                .filter(Boolean)
                .sort()
        ).toEqual(["forest", "mountain"]);
    });
});
