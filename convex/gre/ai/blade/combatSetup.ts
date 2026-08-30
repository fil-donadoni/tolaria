/**
 * Blade-scenario suite — the engine-real COMBAT setup steps
 * (`declare-attackers`, issue #1489; `extra-combat`, issue #2886. ADR 0070 §4).
 *
 * A `ScenarioSpec` can describe a board but not a COMBAT: `buildStateFromScenario`
 * seeds `state.combat` with an EMPTY, unconfirmed attacker list at
 * `DECLARE_ATTACKERS` and nothing more (`scenarioBuilder.ts`). The lethal-block
 * charter position (#1489) is a decision that only exists AFTER the active
 * player has attacked — `decidingPlayer` hands the root to the defender exactly
 * when `phase === "DECLARE_BLOCKERS" && combat.confirmed && !blockersConfirmed`
 * (`search.ts`) — so the entry needs the board walked forward to that point.
 *
 * ADR 0070 §4, in full force here: the attack is declared and priority is
 * passed through the engine's OWN move-application chokepoint,
 * `applyMoveInSearch` (`search.ts`) — the same function every rollout uses to
 * push a `declare-attackers` / `pass` through the real GRE primitives (it taps
 * non-vigilance attackers per CR 508.1f, emits the attackers-declared events,
 * runs SBAs and drains auto-passes). Nothing here re-implements combat
 * declaration or phase advancement; a hand-seeded `combat.attackerIds` would
 * be precisely the "state the engine could never produce" the ADR rejects.
 *
 * And the invariant that makes the shape worth having: every way this can fail
 * to find purchase in the engine THROWS — no eligible attacker, a declaration
 * the real restriction checks reject (CR 506.3/508.1), or a board that does not
 * arrive at `DECLARE_BLOCKERS`. There is no fallback that builds the position
 * "as if".
 *
 * `extra-combat` (CR 500.8) extends the same discipline one phase further: it
 * grants through the REAL primitive and lets the engine's own `advancePhase`
 * seam consume the queue, because a second combat phase is likewise a position
 * no `ScenarioSpec` can describe.
 *
 * Lives in its own module rather than inside `setup.ts` so the steps' logic is
 * reviewable (and testable) on its own; `setup.ts` keeps only the dispatch.
 */

import { getCardByName } from "../../../cards";
import {
    validateAttackerEligibility,
    validateDeclaredAttackers,
    validateBlockerEligibility,
    validateDeclaredBlockers,
} from "../../combat";
import { enumerateMoves } from "../../moves";
import { applyMoveInSearch, decidingPlayer } from "../../search";
import type { CardInstanceState, GameState } from "../../state";
import { getOpponentId, queueExtraCombat } from "../../state";
import type { BladeSetupStep } from "./types";

/** Upper bound on the priority passes used to walk from the declaration to the
 *  block window. Three or four is the real number (CR 508.2/509.1); the cap
 *  only stops a malformed position from looping. */
const MAX_PRIORITY_PASSES = 12;

/** The step, narrowed. */
type DeclareAttackersStep = Extract<
    BladeSetupStep,
    { kind: "declare-attackers" }
>;

/** The extra-combat step, narrowed. */
type ExtraCombatStep = Extract<BladeSetupStep, { kind: "extra-combat" }>;

/** Creatures the ACTIVE player may legally send (CR 508.1a). Name-filtered when
 *  the step lists `cards`, exactly like every other blade matcher — an entry
 *  never writes an instance id. */
function eligibleAttackers(
    state: GameState,
    step: DeclareAttackersStep
): CardInstanceState[] {
    const active = state.players.find((p) => p.id === state.activePlayerId);
    const defender = state.players.find((p) => p.id !== state.activePlayerId);
    if (!active || !defender) return [];
    // `getCardByName` throws on an unknown name, so a typo is an authoring
    // error rather than a silently-empty attack.
    const wanted = step.cards?.map((name) => getCardByName(name).id);
    return active.battlefield.filter((c) => {
        if (
            wanted !== undefined &&
            !wanted.includes((c.card as { id?: string } | undefined)?.id ?? "")
        ) {
            return false;
        }
        return validateAttackerEligibility(c, defender.battlefield, state)
            .eligible;
    });
}

