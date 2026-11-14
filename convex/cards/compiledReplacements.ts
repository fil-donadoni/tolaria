/**
 * JSON-pure replacement-effect descriptors — the seam the Oracle compiler
 * emits a CR 614 replacement effect through, the way `compiledStatics.ts` is
 * the seam for a CR 611 continuous effect.
 *
 * An engine replacement is a closure (`ReplacementEffect.appliesTo` /
 * `replace`, `DrawReplacementEffect.applies`), and a compiled definition is
 * JSON only (gate 5, `oracle/gates.ts`). So the compiler writes a DESCRIPTOR
 * on `CardDefinition.compiledReplacements` and `expandCompiledReplacements`
 * rebuilds it at the `expandDefinition` seam into the field the engine reads,
 * then removes the descriptor — no engine read ever sees it.
 *
 * Each descriptor carries an optional condition slot: "Max speed — <ability>"
 * (CR 702.178a) means the object has the ability only as long as its
 * controller's speed is 4, so the gate is read every time the event would be
 * replaced, never once at the start.
 */

import { hasMaxSpeed } from "../gre/speed";
import type { CompiledStaticCondition } from "./compiledStatics";
import type {
    CardDefinition,
    DrawReplacementEffect,
    PermanentView,
    ReplacementEffect,
    ReplacementStateView,
} from "./types";

/** The conditions a replacement's state view can answer. The view carries
 *  each player's speed and nothing a `controls` filter would need, so only
 *  the max speed gate is admitted (CR 702.179e). */
export type CompiledReplacementCondition = Extract<
    CompiledStaticCondition,
    { readonly kind: "you-have-max-speed" }
>;

/** The replacement effects the compiler can emit (CR 614). Closed. */
export type CompiledReplacementEffect =
    /**
     * CR 614.1a / 121.2 — "If you would draw a card, draw N cards instead":
     * each of the controller's single-card draws becomes N draws. Rebuilds
     * into the `drawReplacement` field with a `multiply-count` outcome.
     */
    | {
          readonly kind: "draw-count";
          readonly id: string;
          readonly oracleText: string;
          readonly count: number;
          readonly condition?: CompiledReplacementCondition;
      }
    /**
     * CR 614.1a — "If a source you control would deal damage to an opponent
     * or a permanent an opponent controls, it deals that much damage plus N
     * instead." Rebuilds into an `eventKind: "damage"` replacement whose
     * amount rewrite is neither prevention nor redirection (CR 615.1a — the
     * word "prevent" is absent).
     */
    | {
          readonly kind: "damage-bonus";
          readonly id: string;
          readonly oracleText: string;
          readonly amount: number;
          readonly condition?: CompiledReplacementCondition;
      };

/** CR 702.178a / 702.179e — the gate, read against the source's CURRENT
 *  controller (CR 109.5). Fails closed on a controller the view lacks. */
function replacementConditionHolds(
    condition: CompiledReplacementCondition | undefined,
    source: PermanentView,
    state: ReplacementStateView
): boolean {
    if (condition === undefined) return true;
    const controller = state.players.find((p) => p.id === source.controllerId);
    return controller !== undefined && hasMaxSpeed(controller);
}

/** CR 614.1a / 121.2 — the rebuilt draw replacement: the controller's own
 *  draws ("you would draw"), each one card at a time. */
export function compiledDrawReplacement(
    descriptor: Extract<CompiledReplacementEffect, { kind: "draw-count" }>
): DrawReplacementEffect {
    const { condition } = descriptor;
    return {
        id: descriptor.id,
        oracleText: descriptor.oracleText,
        applies: (event, source, state) =>
            event.drawingPlayer === source.controllerId &&
            replacementConditionHolds(condition, source, state),
        outcome: { kind: "multiply-count", factor: descriptor.count },
    };
}

/** CR 614.1a / 109.5 — the rebuilt damage replacement: a source the effect's
 *  controller controls, dealing damage to a player other than that
 *  controller or to a permanent such a player controls. */
export function compiledDamageBonusReplacement(
    descriptor: Extract<CompiledReplacementEffect, { kind: "damage-bonus" }>
): ReplacementEffect {
    const { amount, condition } = descriptor;
    return {
        id: descriptor.id,
        oracleText: descriptor.oracleText,
        eventKind: "damage",
        damageEffectKind: "other",
        appliesTo: (event, self, state) => {
            if (event.kind !== "damage") return false;
            // CR 120.8 — damage of 0 is not dealt, so there is nothing to add to.
            if (event.amount <= 0) return false;
            if (event.sourceControllerId !== self.controllerId) return false;
            if (!replacementConditionHolds(condition, self, state))
                return false;
            if (event.target.type === "player")
                return event.target.id !== self.controllerId;
            if (event.target.type !== "permanent") return false;
            const targetId = event.target.id;
            for (const player of state.players) {
                const permanent = player.battlefield.find(
                    (c) => c.id === targetId
                );
                if (permanent !== undefined)
                    return permanent.controllerId !== self.controllerId;
            }
            return false;
        },
        replace: (event) => {
            if (event.kind !== "damage") return { kind: "consumed" };
            return {
                kind: "modified",
                event: { ...event, amount: event.amount + amount },
            };
        },
    };
}

/**
 * ADR 0054 seam — rebuild `compiledReplacements` into `replacementEffects[]`
 * and `drawReplacement`, and REMOVE the field. A card holds one
 * `drawReplacement`, so a second draw descriptor, or one beside a declared
 * draw replacement, throws: the lowering refuses that card first.
 */
export function expandCompiledReplacements(
    base: CardDefinition
): CardDefinition {
    const descriptors = base.compiledReplacements;
    if (descriptors === undefined) return base;
    const replacementEffects = [...(base.replacementEffects ?? [])];
    let drawReplacement = base.drawReplacement;
    for (const descriptor of descriptors) {
        switch (descriptor.kind) {
            case "draw-count":
                if (drawReplacement !== undefined)
                    throw new Error(
                        `${base.name}: a second draw replacement (${descriptor.id})`
                    );
                drawReplacement = compiledDrawReplacement(descriptor);
                break;
            case "damage-bonus":
                if (!replacementEffects.some((r) => r.id === descriptor.id))
                    replacementEffects.push(
                        compiledDamageBonusReplacement(descriptor)
                    );
                break;
            default: {
                const never: never = descriptor;
                throw new Error(
                    `no rebuild for compiled replacement ${JSON.stringify(never)}`
                );
            }
        }
    }
    const expanded: CardDefinition = {
        ...base,
        ...(replacementEffects.length > 0 ? { replacementEffects } : {}),
        ...(drawReplacement !== undefined ? { drawReplacement } : {}),
    };
    delete expanded.compiledReplacements;
    return expanded;
}
