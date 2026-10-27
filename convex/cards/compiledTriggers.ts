/**
 * JSON-pure triggered-ability descriptors — the seam the Oracle compiler emits
 * a trigger through (issue #2698, PRD #2693).
 *
 * ── Why a descriptor rather than a `TriggeredAbility` ──────────────────────
 *
 * `TriggeredAbility.matches` is a REQUIRED CLOSURE (CR 603.2 — the ability has
 * to decide, per firing event, whether the event is its own). The Oracle
 * compiler emits JSON and only JSON: `CompiledDefinition` removes every
 * function-valued field from the type, and gate 5 (`oracle/gates.ts`) fails any
 * definition that does not survive a JSON round trip unchanged. So a compiled
 * card cannot hold a trigger directly — it holds a DESCRIPTOR of one, and this
 * module rebuilds the real ability at the registry seam.
 *
 * This is exactly the shape {@link TokenTriggeredAbility} already uses for a
 * token's own printed trigger (`cards/tokenTriggeredAbilities.ts`, issue
 * #2364): a small, censused, JSON-pure head + an Effect Script body, resolved
 * through the SAME trigger factories a hand-written card calls. Reusing the
 * factories rather than re-deriving `matches` here is what makes a compiled
 * card and a hand-written one the same object — which is the property the gold
 * harness measures (`oracle/gold.ts`).
 *
 * ── The head vocabulary is censused, not free-form ─────────────────────────
 *
 * `CompiledTriggerHead` is a closed union and {@link resolveCompiledTrigger}
 * switches on it exhaustively, so a head with no factory dispatch is a type
 * error rather than a card that compiles to an ability that never fires. It
 * grows one member per grammar rule that earns it, mirroring how an Effect Op
 * earns its registry row (ADR 0045) — never upfront.
 */

import { getEffectiveColors } from "./effectiveColors";
import { matchesPermanentFilter } from "./filters";
import type { PermanentFilter, SpellFilter } from "./filters";
import type {
    CardType,
    Color,
    EffectOp,
    GameEvent,
    PermanentLeftEvent,
    PermanentView,
    TargetRequirement,
    TriggeredAbility,
    TriggerStateView,
} from "./types";
import type { CardDefinition } from "./types";
import { countDomain } from "./types";
import { getEventFieldRow } from "./eventFields";
import type { Phase } from "../gre/types";
import { attackerUnblockedTrigger } from "./abilities/triggers/attackerUnblockedTrigger";
import { turnedFaceUpTrigger } from "./abilities/triggers/turnedFaceUpTrigger";
import { attacksTrigger } from "./abilities/triggers/attacksTrigger";
import { attacksOrBlocksTrigger } from "./abilities/triggers/attacksOrBlocksTrigger";
import { damageDealtTrigger } from "./abilities/triggers/damageDealtTrigger";
import { damageTakenTrigger } from "./abilities/triggers/damageTakenTrigger";
import { diedTrigger } from "./abilities/triggers/diedTrigger";
import { enteredTrigger } from "./abilities/triggers/enteredTrigger";
import {
    causedByOpponent,
    leftTrigger,
} from "./abilities/triggers/leftTrigger";
import { graveyardEntryTrigger } from "./abilities/triggers/graveyardEntryTrigger";
import { libraryToGraveyardTrigger } from "./abilities/triggers/libraryToGraveyardTrigger";
import { creatureCardDirectlyAboveInGraveyard } from "./graveyardOrder";
import { holdsExileBundle } from "./abilities/exileBundle";
import { stateTrigger } from "./abilities/triggers/stateTrigger";
import { phaseTrigger } from "./abilities/triggers/phaseTrigger";
import { spellCastTrigger } from "./abilities/triggers/spellCastTrigger";
import { tappedTrigger } from "./abilities/triggers/tappedTrigger";
import { cycledTrigger } from "./abilities/cycling";
import {
    additionalCostPaidCondition,
    type PermanentScope,
    type TriggerScope,
} from "./abilities/triggers/shared";

/**
 * CR 603.4 — an intervening-if condition, as data.
 *
 * One member only, and deliberately so: the corpus measurement behind #2698
 * found 1,113 cards behind 1,086 DISTINCT condition fragments, i.e. an almost
 * perfectly flat tail. A condition vocabulary sized to that tail would be a
 * hundred one-card rules; a vocabulary sized to what actually repeats is one
 * rule. `controls` is that rule ("if you control a Goblin"), and the next
 * member is earned by a fragment count, not by anticipation.
 */
