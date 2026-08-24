/**
 * Blade-scenario suite — the `declare-attackers` engine-real setup step
 * (issue #1489, ADR 0070 §4).
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
 * Lives in its own module rather than inside `setup.ts` so the step's logic is
 * reviewable (and testable) on its own; `setup.ts` keeps only the dispatch.
 */

import { getCardByName } from "../../../cards";
import {
    validateAttackerEligibility,
    validateDeclaredAttackers,
} from "../../combat";
import { applyMoveInSearch, decidingPlayer } from "../../search";
import type { CardInstanceState, GameState } from "../../state";
import { getOpponentId } from "../../state";
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