/**
 * Declare the attack described by `step` and walk priority forward until the
 * DEFENDER owes the block declaration. Mutates `state` in place.
 *
 * `fail` is the caller's error factory (`setup.ts` owns the `BladeSetupError`
 * shape and the scenario label); this module only decides WHAT failed.
 */
export function applyDeclareAttackers(
    state: GameState,
    step: DeclareAttackersStep,
    fail: (detail: string) => Error
): void {
    if (state.phase !== "DECLARE_ATTACKERS") {
        throw fail(
            `the built state is at phase "${state.phase}", not "DECLARE_ATTACKERS" — set \`phase: "DECLARE_ATTACKERS"\` on the spec.`
        );
    }
    const attackers = eligibleAttackers(state, step);
    if (attackers.length === 0) {
        throw fail(
            step.cards
                ? `no creature named ${step.cards.map((n) => `"${n}"`).join(" / ")} controlled by the active player may legally attack in this position.`
                : "the active player controls no creature that may legally attack in this position."
        );
    }

    const attackerIds = attackers.map((c) => c.id);
    // The engine's own move application — CR 508.1f tapping, the
    // attackers-declared events, SBAs. Never a hand-written combat literal.
    applyMoveInSearch(state, state.activePlayerId, {
        kind: "declare-attackers",
        attackerIds,
    });

    // The real declaration restrictions (CR 506.3/508.1 — Arboria, propaganda-
    // style taxes, "must attack" requirements). A declaration the engine would
    // reject must not become a searched position.
    //
    // This necessarily runs AFTER the move is applied, not before:
    // `validateDeclaredAttackers` reads `state.combat.attackerIds`, which only
    // exists once the declaration has been made. On a rejection the whole
    // `state` is discarded with the throw, so nothing invalid ever escapes.
    const legal = validateDeclaredAttackers(state);
    if (!legal.ok) {
        throw fail(`the declared attack is illegal — ${legal.reason}`);
    }
    if (!state.combat?.confirmed) {
        throw fail("the engine did not confirm the attack.");
    }

    // CR 508.2/509.1 — both players pass priority in the declare-attackers
    // step, and the game moves to declare blockers. Passing through
    // `applyMoveInSearch` keeps triggers/SBAs on the real path.
    // Read through a widening helper: TypeScript narrows `state.phase` to
    // "DECLARE_ATTACKERS" at the guard above and cannot see that
    // `applyMoveInSearch` mutates it.
    const phaseOf = (s: GameState): string => s.phase;
    const defenderId = getOpponentId(state, state.activePlayerId);
    for (let i = 0; i < MAX_PRIORITY_PASSES; i++) {
        if (phaseOf(state) === "DECLARE_BLOCKERS") break;
        const owed = decidingPlayer(state);
        if (owed === null) {
            throw fail(
                `nobody owes an action at phase "${state.phase}" — the position never reaches the block window.`
            );
        }
        // `haltForDefenderResponse` (issue #2248) — stop here, WITHOUT
        // consuming this pass, the first time the DEFENDER is owed priority
        // still inside DECLARE_ATTACKERS. That is the only window a flash
        // blocker can be cast into this combat (see the field's doc in
        // `types.ts`); continuing the walk would auto-pass through it and the
        // block-window state this step normally builds can never express a
        // response to the attack, only a response to the (already-locked)
        // block.
        if (step.haltForDefenderResponse && owed === defenderId) {
            return;
        }
        applyMoveInSearch(state, owed, { kind: "pass" });
    }

    if (
        phaseOf(state) !== "DECLARE_BLOCKERS" ||
        !state.combat ||
        state.combat.blockersConfirmed
    ) {
        throw fail(
            `the position did not reach an open DECLARE_BLOCKERS window (ended at "${state.phase}").`
        );
    }
}

/** The permanent `instanceId` names, on either battlefield, or undefined. */
function findPermanent(
    state: GameState,
    instanceId: string
): CardInstanceState | undefined {
    for (const p of state.players) {
        const found = p.battlefield.find((c) => c.id === instanceId);
        if (found) return found;
    }
    return undefined;
}

/** The block step, narrowed. */
type DeclareBlockersStep = Extract<
    BladeSetupStep,
    { kind: "declare-blockers" }
>;