export type CompiledControlsCondition = {
    readonly kind: "controls";
    readonly filter: PermanentFilter;
    readonly atLeast: number;
};

/**
 * CR 603.4 — whose battlefield an `atMost` count reads: the ability's
 * controller (CR 109.5 "you"), the controller's opponent (CR 506.2 — the
 * defending player of a two-player game) or any one player (CR 102.1 —
 * "a player controls no creatures" holds when some player does).
 */
export type ControlsSubject = "you" | "opponent" | "any-player";

/**
 * The trigger-site conditions: `controls`, shared with the static slot's "as
 * long as you control …" (`compiledStatics.ts`), plus the members only an
 * intervening-if reads — they name the FIRING EVENT's player, and a static
 * ability has no firing event.
 */
export type CompiledTriggerCondition =
    | CompiledControlsCondition
    /**
     * CR 603.4 — "if <player> control(s) no <descriptor>": the `controls`
     * count read from the other end, `atMost` rather than `atLeast` (issue
     * #5274). Trigger-site only because of the subject: "defending player"
     * names the firing attack's player, which a static has no event to take
     * from.
     */
    | {
          readonly kind: "controls";
          readonly player: ControlsSubject;
          readonly filter: PermanentFilter;
          readonly atMost: number;
      }
    /**
     * CR 305.6 / 603.4 — "if there are four or more basic land types among
     * lands THAT PLAYER controls" (Mask of Intolerance, issue #4127). The
     * player is a censused `$event` player field of the firing event
     * (`PHASE_BEGIN.activePlayerId` — the player whose upkeep it is), read
     * through `EVENT_FIELD_REGISTRY` so the condition and the body name "that
     * player" through ONE authority. The count is `countDomain`, the scan
     * every Domain reader in the engine already uses.
     */
    | {
          readonly kind: "basic-land-types";
          readonly player: { readonly eventField: string };
          readonly atLeast: number;
      }
    /**
     * CR 109.5 + CR 603.4 — "if an opponent controls more lands than you" /
     * "if that player controls more lands than each other player": a strict
     * comparison of per-player counts of the permanents `filter` matches.
     * `subject` names the player whose count must be the larger: any opponent
     * of the ability's controller, a player named by a censused `$event`
     * player field ("that player"), or any player at all. `than` is `you` (the
     * controller) or `each-other-player` (strictly more than EVERY other
     * player, so a tie for the most fails).
     */
    | {
          readonly kind: "controls-more";
          readonly subject:
              | { readonly kind: "opponent" }
              | { readonly kind: "any-player" }
              | { readonly kind: "event-player"; readonly eventField: string };
          readonly than: "you" | "each-other-player";
          readonly filter: PermanentFilter;
      }
    /**
     * CR 610.3 / ADR 0028 — the source holds an exile-and-return bundle
     * (`holdsExileBundle`). NOT an intervening-if: nothing is printed. It gates
     * the return an "exile … until this leaves the battlefield" creates, a
     * second one-shot effect that exists only if the first exiled something,
     * so it is checked when the departure fires and never re-checked.
     */
    | { readonly kind: "holds-exile-bundle" }
    /**
     * CR 702.33f + CR 603.4 — "if it was kicked with its {R} kicker": the
     * permanent's own payment record for ONE named kicker
     * (`additionalCostPaidCondition`), decided from the source alone. Entered
     * heads only: the record is a fact fixed as the spell was cast
     * (CR 601.2b), read off the permanent that spell became (CR 702.33f).
     */
    | { readonly kind: "kicker-paid"; readonly kickerId: string }
    /**
     * CR 400.7d + CR 603.4 — "if you cast it any time a sorcery couldn't have
     * been cast": the cast-time snapshot `castOffSorceryTiming` the spell
     * stamped on the permanent it became (CR 307.1 / 117.1a), decided from the
     * source alone. Entered heads only, for the reason `kicker-paid` gives.
     */
    | { readonly kind: "cast-off-sorcery-timing" }
    /**
     * CR 603.4 — "if this permanent is an enchantment": the
     * source's CURRENT card types (`self.types`, the live view), checked as
     * the trigger would trigger and again as it resolves.
     */
    | { readonly kind: "self-has-type"; readonly type: CardType }
    /**
     * CR 603.4 — "if it's on the battlefield": the source is still on the
     * battlefield, checked as the trigger would trigger and again as it
     * resolves. Read off the state view, so an absent view fails closed.
     * Matches by instance id: a source blinked while the ability is on the
     * stack returns under the same id (CR 400.7) and still passes, because
     * `selfView` carries no departed-object signal — out of scope here.
     */
    | { readonly kind: "self-on-battlefield" }
    /**
     * CR 404.2 + CR 603.4 — "if this card is in your graveyard with a
     * creature card directly above it": the card on top of the source in its
     * owner's pile is a creature card. Read off the state view, so an absent
     * view fails closed. Functions from the graveyard (`zone`), which the
     * lowering sets beside it.
     */
    | { readonly kind: "graveyard-creature-above" };

