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

import { matchesPermanentFilter } from "./filters";
import type { PermanentFilter } from "./filters";
import type {
    EffectOp,
    PermanentView,
    TargetRequirement,
    TriggeredAbility,
    TriggerStateView,
} from "./types";
import type { CardDefinition } from "./types";
import type { Phase } from "../gre/types";
import { attacksTrigger } from "./abilities/triggers/attacksTrigger";
import { damageDealtTrigger } from "./abilities/triggers/damageDealtTrigger";
import { diedTrigger } from "./abilities/triggers/diedTrigger";
import { enteredTrigger } from "./abilities/triggers/enteredTrigger";
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
export type CompiledTriggerCondition = {
    readonly kind: "controls";
    readonly filter: PermanentFilter;
    readonly atLeast: number;
};

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
    /** CR 508.1 — "whenever this creature attacks". */
    | { readonly kind: "attacks" }
    /** CR 119.3 / 510.1 — "whenever this creature deals combat damage to a player". */
    | { readonly kind: "combat-damage-to-player" }
    /** CR 603.6a — "at the beginning of [your/each] <step>". */
    | {
          readonly kind: "phase";
          readonly phase: Phase;
          readonly scope: TriggerScope;
      }
    /** CR 603.2 — "whenever [you / an opponent / a player] casts a spell". */
    | {
          readonly kind: "spell-cast";
          readonly scope: "you" | "opponent" | "any";
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
    self: PermanentView,
    state: TriggerStateView | undefined
): boolean {
    if (state === undefined) return false;
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
    // re-checked as it resolves. A predicate over `unknown` is assignable to
    // each factory's event-narrowed slot (contravariance), so one closure
    // serves every head without a per-factory copy that could drift.
    const gating =
        descriptor.condition === undefined
            ? {}
            : (() => {
                  const condition = descriptor.condition;
                  const gate = (
                      _event: unknown,
                      self: PermanentView,
                      state?: TriggerStateView
                  ): boolean => conditionHolds(condition, self, state);
                  return { condition: gate, interveningIf: gate };
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
        case "attacks":
            return attacksTrigger({ ...common, scope: "self" });
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
    if (descriptors === undefined || descriptors.length === 0) return base;
    const expanded: CardDefinition = {
        ...base,
        triggeredAbilities: [
            ...(base.triggeredAbilities ?? []),
            ...descriptors.map(resolveCompiledTrigger),
        ],
    };
    delete expanded.compiledTriggeredAbilities;
    return expanded;
}
