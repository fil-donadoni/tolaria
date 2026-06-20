// `phaseTrigger` — declarative factory for CR 603.6a "at the beginning of
// [step]" triggered abilities. First member of the trigger-factory family
// (PRD #1, slice 3 of #4): card authors describe what step, whose scope,
// and what to do, instead of repeating the same `event.type === "PHASE_BEGIN"`
// narrowing + scope check + LKI plumbing per card. The factory handles:
//
//   * event-kind narrowing (PHASE_BEGIN) so the per-card body sees a typed
//     `PhaseBeginEvent` rather than `GameEvent`,
//   * scope resolution via `resolvePhaseScope` (your / each / opponents /
//     host-controller),
//   * delivery of `scopedPlayerId` (the active player on whose step the
//     trigger fires, or — for `host-controller` — the enchanted permanent's
//     current controller, looked up at resolve time per CR 603.10 last-known
//     information),
//   * optional CR 603.4 condition filter at trigger time and CR 603.4d
//     intervening-if filter at resolution time.
//
// Cards using the factory should NOT re-narrow the event type or recompute
// the scope inside `resolve` — they receive a typed event and the resolved
// playerId for free.

import type { Phase } from "../../../gre/types";
import type {
    GameEvent,
    PermanentView,
    PhaseBeginEvent,
    SpellContext,
    TriggerStateView,
    TriggeredAbility,
} from "../../types";
import { resolvePhaseScope, type TriggerScope } from "./shared";

/** Arguments to `phaseTrigger`. See the field docs below for the contract of
 *  each property. */