/**
 * The predicate of a condition decided from the SOURCE permanent alone — a
 * fact fixed as the spell that became it was cast (CR 400.7d) — or
 * `undefined` for a condition that reads the board or the firing event.
 */
function selfDecidedGate(
    condition: CompiledTriggerCondition
): ((self: PermanentView) => boolean) | undefined {
    if (condition.kind === "kicker-paid")
        return additionalCostPaidCondition(condition.kickerId);
    if (condition.kind === "cast-off-sorcery-timing")
        return (self) => self.castOffSorceryTiming === true;
    return undefined;
}

/** CR 205.2 — "to a creature": the damaged permanent's type. */
const CREATURE_FILTER: PermanentFilter = { types: ["Creature"] };

/** The trigger heads the compiler can emit (CR 603.2 / 603.6a). Closed. */
export type CompiledTriggerHead =
    /** CR 603.6a — "when [this / another creature] enters". */
    | {
          readonly kind: "entered";
          readonly scope: PermanentScope;
          readonly filter?: PermanentFilter;
      }
    /** CR 603.6 — "when [this / a] creature dies". */
    | {
          readonly kind: "died";
          readonly scope: PermanentScope;
          readonly filter?: PermanentFilter;
      }
    /**
     * CR 603.6c — "when this permanent leaves the battlefield": the source's
     * own departure to any zone (`leftTrigger`, no `toZone`). Self only.
     */
    | { readonly kind: "left"; readonly scope: "self" }
    /**
     * CR 603.6c — "when this Aura is put into a graveyard from the battlefield"
     * (`toZone` narrows the exit, as `leftTrigger`'s own field does), and its
     * non-self form "whenever a spell or ability an opponent controls causes a
     * land to be put into your graveyard from the battlefield" (Sacred
     * Ground): the permanent's `filter`, the graveyard's OWNER (`ownedBy` —
     * CR 404.1, which is not its controller: a land you own but an opponent
     * controls goes to YOUR graveyard) and the departure's cause (`causedBy`,
     * the `causerControllerId` a resolving spell or ability stamps).
     */
    | {
          readonly kind: "left-to-graveyard";
          readonly scope: "self" | "any";
          readonly filter?: PermanentFilter;
          readonly ownedBy?: "you";
          readonly causedBy?: "opponent";
      }
    /**
     * CR 603.6c / 113.6k — "when this card is put into your graveyard from your
     * library": the source is the card that moved and functions from the
     * graveyard it landed in (`libraryToGraveyardTrigger`).
     */
    | { readonly kind: "library-to-graveyard" }
    /**
     * CR 603.2 / 603.6c — "whenever [another / a <colour>] card is put into
     * [a / an opponent's / your] graveyard from anywhere": one ability over the
     * four events that partition every way a card reaches a graveyard
     * (`graveyardEntryTrigger`).
     */
    | {
          readonly kind: "graveyard-entry";
          readonly graveyard: "any" | "yours" | "opponents";
          readonly excludeSelf?: true;
          readonly colors?: readonly Color[];
      }
    /**
     * CR 508.3a — "whenever [this creature / a creature you control] attacks".
     * `scope` absent is the source itself, the only reading before issue #4151
     * and the one a hand-written `attacksTrigger({ scope: "self" })` writes.
     */
    | { readonly kind: "attacks"; readonly scope?: PermanentScope }
    /**
     * CR 508.3a / 509.3a — "whenever a creature attacks or blocks": ONE Oracle
     * line spanning two events, firing once per attacking or blocking
     * creature and naming it `$event.combatant`.
     */
    | { readonly kind: "attacks-or-blocks"; readonly scope: PermanentScope }
    /** CR 119.3 / 510.1 — "whenever this creature deals combat damage to a player". */
    | { readonly kind: "combat-damage-to-player" }
    /**
     * CR 120.3 / 603.2 — "whenever [this / enchanted] creature deals damage
     * [to an opponent / to a creature]". Combat or not: the Oracle words do not
     * narrow it, so neither does the head. `source: "host"` is CR 303.4b's
     * Aura host.
     */
    | {
          readonly kind: "damage-dealt";
          readonly source: "self" | "host";
          readonly recipient: "any" | "opponent" | "creature" | "player";
      }
    /** CR 120.3 / 303.4b — "whenever [enchanted / this] creature is dealt damage". */
    | { readonly kind: "damage-taken"; readonly scope: "host" | "self" }
    /** CR 509.1h — "whenever this creature attacks and isn't blocked". */
    | { readonly kind: "attacks-unblocked" }
    /** CR 708.8 — "when this creature is turned face up". Self only. */
    | { readonly kind: "turned-face-up" }
    /** CR 701.26a — "whenever this permanent becomes tapped" (any tap). Self only. */
    | { readonly kind: "tapped"; readonly scope: "self" }
    /**
     * CR 605.1b + CR 303.4b — "whenever enchanted land is tapped for mana":
     * the Aura host's mana-ability tap. The trigger is itself a mana ability
     * (CR 605.1b) and resolves without the stack.
     */
    | { readonly kind: "tapped-for-mana"; readonly scope: "host" }
    /** CR 702.29c — "when you cycle this card". */
    | { readonly kind: "cycled" }
    /** CR 603.8 — "when this creature's power is N or greater" (state trigger). */
    | { readonly kind: "power-reached"; readonly atLeast: number }
    /** CR 603.6a — "at the beginning of [your/each] <step>". */
    | {
          readonly kind: "phase";
          readonly phase: Phase;
          /** Every step the head names, when more than one (CR 500.1). */
          readonly phases?: readonly Phase[];
          readonly scope: TriggerScope;
      }
    /** CR 603.2 — "whenever [you / an opponent / a player] casts a [black / nonred] spell". */
    | {
          readonly kind: "spell-cast";
          readonly scope: "you" | "opponent" | "any";
          readonly filter?: SpellFilter;
      };

