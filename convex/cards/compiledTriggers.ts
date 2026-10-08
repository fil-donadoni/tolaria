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
import { holdsExileBundle } from "./abilities/exileBundle";
import { phaseTrigger } from "./abilities/triggers/phaseTrigger";
import { spellCastTrigger } from "./abilities/triggers/spellCastTrigger";
import type { PermanentScope, TriggerScope } from "./abilities/triggers/shared";

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
 * The trigger-site conditions: `controls`, shared with the static slot's "as
 * long as you control …" (`compiledStatics.ts`), plus the members only an
 * intervening-if reads — they name the FIRING EVENT's player, and a static
 * ability has no firing event.
 */
export type CompiledTriggerCondition =
    | CompiledControlsCondition
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
     * CR 610.3 / ADR 0028 — the source holds an exile-and-return bundle
     * (`holdsExileBundle`). NOT an intervening-if: nothing is printed. It gates
     * the return an "exile … until this leaves the battlefield" creates, a
     * second one-shot effect that exists only if the first exiled something,
     * so it is checked when the departure fires and never re-checked.
     */
    | { readonly kind: "holds-exile-bundle" };

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
    /** CR 603.6a — "at the beginning of [your/each] <step>". */
    | {
          readonly kind: "phase";
          readonly phase: Phase;
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
    /** CR 603.3d — announced as the trigger goes on the stack. */
    readonly targetRequirement?: TargetRequirement;
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
    if (state === undefined) return false;
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
    const player = state.players.find((p) => p.id === self.controllerId);
    if (player === undefined) return false;
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
                condition.filter,
                {
                    selfInstanceId: self.id,
                    selfControllerId: self.controllerId,
                }
            )
        ) {
            matched += 1;
            if (matched >= condition.atLeast) return true;
        }
    }
    return false;
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
    const gating =
        descriptor.condition === undefined
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
        case "phase":
            return phaseTrigger({
                ...common,
                phase: head.phase,
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