/** The single battlefield permanent named `name` on `seat`'s side, or a throw.
 *  Name-based like every other blade lookup; ambiguity is an authoring error,
 *  never a guess. */
function uniqueByName(
    state: GameState,
    name: string,
    ownerIsDefender: boolean,
    fail: (detail: string) => Error
): CardInstanceState {
    const defenderId = getOpponentId(state, state.activePlayerId);
    const side = state.players.find((p) =>
        ownerIsDefender ? p.id === defenderId : p.id === state.activePlayerId
    );
    const wantedId = getCardByName(name).id;
    const found = (side?.battlefield ?? []).filter(
        (c) => (c.card as { id?: string } | undefined)?.id === wantedId
    );
    if (found.length === 0) {
        throw fail(
            `no battlefield permanent named "${name}" on the ${ownerIsDefender ? "defending" : "attacking"} side.`
        );
    }
    if (found.length > 1) {
        throw fail(
            `"${name}" matches ${found.length} permanents on the ${ownerIsDefender ? "defending" : "attacking"} side — the step cannot guess which one.`
        );
    }
    return found[0];
}

/**
 * Declare the defender's blocks and leave the position in the priority round
 * that follows (CR 509.1 → 509.4). Mutates `state` in place.
 *
 * Same discipline as `applyDeclareAttackers` above: the declaration goes
 * through `applyMoveInSearch`, the real restriction/requirement checks run
 * afterward against the state they read (`validateDeclaredBlockers` reads
 * `combat.blockerAssignments`, which only exists once the move is applied),
 * and every way of finding no purchase THROWS.
 */
export function applyDeclareBlockers(
    state: GameState,
    step: DeclareBlockersStep,
    fail: (detail: string) => Error
): void {
    if (state.phase !== "DECLARE_BLOCKERS") {
        throw fail(
            `the position is at phase "${state.phase}", not "DECLARE_BLOCKERS" — put a \`declare-attackers\` step before this one.`
        );
    }
    const combat = state.combat;
    if (!combat || !combat.confirmed) {
        throw fail("no confirmed attack — nothing to block.");
    }
    if (combat.blockersConfirmed) {
        throw fail("blockers are already declared in this position.");
    }
    const defenderId = getOpponentId(state, state.activePlayerId);
    const owed = decidingPlayer(state);
    if (owed !== defenderId) {
        throw fail(
            `the defender does not owe the block declaration here (owed by ${owed ?? "nobody"}).`
        );
    }

    // An empty `blocks` is a real DECLINE-to-block declaration, not a skipped
    // step — so it must be a decision the defender actually had. Without this,
    // a spec whose defender controls nothing that could block produces a
    // no-op step that reads in the diff as a deliberate decline, and the entry
    // silently asserts on a different position than the one it is written for.
    // CR 509.1a — the eligibility the real declaration would have been judged
    // against.
    const defender = state.players.find((p) => p.id === defenderId);
    const defenderBattlefield = defender?.battlefield ?? [];
    const attackers = combat.attackerIds
        .map((id) => findPermanent(state, id))
        .filter((c): c is CardInstanceState => c !== undefined);
    const couldHaveBlocked = defenderBattlefield.some((blocker) =>
        attackers.some(
            (attacker) =>
                validateBlockerEligibility(
                    attacker,
                    blocker,
                    defenderBattlefield,
                    state
                ).eligible
        )
    );
    if (!couldHaveBlocked) {
        throw fail(
            "the defender controls no creature that could legally block — the block window this step declares in is not a real decision."
        );
    }

    const assignments = (step.blocks ?? []).map(({ blocker, attacker }) => {
        const blockerCard = uniqueByName(state, blocker, true, fail);
        const attackerCard = uniqueByName(state, attacker, false, fail);
        if (!combat.attackerIds.includes(attackerCard.id)) {
            throw fail(`"${attacker}" is not among the declared attackers.`);
        }
        return { blockerId: blockerCard.id, attackerId: attackerCard.id };
    });

    applyMoveInSearch(state, defenderId, {
        kind: "declare-blockers",
        assignments,
    });

    const legal = validateDeclaredBlockers(state);
    if (!legal.ok) {
        throw fail(`the declared block is illegal — ${legal.reason}`);
    }
    if (!state.combat?.blockersConfirmed) {
        throw fail("the engine did not confirm the block declaration.");
    }
}