/**
 * One compiled triggered ability. Every field is JSON — this interface has no
 * `matches` / `resolve` to lose, which is the whole point (see the header).
 */
export interface CompiledTriggeredAbility {
    readonly id: string;
    readonly oracleText: string;
    readonly head: CompiledTriggerHead;
    /** CR 603.4 — re-checked at resolution; the trigger fizzles when false. */
    readonly condition?: CompiledTriggerCondition;
    /**
     * CR 603.2h — the ability triggers at most this many times each turn per
     * source ("if you haven't added mana with this ability this turn"). Phase
     * heads only (`phaseTrigger`).
     */
    readonly maxTriggersPerTurn?: number;
    /**
     * CR 113.6b — the zone the ability functions from, when not the
     * battlefield. "At the beginning of your upkeep, if this card is in your
     * graveyard, …" (Gigapede, Genesis): the printed intervening-if IS the
     * zone, so it is carried here rather than as a `condition`. Phase heads
     * and non-self `entered` heads only — the factories that take a zone
     * (`phaseTrigger`, `enteredTrigger`).
     */
    readonly zone?: "graveyard";
    /** CR 603.3d — announced as the trigger goes on the stack. */
    readonly targetRequirement?: TargetRequirement;
    /** CR 608.2b — "This ability still resolves if its target becomes
     *  illegal." Entered heads only (`resolveCompiledTrigger` refuses the
     *  rest). */
    readonly resolvesIfTargetsIllegal?: true;
    /** ADR 0045 — the resolution body. Required: there is no escape hatch. */
    readonly effects: readonly EffectOp[];
}

/**
 * CR 603.4 — the condition as a live predicate.
 *
 * Counts the ABILITY CONTROLLER's battlefield, never the whole board: "if you
 * control a Goblin" is CR 109.5's "you", the ability's controller. A state
 * view that is absent fails CLOSED (the trigger does not fire) rather than
 * defaulting to true — an intervening-if that silently passes when it cannot
 * be evaluated is the "dropped intervening-if" misparse this compiler exists
 * to avoid, arriving one layer lower.
 */
