// Trigger factory for "leaves the battlefield" abilities (CR 603.10).
//
// Listens to `PERMANENT_LEFT` events emitted by `removePermanentTo` whenever
// a permanent transitions battlefield → (graveyard | exile | hand | library).
// Covers battlefield exits to any zone; omitting `toZone` matches any exit
// ("when this leaves the battlefield, ..."), passing a single zone or array
// narrows the match ("when this is put into a graveyard, ...").
//
// Coexists intentionally with `diedTrigger` (when added) — a creature moving
// to graveyard fires BOTH `CREATURE_DIED` and `PERMANENT_LEFT`. Card authors
// pick the factory matching the oracle phrasing.
//
// Per ADR 0001: non-battlefield-anchored zone-change triggers (madness,
// mill) are NOT in scope here — they get their own per-zone factories when a
// card needs them.

import type { PermanentFilter } from "../../filters";
import { matchesPermanentFilter } from "../../filters";
import type {
    CardType,
    EffectOp,
    GameEvent,
    PermanentLeftEvent,
    PermanentView,
    SpellContext,
    TargetRequirement,
    TriggerStateView,
    TriggeredAbility,
} from "../../types";
import { withTriggerGate } from "./shared";

/** Destination zone of a battlefield exit (CR 603.10). */
export type LeftZone = "graveyard" | "exile" | "hand" | "library";

/** Whose-permanent scope for `leftTrigger.scope`. Mirrors the scope vocabulary
 *  used by `diedTrigger` / `enteredTrigger` so the factories compose with the
 *  same mental model. */
export type LeftScope =
    | "self"
    | "yours"
    | "opponents"
    | "any"
    | "another-yours"
    | "any-other";

/** Last-known-information snapshot of the leaving permanent (CR 603.10),
 *  derived from the `PermanentLeftEvent` and surfaced to `resolve` so card
 *  authors never narrow `event.type` themselves. */
export interface LeavingPermanent {
    id: string;
    controllerId: string;
    ownerId: string;
    types: ReadonlyArray<CardType>;
    toZone: LeftZone;
    /** Host id the leaving Aura was attached to immediately before departure
     *  (CR 303.4b). Set only when the leaving permanent was an Aura attached
     *  to another permanent. Read by Animate Dead's LTB to sacrifice the
     *  reanimated creature. */
    attachedToBeforeLeave?: string;
    /** Instance ids of the permanents that were attached TO the leaving
     *  permanent immediately before departure (CR 603.10, issue #1350) — its
     *  Auras and Equipment. The reverse direction of `attachedToBeforeLeave`.
     *  Read by `wasAttachedToLeaver` for the "whenever equipped creature
     *  dies" shape (Skullclamp). */
    attachmentsBeforeLeave?: ReadonlyArray<string>;
}

