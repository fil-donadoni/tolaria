// Shared test helpers for the FEM per-colour test files (ADR 0043 split).
// Stack-push / resolve shims reused across the colour modules' describe blocks.
// Fixture builders (makeInstance/makePlayer/makeState/pushSpell) stay in
// convex/cards/__tests__/setup.ts.

import { resolveTopOfStack } from "../../../../gre/state";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../../gre/state";
import {
    applyPendingChoiceSubmit,
    applyRandomRevealAck,
} from "../../../../gre/pendingChoiceSubmit";

// --- helpers (mirror drk.test.ts) ------------------------------------------

/** Push a triggered ability onto the stack and resolve it. */
export function resolveTrigger(
    state: GameState,
    source: CardInstanceState,
    triggeredAbilityId: string,
    triggerEvent: StackItem["triggerEvent"],
    targets: StackItem["targets"] = []
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId,
        triggerSourceId: source.id,
        triggerEvent,
        targets,
    });
    resolveTopOfStack(state);
}

export const UPKEEP = (playerId: string): StackItem["triggerEvent"] =>
    ({
        type: "PHASE_BEGIN" as const,
        phase: "UPKEEP" as const,
        activePlayerId: playerId,
    }) as StackItem["triggerEvent"];

/** Push an activated ability onto the stack (cost assumed paid), then resolve. */
export function resolveActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string,
    targets: StackItem["targets"] = []
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets,
    });
    resolveTopOfStack(state);
}

/** Drives any suspended mid-resolution pending choices to completion by
 *  auto-answering each head: an `option-pick` takes its first option; any
 *  permanent/card pick takes (up to `count`) candidate ids — the simple
 *  golden-path answer for stepped resolutions (Goblin Warrens, Dwarven Armorer,
 *  Raiding Party). `applyPendingChoiceSubmit` re-resolves the stack when the
 *  queue empties, so this loops until no choice remains. */
export function answerPendingChoices(state: GameState, maxRounds = 8): void {
    for (let i = 0; i < maxRounds; i++) {
        const head = state.pendingChoices?.[0];
        if (!head) return;
        if (head.kind === "random-reveal") {
            applyRandomRevealAck(state, {
                playerId: head.playerId,
                stackItemId: head.stackItemId,
                choiceId: head.choiceId,
            });
            continue;
        }
        let pick: string[];
        if (head.kind === "option-pick") {
            pick = head.options?.length ? [head.options[0].id] : [];
        } else {
            const want =
                typeof head.count === "number"
                    ? head.count
                    : (head.count?.max ?? head.candidateIds?.length ?? 0);
            // `choose-hand-card` / `discard-hand` (and any zone:"hand" pick)
            // draw from the chooser's hand zone (no candidateIds list); every
            // other zone pick carries candidateIds.
            const fromHand =
                head.kind === "choose-hand-card" ||
                head.kind === "discard-hand" ||
                head.zone === "hand";
            const pool =
                head.candidateIds ??
                (fromHand
                    ? (
                          state.players.find((p) => p.id === head.playerId)
                              ?.hand ?? []
                      ).map((c) => c.id)
                    : []);
            pick = pool.slice(0, want);
        }
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: pick,
        });
    }
}
