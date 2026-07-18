// Factory for SPELL_CAST triggered abilities (CR 603.2 + 601.2i). Card
// authors declare scope + filter + resolve; the factory wires event-type
// narrowing, caster-scope gating, SpellFilter matching, optional condition
// (CR 603.4) and engine-level intervening-if (CR 603.4d) plumbing.
//
// Last-known-information (CR 603.10) for SPELL_CAST is delivered to the
// resolve callback via the `spell` derived payload — caller code never has
// to re-read the card registry or narrow the event type itself.

import type {
    CardType,
    Color,
    EffectOp,
    GameEvent,
    PermanentView,
    SpellCastEvent,
    SpellContext,
    TriggerStateView,
    TriggeredAbility,
} from "../../types";
import type { SpellFilter } from "../../filters";
import { matchesSpellFilter } from "../../filters";

/** Caster scope for a spell-cast trigger. Resolved against the source's
 *  controller at trigger-fire time (CR 109.4).
 *
 *  - "you"       — fires only when the source's controller is the caster
 *                  (Verduran Enchantress).
 *  - "opponents" — fires when any player other than the source's controller
 *                  is the caster.
 *  - "any"       — fires on any caster (Crystal Rod and the rest of the
 *                  color-sphere cycle).
 *  - "self"      — fires when the spell being cast is this very source
 *                  (CR 603.6e "when you cast this spell"). Identified by
 *                  matching the event's spell instance id to the source's
 *                  own id. No LEA card currently uses this scope.
 */
export type SpellCastScope = "you" | "opponents" | "any" | "self";

/** Last-known-information payload handed to a `spellCastTrigger.resolve`
 *  callback. Mirrors the fields the engine snapshots on `SpellCastEvent`
 *  (CR 601.2i + 603.10) so the resolve body can read the cast spell's
 *  identity without re-narrowing the event or hitting the registry. */
export interface SpellCastDerived {
    instanceId: string;
    casterId: string;
    cardId: string;
    types: ReadonlyArray<CardType>;
    subtypes: ReadonlyArray<string>;
    colors: ReadonlyArray<Color>;
}

export interface SpellCastTriggerArgs {
    /** Stable id on the source's `triggeredAbilities[]`. */
    id: string;
    /** Oracle text shown on the stack (CR 603.2). */
    oracleText: string;
    /** Caster gate (see `SpellCastScope`). */
    scope: SpellCastScope;
    /** Optional filter against the cast spell's characteristics
     *  (CR 601.2i — types / subtypes / colors). Spells are not permanents,
     *  so `SpellFilter` is intentionally narrower than `PermanentFilter`. */
    filter?: SpellFilter;
    /** Additional predicate at trigger-check time (CR 603.4). Receives the
     *  narrowed event, the source view, and the read-only state view for
     *  cards that need to inspect persistent game state beyond scope+filter. */
    condition?: (
        event: SpellCastEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** Intervening-if predicate (CR 603.4d). Re-evaluated by the engine at
     *  resolve time; returning false fizzles the trigger. */
    interveningIf?: (
        event: SpellCastEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** Resolution body. Receives the engine `SpellContext`, the original
     *  `SpellCastEvent`, and the derived `spell` payload. Mutually exclusive
     *  with `effects` — supply exactly one (DSL-first, ADR 0045). Use
     *  `resolve` when the effect must inspect the firing spell (the `spell`
     *  payload); use `effects` for an event-independent effect. */
    resolve?: (
        ctx: SpellContext,
        event: SpellCastEvent,
        spell: SpellCastDerived
    ) => void;
    /** Effect Script (ADR 0045) — the trigger's resolution as declarative,
     *  JSON-pure Ops, run through the shared interpreter with the source's
     *  controller bound. The DSL-first default for a spell-cast trigger whose
     *  effect does NOT read the firing spell (e.g. Argothian Enchantress'
     *  mandatory "draw a card"). Mutually exclusive with `resolve`. */
    effects?: EffectOp[];
}

/** Reusable "this is exactly the caster's Nth spell this turn" trigger
 *  condition (issue #1343, CR 601.2i). Reads
 *  `SpellCastEvent.casterSpellCountThisTurn` — the caster's own tally of
 *  spells cast STRICTLY BEFORE this one this turn, the per-player
 *  counterpart of Storm's global `priorSpellCount` (ADR 0052). For the
 *  caster's Nth spell the prior count is exactly N-1, so `nthSpellThisTurn(2)`
 *  is connive's "whenever a player casts their SECOND spell each turn" (CR
 *  701.50, Ledger Shredder); `nthSpellThisTurn(1)` is "their first spell",
 *  and so on for any future cube resident sharing the template (Nashi-style
 *  effects). An undefined field (a pre-#1343 hand-built test fixture, or an
 *  emitter that predates it) reads as the caster's FIRST spell (count 0),
 *  mirroring `priorSpellCount`'s own fallback convention. Pass the result to
 *  `spellCastTrigger`'s `condition` — combine with `scope: "any"` for
 *  connive's "a PLAYER casts their second spell" (any caster, not just this
 *  permanent's controller). */
export function nthSpellThisTurn(
    n: number
): NonNullable<SpellCastTriggerArgs["condition"]> {
    return (event) => (event.casterSpellCountThisTurn ?? 0) === n - 1;
}

function castInScope(
    event: SpellCastEvent,
    self: PermanentView,
    scope: SpellCastScope
): boolean {
    if (scope === "any") return true;
    if (scope === "you") return event.casterId === self.controllerId;
    if (scope === "opponents") return event.casterId !== self.controllerId;
    // "self" — the spell being cast IS this source (CR 603.6e).
    return event.spellInstanceId === self.id;
}

/** Returns a `TriggeredAbility` for a SPELL_CAST trigger (CR 603.2 + 601.2i).
 *  The factory handles event-type narrowing, scope gating, SpellFilter
 *  matching, and last-known-information delivery so card definitions stay
 *  declarative. */
export function spellCastTrigger(args: SpellCastTriggerArgs): TriggeredAbility {
    if ((args.resolve === undefined) === (args.effects === undefined)) {
        throw new Error(
            `spellCastTrigger(${args.id}): supply exactly one of resolve / effects`
        );
    }
    const built: TriggeredAbility = {
        id: args.id,
        oracleText: args.oracleText,
        event: "SPELL_CAST",
        matches: (event: GameEvent, self, state) => {
            if (event.type !== "SPELL_CAST") return false;
            if (!castInScope(event, self, args.scope)) return false;
            if (args.filter !== undefined) {
                const spell = {
                    types: event.spellTypes,
                    subtypes: event.spellSubtypes,
                    colors: event.spellColors,
                };
                if (!matchesSpellFilter(spell, args.filter)) return false;
            }
            if (args.condition && !args.condition(event, self, state)) {
                return false;
            }
            return true;
        },
    };
    if (args.effects !== undefined) {
        built.effects = args.effects;
    } else {
        const resolveFn = args.resolve!;
        built.resolve = (ctx, event) => {
            if (event.type !== "SPELL_CAST") return;
            resolveFn(ctx, event, {
                instanceId: event.spellInstanceId,
                casterId: event.casterId,
                cardId: event.spellCardId,
                types: event.spellTypes,
                subtypes: event.spellSubtypes,
                colors: event.spellColors,
            });
        };
    }
    if (args.interveningIf) {
        const ifFn = args.interveningIf;
        built.interveningIf = (event: GameEvent, self, state) => {
            if (event.type !== "SPELL_CAST") return false;
            return ifFn(event, self, state);
        };
    }
    return built;
}