function conditionHolds(
    condition: CompiledTriggerCondition,
    event: GameEvent,
    self: PermanentView,
    state: TriggerStateView | undefined
): boolean {
    // A self-decided gate rides the factory's `conditionOnSelf` and never
    // reaches here; answering it keeps the union exhaustive and the answer
    // honest.
    if (
        condition.kind === "kicker-paid" ||
        condition.kind === "cast-off-sorcery-timing"
    )
        return selfDecidedGate(condition)!(self);
    if (condition.kind === "self-has-type")
        return self.types.includes(condition.type);
    if (state === undefined) return false;
    if (condition.kind === "self-on-battlefield")
        return state.players.some((p) =>
            p.battlefield.some((permanent) => permanent.id === self.id)
        );
    if (condition.kind === "graveyard-creature-above")
        return creatureCardDirectlyAboveInGraveyard(state, self);
    if (condition.kind === "holds-exile-bundle")
        return holdsExileBundle(event, self, state);
    if (condition.kind === "basic-land-types") {
        // CR 603.4 — fail CLOSED on a field the event does not carry, like
        // the absent state view above. A hand-built stack item may carry no
        // firing event at all.
        if (event === undefined) return false;
        const row = getEventFieldRow(event.type, condition.player.eventField);
        const playerId = row?.family === "player" ? row.resolve(event) : null;
        if (playerId === undefined || playerId === null) return false;
        return countDomain(state as never, playerId) >= condition.atLeast;
    }
    if ("atMost" in condition) {
        // CR 603.4 — the subject's players; "some player" for `any-player`, and the
        // one opponent of a two-player game for `opponent` (CR 506.2). An
        // empty list (a state view missing the controller) fails CLOSED.
        const players = state.players.filter((p) =>
            condition.player === "any-player"
                ? true
                : condition.player === "you"
                  ? p.id === self.controllerId
                  : p.id !== self.controllerId
        );
        return players.some(
            (p) =>
                countMatching(
                    p,
                    condition.filter,
                    self,
                    condition.atMost + 1
                ) <= condition.atMost
        );
    }
    if (condition.kind === "controls-more")
        return controlsMore(condition, event, self, state);
    const player = state.players.find((p) => p.id === self.controllerId);
    if (player === undefined) return false;
    return (
        countMatching(player, condition.filter, self, condition.atLeast) >=
        condition.atLeast
    );
}

/**
 * How many of `player`'s battlefield permanents `filter` matches, counting no
 * further than `cap` (the caller only needs "at least N"). Reads the LIVE
 * colours through the one authority every other colour read uses.
 */
function countMatching(
    player: TriggerStateView["players"][number],
    filter: PermanentFilter,
    self: PermanentView,
    cap = Infinity
): number {
    let matched = 0;
    for (const permanent of player.battlefield) {
        if (
            matchesPermanentFilter(
                {
                    id: permanent.id,
                    types: permanent.types,
                    subtypes: permanent.subtypes,
                    supertypes: permanent.supertypes,
                    staticAbilities: permanent.staticAbilities,
                    controllerId: permanent.controllerId,
                    isToken: permanent.isToken,
                    power: permanent.power,
                    toughness: permanent.toughness,
                    // CR 105.2 / 613.1e — the LIVE colours, through the one
                    // authority every other colour read uses. The engine hands
                    // this gate the raw game state, whose instances carry no
                    // `colors` field, so a colour clause ("if you control a
                    // blue or black permanent") would otherwise match nothing.
                    colors:
                        permanent.colors ??
                        getEffectiveColors(
                            permanent as unknown as PermanentView
                        ),
                },
                filter,
                {
                    selfInstanceId: self.id,
                    selfControllerId: self.controllerId,
                }
            )
        ) {
            matched += 1;
            if (matched >= cap) break;
        }
    }
    return matched;
}

/**
 * CR 109.5 + CR 603.4 — the strict per-player comparison. Fails CLOSED when
 * the controller, or the player a `$event` field should name, cannot be found.
 */
function controlsMore(
    condition: Extract<CompiledTriggerCondition, { kind: "controls-more" }>,
    event: GameEvent,
    self: PermanentView,
    state: TriggerStateView
): boolean {
    const counts = new Map<string, number>();
    for (const p of state.players)
        counts.set(p.id, countMatching(p, condition.filter, self));
    const mine = counts.get(self.controllerId);
    if (mine === undefined) return false;
    const subject = condition.subject;
    const larger = (id: string): boolean => {
        const count = counts.get(id)!;
        if (condition.than === "you")
            return id !== self.controllerId && count > mine;
        for (const [other, n] of counts)
            if (other !== id && n >= count) return false;
        return true;
    };
    if (subject.kind === "opponent")
        return [...counts.keys()].some(
            (id) => id !== self.controllerId && larger(id)
        );
    if (subject.kind === "any-player") return [...counts.keys()].some(larger);
    // CR 603.4 — fail CLOSED on a field the event does not carry, like the
    // absent state view above.
    if (event === undefined) return false;
    const row = getEventFieldRow(event.type, subject.eventField);
    const playerId = row?.family === "player" ? row.resolve(event) : null;
    if (playerId === undefined || playerId === null) return false;
    return counts.has(playerId) && larger(playerId);
}

