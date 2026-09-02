/**
 * Lowering: triggered-ability IR → `CompiledTriggeredAbility` (CR 113.3c,
 * ADR 0045 / ADR 0105).
 *
 * The output is a JSON-pure DESCRIPTOR, not a `TriggeredAbility`: that
 * interface's `matches` is a required closure and the compiler emits JSON only
 * (see `cards/compiledTriggers.ts` for the full argument). The descriptor is
 * rebuilt into the real ability at the registry seam, through the same
 * factories a hand-written card calls.
 *
 * Target slots are allocated by the SAME walk the activated site uses
 * (`lowerEffects.ts`), so a trigger's `{ target: 0 }` and the requirement that
 * declares it are assigned once, in sentence order — and the one-target
 * ceiling grammar v0 imposes is the shared one, not a second copy that could
 * drift.
 */

import type { PermanentFilter } from "../cards/filters";
import type {
    CompiledTriggerCondition,
    CompiledTriggerHead,
    CompiledTriggeredAbility,
} from "../cards/compiledTriggers";
import type { EffectOp, TargetRequirement } from "../cards/types";
import type { ConditionIR } from "./grammar/shared/condition";
import type { EffectSentenceIR } from "./grammar/shared/effectClause";
import type { TriggerHeadIR } from "./grammar/shared/triggerHead";
import { declareTargets, lowerSentence, TargetSlots } from "./lowerEffects";

export type LowerTriggerResult =
    | { readonly ok: true; readonly ability: CompiledTriggeredAbility }
    | { readonly ok: false; readonly reason: string };

/** CR 603.6a — the entering permanent's type narrowing, when the head has one. */
const CREATURE_FILTER: PermanentFilter = { types: ["Creature"] };

/** Head IR → the engine-side head descriptor. */
function lowerHead(head: TriggerHeadIR): CompiledTriggerHead {
    switch (head.kind) {
        case "enters":
            return head.creaturesOnly
                ? {
                      kind: "entered",
                      scope: head.scope,
                      filter: CREATURE_FILTER,
                  }
                : { kind: "entered", scope: head.scope };
        case "dies":
            // CR 603.6 — the event IS `CREATURE_DIED`, so the head carries no
            // type filter: a second authority on the same fact is a second
            // thing to get wrong.
            return { kind: "died", scope: head.scope };
        case "attacks":
            return { kind: "attacks" };
        case "combat-damage-to-player":
            return { kind: "combat-damage-to-player" };
        case "phase":
            return { kind: "phase", phase: head.phase, scope: head.scope };
        case "spell-cast":
            return { kind: "spell-cast", scope: head.scope };
    }
}

/** CR 603.4 — the condition IR is already the engine's shape. */
function lowerCondition(condition: ConditionIR): CompiledTriggerCondition {
    return {
        kind: "controls",
        filter: condition.filter,
        atLeast: condition.atLeast,
    };
}

export function lowerTriggeredAbility(input: {
    readonly id: string;
    readonly oracleText: string;
    readonly head: TriggerHeadIR;
    readonly condition?: ConditionIR;
    readonly effects: readonly EffectSentenceIR[];
}): LowerTriggerResult {
    const slots = new TargetSlots();
    const ops: EffectOp[] = [];
    for (const sentence of input.effects) {
        // CR 107.3 — a triggered ability has no cost and announces nothing,
        // so an X in its body has no value to read.
        const result = lowerSentence(sentence, slots, {
            allowX: false,
        });
        if (!result.ok) return { ok: false, reason: result.reason };
        ops.push(...result.value);
    }

    // CR 603.3d — a triggered ability's targets are announced as it goes on
    // the stack. `declareTargets` writes at most one and REFUSES more, which
    // is the same ceiling and the same refusal the activated site pays.
    const declared: { targetRequirement?: TargetRequirement } = {};
    const targetError = declareTargets(declared, slots.requirements());
    if (targetError !== null) return { ok: false, reason: targetError };

    return {
        ok: true,
        ability: {
            id: input.id,
            oracleText: input.oracleText,
            head: lowerHead(input.head),
            ...(input.condition !== undefined
                ? { condition: lowerCondition(input.condition) }
                : {}),
            ...(declared.targetRequirement !== undefined
                ? { targetRequirement: declared.targetRequirement }
                : {}),
            effects: ops,
        },
    };
}