/** Upper bound on the decisions used to walk from "an extra combat is owed" to
 *  the second combat's declare-attackers step. The real number is a handful of
 *  priority passes plus one block declaration per damage step; the cap only
 *  stops a malformed position from looping. */
const MAX_EXTRA_COMBAT_STEPS = 40;

/**
 * Queue one additional combat phase (CR 500.8) and walk the position forward
 * until the turn RE-ENTERS `DECLARE_ATTACKERS` inside it. Mutates `state` in
 * place.
 *
 * The grant shares the engine's own queue writer — `queueExtraCombat` is today
 * the entire body of `SpellContext.grantExtraCombat`, which the `extraCombat`
 * Op's executor calls — rather than re-typing the push here. It is a SHARED
 * WRITER, not the Op's full path: the step does not go through
 * `OP_EXECUTORS.extraCombat` or build a `SpellContext`, so anything
 * `grantExtraCombat` grows beyond delegating to `queueExtraCombat` would have
 * to be mirrored here deliberately. Keep that primitive a one-liner, or route
 * this step through the Op.
 *
 * The WALK is the engine's own `applyMoveInSearch`, so the queue is consumed by
 * the real `advancePhase` seam and every trigger / turn-based action of the
 * second combat happens for real.
 *
 * The walk's move policy is deliberately narrow and DECLINING: take a `pass`
 * when one is offered; otherwise DECLINE the position's optional declaration
 * (block nothing — CR 509.1 makes blocking optional, so the empty assignment
 * is always legal and always unique); otherwise take the position's ONE forced
 * move, and throw on anything still ambiguous rather than pick. A blade entry
 * must never depend on which of several plausible moves the harness happened
 * to choose, and "the defender declined to block" is a position property the
 * entry's own comment can state.
 */
export function applyExtraCombat(
    state: GameState,
    step: ExtraCombatStep,
    fail: (detail: string) => Error
): void {
    const combatsBefore = state.extraCombatsThisTurn ?? 0;
    queueExtraCombat(state);
    // `haltAfterGrant` — stop at "an extra combat is OWED but not yet
    // entered". Nothing to walk and nothing to assert about the walk; the
    // position is the grant itself.
    if (step.haltAfterGrant) return;

    // `state.phase` is widened through a helper for the same reason
    // `applyDeclareAttackers` does it: TypeScript cannot see that
    // `applyMoveInSearch` mutates it.
    const phaseOf = (s: GameState): string => s.phase;
    const inExtraCombat = (): boolean =>
        (state.extraCombatsThisTurn ?? 0) > combatsBefore;

    for (let i = 0; i < MAX_EXTRA_COMBAT_STEPS; i++) {
        if (inExtraCombat() && phaseOf(state) === "DECLARE_ATTACKERS") return;
        const owed = decidingPlayer(state);
        if (owed === null) {
            throw fail(
                `nobody owes an action at phase "${state.phase}" — the position never reaches the extra combat's declare-attackers step.`
            );
        }
        const moves = enumerateMoves(state, owed, {
            pruneDominatedNoOps: true,
        });
        const pass = moves.find((m) => m.kind === "pass");
        if (pass) {
            applyMoveInSearch(state, owed, pass);
            continue;
        }
        // CR 509.1 — blocking is optional, so "block nothing" is always legal
        // and always exactly one move. Declining keeps the walk deterministic
        // without needing the defender to be creature-less (a board with no
        // legal block never opens the block window at all).
        const declineBlocks = moves.find(
            (m) => m.kind === "declare-blockers" && m.assignments.length === 0
        );
        if (declineBlocks) {
            applyMoveInSearch(state, owed, declineBlocks);
            continue;
        }
        if (moves.length !== 1) {
            throw fail(
                `the walk to the extra combat reached a decision at phase "${state.phase}" offering ${moves.length} non-pass moves — it must be forced (give the defender no blockers, or narrow the position).`
            );
        }
        applyMoveInSearch(state, owed, moves[0]);
    }

    throw fail(
        `the position did not reach the extra combat's declare-attackers step within ${MAX_EXTRA_COMBAT_STEPS} decisions (ended at "${state.phase}", extra combats entered: ${(state.extraCombatsThisTurn ?? 0) - combatsBefore}).`
    );
}