/** One descriptor → the real ability, through the hand-written factories. */
export function resolveCompiledTrigger(
    descriptor: CompiledTriggeredAbility
): TriggeredAbility {
    const head = descriptor.head;
    const effects = descriptor.effects as EffectOp[];
    const targeting =
        descriptor.targetRequirement !== undefined
            ? { targetRequirement: descriptor.targetRequirement }
            : {};
    // CR 603.4 — the SAME predicate is passed as both the check-time
    // `condition` and the resolution-time `interveningIf`, which is what an
    // intervening-if clause means: checked when the ability would trigger and
    // re-checked as it resolves. A predicate over the whole `GameEvent` union
    // is assignable to each factory's event-narrowed slot (contravariance),
    // and a `basic-land-types` condition reads "that player" off it, so one
    // closure
    // serves every head without a per-factory copy that could drift.
    // CR 702.33f / CR 400.7d — a cast-time fact (a kicker paid, the timing
    // used) is decided from the permanent alone, so it rides the factory's
    // `conditionOnSelf` (a DECIDED gate the bot's value model can evaluate)
    // instead of an opaque `condition` closure.
    const onSelf =
        descriptor.condition !== undefined
            ? selfDecidedGate(descriptor.condition)
            : undefined;
    if (
        onSelf !== undefined &&
        !(head.kind === "entered" && head.scope === "self")
    )
        throw new Error(
            `compiled trigger ${descriptor.id}: a ${descriptor.condition!.kind} condition needs a head that fires when this permanent enters`
        );
    const gating =
        descriptor.condition === undefined || onSelf !== undefined
            ? {}
            : (() => {
                  const condition = descriptor.condition;
                  const gate = (
                      event: GameEvent,
                      self: PermanentView,
                      state?: TriggerStateView
                  ): boolean => conditionHolds(condition, event, self, state);
                  // CR 610.3 — a printed-nowhere gate is checked once, at
                  // the departure: it is no CR 603.4 clause to re-check.
                  return condition.kind === "holds-exile-bundle"
                      ? { condition: gate }
                      : { condition: gate, interveningIf: gate };
              })();
    if (descriptor.maxTriggersPerTurn !== undefined && head.kind !== "phase")
        throw new Error(
            `compiled trigger ${descriptor.id}: maxTriggersPerTurn needs a phase head`
        );
    if (descriptor.resolvesIfTargetsIllegal && head.kind !== "entered")
        throw new Error(
            `compiled trigger ${descriptor.id}: resolvesIfTargetsIllegal needs an entered head`
        );
    const common = {
        id: descriptor.id,
        oracleText: descriptor.oracleText,
        effects,
        ...targeting,
        ...gating,
    };
    switch (head.kind) {
        case "entered":
            return enteredTrigger({
                ...common,
                ...(descriptor.resolvesIfTargetsIllegal
                    ? { resolvesIfTargetsIllegal: true }
                    : {}),
                ...(onSelf !== undefined ? { conditionOnSelf: onSelf } : {}),
                ...(descriptor.zone !== undefined
                    ? { zone: descriptor.zone }
                    : {}),
                scope: head.scope,
                ...(head.filter !== undefined ? { filter: head.filter } : {}),
            });
        case "died":
            return diedTrigger({
                ...common,
                scope: head.scope,
                ...(head.filter !== undefined ? { filter: head.filter } : {}),
            });
        case "left":
            return leftTrigger({ ...common, scope: head.scope });
        case "left-to-graveyard": {
            // CR 404.1 — the owner of the card, which `PERMANENT_LEFT` carries
            // as last-known information; the departure's cause is the
            // `causedByOpponent` helper the hand-written Sacred Ground reads.
            const { ownedBy, causedBy } = head;
            const inherited = (
                gating as {
                    condition?: (
                        event: GameEvent,
                        self: PermanentView,
                        state?: TriggerStateView
                    ) => boolean;
                }
            ).condition;
            const gate =
                ownedBy === undefined && causedBy === undefined
                    ? {}
                    : {
                          condition: (
                              event: PermanentLeftEvent,
                              self: PermanentView,
                              state?: TriggerStateView
                          ) =>
                              (ownedBy === undefined ||
                                  event.ownerId === self.controllerId) &&
                              (causedBy === undefined ||
                                  causedByOpponent(event, self)) &&
                              (inherited === undefined ||
                                  inherited(event, self, state)),
                      };
            return leftTrigger({
                ...common,
                ...gate,
                scope: head.scope,
                toZone: "graveyard",
                ...(head.filter !== undefined ? { filter: head.filter } : {}),
            });
        }
        case "library-to-graveyard":
            return libraryToGraveyardTrigger({ ...common });
        case "graveyard-entry":
            return graveyardEntryTrigger({
                ...common,
                graveyard: head.graveyard,
                ...(head.excludeSelf === true
                    ? { excludeSelf: true as const }
                    : {}),
                ...(head.colors !== undefined ? { colors: head.colors } : {}),
            });
        case "attacks":
            // CR 508.3a — the rule is per CREATURE, so a non-self scope fires
            // once per matching declared attacker and names it
            // `$event.combatant`. Under `self` the fan-out is a no-op (exactly
            // one attacker can match), and the flag is left OFF there so a
            // compiled "whenever this creature attacks" stays byte-identical
            // to the hand-written `attacksTrigger({ scope: "self" })` the gold
            // harness compares it against (`oracle/gold.ts`).
            return attacksTrigger({
                ...common,
                scope: head.scope ?? "self",
                ...(head.scope !== undefined && head.scope !== "self"
                    ? { perAttacker: true as const }
                    : {}),
            });
        case "attacks-or-blocks":
            return attacksOrBlocksTrigger({ ...common, scope: head.scope });
        case "combat-damage-to-player":
            // CR 510.1 — combat damage only, dealt BY this permanent, to a
            // player. `relation: "any"` because "a player" is symmetric: in a
            // two-player game the source's controller can be dealt combat
            // damage by their own creature (Goblin Lackey never can, but the
            // grammar must not encode which).
            return damageDealtTrigger({
                ...common,
                source: "self",
                isCombat: true,
                target: { kind: "player", player: { relation: "any" } },
            });
        case "damage-dealt":
            return damageDealtTrigger({
                ...common,
                source: head.source,
                ...(head.recipient === "opponent"
                    ? {
                          target: {
                              kind: "player" as const,
                              player: { relation: "opponent" as const },
                          },
                      }
                    : head.recipient === "player"
                      ? {
                            target: {
                                kind: "player" as const,
                                player: { relation: "any" as const },
                            },
                        }
                      : head.recipient === "creature"
                        ? {
                              target: {
                                  kind: "permanent" as const,
                                  filter: CREATURE_FILTER,
                              },
                          }
                        : {}),
            });
        case "damage-taken":
            return damageTakenTrigger({
                ...common,
                // CR 109.2 — `self`: the receiver is this very permanent.
                target:
                    head.scope === "host"
                        ? { kind: "host" }
                        : {
                              kind: "permanent",
                              filter: { controllerRelation: "self" },
                          },
            });
        case "attacks-unblocked":
            return attackerUnblockedTrigger(common);
        case "turned-face-up":
            return turnedFaceUpTrigger(common);
        case "tapped":
            return tappedTrigger({ ...common, scope: head.scope });
        case "tapped-for-mana": {
            // CR 605.1b — a for-mana tap trigger that only adds mana is a
            // mana ability: it resolves at once, inside the cost payment.
            // CR 605.4 — a fixed extra amount is declared to the predictive
            // potential-mana models (castability gate + auto-tap solver).
            const bonus = fixedExtraMana(common.effects);
            return tappedTrigger({
                ...common,
                scope: head.scope,
                forMana: true,
                manaAbility: true,
                ...(bonus !== undefined
                    ? {
                          manaBonusForPotential: {
                              appliesTo: "host" as const,
                              amount: { kind: "fixed" as const, mana: bonus },
                          },
                      }
                    : {}),
            });
        }
        case "cycled":
            return cycledTrigger(common);
        case "power-reached": {
            // CR 603.8 — the predicate is the trigger; `stateTrigger` wires the
            // resolve-time re-check. A state trigger takes no intervening-if
            // or other gate of its own.
            if (descriptor.condition !== undefined)
                throw new Error(
                    `compiled trigger ${descriptor.id}: a state trigger takes no condition`
                );
            return stateTrigger({
                id: common.id,
                oracleText: common.oracleText,
                // CR 613.4 — the EFFECTIVE power (counters 7c, anthems 7d), read
                // through the layer pipeline: the server's `state` is the live
                // GameState, whose `self` carries only the base power.
                condition: (self, state) =>
                    readEffectivePower(self, state) >= head.atLeast,
                effects: common.effects,
            });
        }
        case "phase":
            return phaseTrigger({
                ...common,
                ...(descriptor.zone !== undefined
                    ? { zone: descriptor.zone }
                    : {}),
                phase: head.phase,
                ...(head.phases !== undefined ? { phases: head.phases } : {}),
                ...(descriptor.maxTriggersPerTurn !== undefined
                    ? { maxTriggersPerTurn: descriptor.maxTriggersPerTurn }
                    : {}),
                scope: head.scope,
            });
        case "spell-cast":
            return spellCastTrigger({
                ...common,
                scope: head.scope === "opponent" ? "opponents" : head.scope,
                ...(head.filter !== undefined ? { filter: head.filter } : {}),
            });
        default: {
            const never: never = head;
            throw new Error(
                `compiled trigger: no factory for head ${JSON.stringify(never)}`
            );
        }
    }
}