export interface LeftTriggerArgs {
    /** Stable id used by the engine to de-dup stack entries and by the wire
     *  format to identify the ability. Must match the ability's place in the
     *  card definition. */
    id: string;
    /** Oracle text shown on the stack and in the trigger log. */
    oracleText: string;
    /** Whose-permanent scope. Determines which leaving permanents the source
     *  cares about (CR 603 — "this" vs "a creature you control" vs etc.). */
    scope: LeftScope;
    /** Destination zone(s) to gate on. Omitted = match any exit. */
    toZone?: LeftZone | ReadonlyArray<LeftZone>;
    /** Optional `PermanentFilter` applied to the leaving permanent. Reads
     *  what the `PermanentLeftEvent` carries (types, controllerId, instanceId,
     *  and — since issue #1191 — subtypes, e.g. `{ subtypes: "Clue" }` for
     *  "whenever you sacrifice a Clue"). Static-ability filters still won't
     *  fire here — they belong in a `condition` callback that walks the
     *  registry. */
    filter?: PermanentFilter;
    /** CR 603.3d (issue #1950) — announcement-time target requirement for a
     *  TARGETED leaves-the-battlefield trigger (Phyrexian Bloodstock: "When
     *  this creature leaves the battlefield, destroy target white creature").
     *  Forwarded verbatim onto the built `TriggeredAbility`, mirroring
     *  `EnteredTriggerArgs.targetRequirement` (`enteredTrigger.ts`) exactly —
     *  the engine locks the target(s) as the trigger goes on the stack, and
     *  the resolve/effects body reads the announced slot via `ctx.targets` /
     *  `{ target: 0 }`. Independent of the LEAVING permanent itself (which is
     *  reached through the flattened `LeavingPermanent` payload / event
     *  fields instead, never through targeting). */
    targetRequirement?: TargetRequirement;
    /** CR 603.4 trigger condition. Evaluated once at fire time. Combine with
     *  `scope` / `filter` for state lookups the event payload doesn't carry.
     *  `wasSacrificed` (this module) is the common "was this a sacrifice, not
     *  a destroy/bounce/mill" predicate. */
    condition?: (
        event: PermanentLeftEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** CR 603.4 intervening-if. Re-evaluated by the engine immediately
     *  before `resolve` runs; false → trigger fizzles (no `resolve`,
     *  `TRIGGER_FIZZLED` event emitted). */
    interveningIf?: (
        event: PermanentLeftEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** Effect Script (ADR 0045) — the DSL-first default. Rides straight to
     *  the interpreter with the source's controller and `$source` bound; the
     *  leaving permanent's last-known-info is a separate payload, not
     *  reachable from the script, so a `resolve` callback is still the escape
     *  hatch for an effect that needs it (e.g. reading `leaving.attachedToBeforeLeave`).
     *  Mutually exclusive with `resolve`. */
    effects?: EffectOp[];
    /** Resolve effect. Receives last-known-info as `leaving` so the callback
     *  body never has to narrow `event.type`. Mutually exclusive with
     *  `effects`. */
    resolve?: (
        ctx: SpellContext,
        event: PermanentLeftEvent,
        leaving: LeavingPermanent
    ) => void;
}

function matchesScope(
    event: PermanentLeftEvent,
    self: PermanentView,
    scope: LeftScope
): boolean {
    switch (scope) {
        case "self":
            return event.instanceId === self.id;
        case "yours":
            return event.controllerId === self.controllerId;
        case "opponents":
            return event.controllerId !== self.controllerId;
        case "any":
            return true;
        case "another-yours":
            return (
                event.controllerId === self.controllerId &&
                event.instanceId !== self.id
            );
        case "any-other":
            return event.instanceId !== self.id;
    }
}

function matchesToZone(
    eventZone: LeftZone,
    allowed: LeftZone | ReadonlyArray<LeftZone> | undefined
): boolean {
    if (allowed === undefined) return true;
    if (Array.isArray(allowed)) return allowed.includes(eventZone);
    return eventZone === allowed;
}

function passesFilter(
    event: PermanentLeftEvent,
    self: PermanentView,
    filter: PermanentFilter
): boolean {
    return matchesPermanentFilter(
        {
            id: event.instanceId,
            types: event.types,
            // CR 205.3 (issue #1191) — the event snapshots real subtypes now
            // (e.g. "Clue" for a sacrificed Clue token), so a `filter.subtypes`
            // match works directly. `staticAbilities` still isn't carried by
            // the event; a filter needing those should be expressed via
            // `condition`.
            subtypes: event.subtypes ? [...event.subtypes] : [],
            staticAbilities: [],
            controllerId: event.controllerId,
        },
        filter,
        {
            selfInstanceId: self.id,
            selfControllerId: self.controllerId,
        }
    );
}

/** CR 603.4 `condition` helper (issue #1054): true when this departure was
 *  directly caused by a spell or ability an OPPONENT of `self` controls.
 *  Requires `event.causerControllerId` to be set — populated only when the
 *  departure was driven by a resolving spell/ability's `SpellContext.destroy`
 *  / `destroyAll` / `sacrifice` call (never by an automatic SBA sweep, a
 *  cost-payment sacrifice, or a bounce/mill effect) — AND to differ from
 *  `self`'s controller, so a permanent's OWN controller destroying or
 *  sacrificing it (even via one of their own OTHER permanents' abilities)
 *  never satisfies this. Combine with `scope: "yours"` so `self` is the
 *  ability's controller, matching the oracle's "a permanent YOU control" /
 *  "an opponent" framing (Karmic Justice — "Whenever a spell or ability an
 *  opponent controls destroys a noncreature permanent you control, ...";
 *  Sacred Ground — "Whenever a spell or ability an opponent controls causes a
 *  land to be put into your graveyard from the battlefield, ..."). */
export function causedByOpponent(
    event: PermanentLeftEvent,
    self: PermanentView
): boolean {
    return (
        event.causerControllerId !== undefined &&
        event.causerControllerId !== self.controllerId
    );
}

/** CR 603.4 `condition` helper (issue #1191): true when this departure was a
 *  SACRIFICE (CR 701.16), as opposed to destruction, bounce, mill, or any
 *  other exit. Combine with `scope: "yours"` + `filter: { subtypes: "..." }`
 *  for the general "whenever you sacrifice a <subtype>" shape (Tireless
 *  Tracker's "whenever you sacrifice a Clue"; reusable by any future
 *  sacrifice-a-Treasure/Blood/Servo-style trigger — no new factory needed). */
export function wasSacrificed(event: PermanentLeftEvent): boolean {
    return event.cause === "sacrifice";
}

/** CR 603.10 `condition` helper (issue #1350): true when `self` — the ability's
 *  own source, an Aura or Equipment — was ATTACHED TO the permanent that just
 *  left the battlefield. The canonical "whenever equipped/enchanted creature
 *  dies, ..." shape (Skullclamp), which cannot test `self.attachedTo`: the
 *  attachment SBA (CR 704.5m) has already detached the Equipment by the time
 *  the trigger's `matches` runs, so the answer must come from the departure's
 *  last-known-information payload. Combine with `scope: "any-other"` +
 *  `toZone: "graveyard"` + `filter: { types: "Creature" }` for "dies"
 *  (CR 700.4). */
export function wasAttachedToLeaver(
    event: PermanentLeftEvent,
    self: PermanentView
): boolean {
    return event.attachmentsBeforeLeave?.includes(self.id) ?? false;
}

/** Builds a `TriggeredAbility` listening to `PERMANENT_LEFT` (CR 603.10).
 *  See module header for the design rationale; see ADR 0002 for the factory
 *  contract this conforms to. */
export function leftTrigger(args: LeftTriggerArgs): TriggeredAbility {
    const {
        id,
        oracleText,
        scope,
        toZone,
        filter,
        targetRequirement,
        condition,
        interveningIf,
        effects,
        resolve,
    } = args;

    if (effects === undefined && resolve === undefined) {
        throw new Error(
            `leftTrigger("${id}"): declare either effects[] or resolve — neither was given`
        );
    }

    function fires(
        event: GameEvent,
        self: PermanentView,
        state: TriggerStateView | undefined
    ): event is PermanentLeftEvent {
        if (event.type !== "PERMANENT_LEFT") return false;
        if (!matchesScope(event, self, scope)) return false;
        if (!matchesToZone(event.toZone, toZone)) return false;
        if (filter !== undefined && !passesFilter(event, self, filter)) {
            return false;
        }
        if (condition !== undefined && !condition(event, self, state)) {
            return false;
        }
        return true;
    }

    const ability: TriggeredAbility = {
        id,
        oracleText,
        event: "PERMANENT_LEFT",
        matches: (event, self, state) => fires(event, self, state),
        ...(effects
            ? { effects }
            : {
                  resolve: (ctx: SpellContext, event: GameEvent) => {
                      if (event.type !== "PERMANENT_LEFT") return;
                      resolve!(ctx, event, {
                          id: event.instanceId,
                          controllerId: event.controllerId,
                          ownerId: event.ownerId,
                          types: event.types,
                          toZone: event.toZone,
                          attachedToBeforeLeave: event.attachedToBeforeLeave,
                          attachmentsBeforeLeave: event.attachmentsBeforeLeave,
                      });
                  },
              }),
    };

    if (interveningIf !== undefined) {
        ability.interveningIf = (event, self, state) => {
            if (event.type !== "PERMANENT_LEFT") return false;
            return interveningIf(event, self, state);
        };
    }

    if (targetRequirement !== undefined) {
        ability.targetRequirement = targetRequirement;
    }

    return withTriggerGate(ability, args);
}