export interface PhaseTriggerArgs {
    /** Stable id within the source card's `triggeredAbilities` array. */
    id: string;
    /** Oracle text shown on the stack and in trigger logs (CR 603.3a). */
    oracleText: string;
    /** Which step's PHASE_BEGIN to listen for (CR 500.1). */
    phase: Phase;
    /** Zone the source must be in to be scanned (CR 603.6e). Defaults to the
     *  battlefield; set `"graveyard"` for upkeep triggers that fire while the
     *  card sits in the graveyard (Nether Shadow). */
    zone?: "graveyard";
    /** Whose step counts — drives both the trigger filter and the
     *  `scopedPlayerId` passed to `resolve`. See `TriggerScope`. */
    scope: TriggerScope;
    /** Optional CR 603.4 extra filter applied at trigger time, after the
     *  phase + scope checks pass. Use this for narrow per-card conditions
     *  the factory cannot express (e.g. an additional state-shape check that
     *  ONLY runs at trigger time, not at resolve). For "if X at resolve"
     *  semantics use `interveningIf` instead — that's the CR 603.4d hook
     *  the engine re-checks before invoking `resolve`. */
    condition?: (
        event: PhaseBeginEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** CR 603.4d intervening-if. The engine re-evaluates this predicate
     *  immediately before `resolve` runs; if it returns false the trigger
     *  fizzles (no resolve, TRIGGER_FIZZLED queued — see
     *  `gre/state.ts:resolveTopOfStack`). Use this for "if [condition on
     *  the source]" oracle phrasings (Howling Mine "if untapped", Mana
     *  Vault draw-step ping "if tapped", Clockwork Beast "if attacked or
     *  blocked this combat"). */
    interveningIf?: (
        event: PhaseBeginEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** Per-card resolution body. Receives a fresh `SpellContext`, the typed
     *  `PhaseBeginEvent` that fired the trigger, and `scopedPlayerId` — the
     *  active player on whose step the trigger fired (or, for
     *  `host-controller`, the enchanted permanent's current controller, read
     *  at resolve time so control changes between trigger and resolve are
     *  honored). */
    resolve?: (
        ctx: SpellContext,
        event: PhaseBeginEvent,
        scopedPlayerId: string
    ) => void;
    /** Multi-step resolution (CR 608.2). Use INSTEAD of `resolve` when the
     *  trigger commits an irreversible action (a counter add, a draw) BEFORE a
     *  later `requestMayPay` / `requestChoice` that can suspend: a single
     *  `resolve` re-runs the whole body on resume, double-applying the earlier
     *  action (Primordial Ooze's "+1/+1 counter, then you may pay {X}"). The
     *  engine checkpoints `resolutionStep` so completed steps never re-run. Each
     *  step receives `ctx` plus the resolved `scopedPlayerId`; read the typed
     *  event off `ctx` is not needed — steps that ignore the event take only the
     *  two args. Use `resolve` XOR `resolveSteps`. */
    resolveSteps?: ((ctx: SpellContext, scopedPlayerId: string) => void)[];
}

export function phaseTrigger(args: PhaseTriggerArgs): TriggeredAbility {
    return {
        id: args.id,
        oracleText: args.oracleText,
        event: "PHASE_BEGIN",
        ...(args.zone ? { zone: args.zone } : {}),
        matches: (event, self, state) => {
            if (event.type !== "PHASE_BEGIN") return false;
            if (event.phase !== args.phase) return false;
            if (resolvePhaseScope(args.scope, event, self, state) === null) {
                return false;
            }
            if (args.condition && !args.condition(event, self, state)) {
                return false;
            }
            // CR 603.4d — intervening-if is checked at BOTH trigger time and
            // resolve time. The engine wires the resolve-time check via the
            // `interveningIf` field; we mirror it into `matches` here so the
            // trigger never enters the stack when the condition is already
            // false at the moment it would fire.
            if (args.interveningIf && !args.interveningIf(event, self, state)) {
                return false;
            }
            return true;
        },
        interveningIf: args.interveningIf
            ? (event, self, state) => {
                  if (event.type !== "PHASE_BEGIN") return false;
                  return args.interveningIf!(event, self, state);
              }
            : undefined,
        // CR 608.2 — when the card supplies `resolveSteps`, wrap each step with
        // scope resolution and let the engine checkpoint between steps so a
        // suspension never re-runs a completed step. Otherwise use the single
        // `resolve` body.
        ...(args.resolveSteps
            ? {
                  resolveSteps: args.resolveSteps.map((step) => (ctx) => {
                      // The PhaseBeginEvent isn't re-threaded into steps (the
                      // engine drives `resolveSteps` with only `ctx`); the scope
                      // is re-derived from the live context exactly as the single
                      // `resolve` path does.
                      const scoped = resolveScopeFromCtx(args.scope, ctx);
                      if (scoped === null) return;
                      step(ctx, scoped);
                  }),
              }
            : {
                  resolve: (ctx: SpellContext, event: GameEvent) => {
                      if (event.type !== "PHASE_BEGIN") return;
                      const scoped = resolveScopeAtResolve(
                          args.scope,
                          event,
                          ctx
                      );
                      if (scoped === null) return;
                      args.resolve?.(ctx, event, scoped);
                  },
              }),
    };
}

/** Scope resolution for the `resolveSteps` path, where the firing
 *  `PhaseBeginEvent` is not re-threaded by the engine. `your` / `host-
 *  controller` derive from the live context; `each` / `opponents` map to the
 *  active player, which at an upkeep step is the trigger's controller — every
 *  current `resolveSteps` consumer is a `your`-scoped upkeep trigger. */
function resolveScopeFromCtx(
    scope: TriggerScope,
    ctx: SpellContext
): string | null {
    if (scope === "your") return ctx.controller;
    if (scope === "host-controller") {
        const hostId = ctx.getAttachedTo(ctx.sourceInstanceId);
        if (!hostId) return null;
        return ctx.getController({ type: "permanent", id: hostId });
    }
    // each / opponents — at the source's own step the active player is the
    // controller; resolveSteps consumers today are all `your`-scoped.
    return ctx.controller;
}

/** Resolve-time scope resolution. Mirrors `resolvePhaseScope` but reads the
 *  current host (for `host-controller`) via the SpellContext so control
 *  changes between trigger and resolve are honored. For non-aura scopes the
 *  value is read off `event` / `ctx.controller` and never returns null at
 *  resolve (matches semantics: if we got here, matches() already passed). */
function resolveScopeAtResolve(
    scope: TriggerScope,
    event: PhaseBeginEvent,
    ctx: SpellContext
): string | null {
    if (scope === "each") return event.activePlayerId;
    if (scope === "your") return ctx.controller;
    if (scope === "opponents") return event.activePlayerId;
    // host-controller: re-fetch host at resolve time (CR 603.10 LKI applies
    // to the source, not the target — the host's controller may have changed
    // between trigger and resolve via e.g. Control Magic).
    const hostId = ctx.getAttachedTo(ctx.sourceInstanceId);
    if (!hostId) return null;
    return ctx.getController({ type: "permanent", id: hostId });
}