type EffectivePowerReader = (
    self: PermanentView,
    state: TriggerStateView
) => number;

let effectivePowerReader: EffectivePowerReader | null = null;

/**
 * `gre/layers.ts` registers its CR 613.4 power reader here. `cards/` cannot
 * import the layer pipeline (it sits above this module in the import graph and
 * the cycle breaks registry initialisation), so the dependency is inverted.
 */
export function bindEffectivePowerReader(reader: EffectivePowerReader): void {
    effectivePowerReader = reader;
}

function readEffectivePower(
    self: PermanentView,
    state: TriggerStateView
): number {
    // Unbound only where the layer pipeline was never loaded (a pure card
    // fixture): the printed power is then the only power there is.
    return effectivePowerReader?.(self, state) ?? self.power ?? 0;
}

/**
 * ADR 0054 seam — rebuild every compiled descriptor into a real triggered
 * ability, and REMOVE the descriptor field from the expanded definition.
 *
 * Removing it is not tidiness. The expanded definition is what every engine
 * read sees (`getDefinition`) and what the gold harness compares against a
 * hand-written card; leaving the descriptor on it would make a compiled card
 * differ from its hand-written twin by a field that carries no behaviour, and
 * the harness would report that as a compiler defect on every trigger card.
 */
export function expandCompiledTriggers(base: CardDefinition): CardDefinition {
    const descriptors = base.compiledTriggeredAbilities;
    const grantDescriptors = base.compiledTriggeredGrantTemplates;
    if (
        (descriptors === undefined || descriptors.length === 0) &&
        (grantDescriptors === undefined || grantDescriptors.length === 0)
    )
        return base;
    const expanded: CardDefinition = { ...base };
    if (descriptors !== undefined && descriptors.length > 0) {
        expanded.triggeredAbilities = [
            ...(base.triggeredAbilities ?? []),
            ...descriptors.map(resolveCompiledTrigger),
        ];
        delete expanded.compiledTriggeredAbilities;
    }
    // CR 614.1c — a kicked entry rider's granted trigger (Necravolver): the
    // SAME factory dispatch a printed trigger uses, kept off the source's own
    // `triggeredGrantTemplates[]` twin like every other compiled field (see
    // {@link CardDefinition.compiledTriggeredGrantTemplates}).
    if (grantDescriptors !== undefined && grantDescriptors.length > 0) {
        expanded.triggeredGrantTemplates = [
            ...(base.triggeredGrantTemplates ?? []),
            ...grantDescriptors.map(resolveCompiledTrigger),
        ];
        delete expanded.compiledTriggeredGrantTemplates;
    }
    return expanded;
}

/** CR 605.4 — the constant mana a script of lone `addMana` Ops adds, or
 *  undefined when any pip is not a plain count (the models then see none). */
function fixedExtraMana(
    effects: EffectOp[] | undefined
): Partial<Record<Color, number>> | undefined {
    if (effects === undefined || effects.length === 0) return undefined;
    const total: Partial<Record<Color, number>> = {};
    for (const op of effects) {
        if (op.op !== "addMana") return undefined;
        for (const [color, amount] of Object.entries(op.mana)) {
            if (typeof amount !== "number") return undefined;
            total[color as Color] = (total[color as Color] ?? 0) + amount;
        }
    }
    return total;
}
