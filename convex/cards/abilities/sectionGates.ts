// Text-box SECTION gates — "as long as <this permanent's state>, it has
// [abilities]" applied to the abilities printed in one section of a card's
// text box. Shared by the two section-shaped layouts the engine reads:
//
//   - Class cards (CR 716.2a): "As long as this Class is level N or greater,
//     it has [abilities]" (`classLevels.ts`);
//   - station cards (CR 721.2a): "As long as this permanent has N or more
//     charge counters on it, it has [abilities]" (`station.ts`).
//
// Each gate reads the SOURCE (the permanent carrying the section), never the
// target, and wraps the ability's own predicate, so the section's abilities
// are exactly as live as the permanent's state says at every read.

import type {
    GameEvent,
    GateableStaticEffect,
    PermanentView,
    StaticCostModifier,
    TriggeredAbility,
    TriggerStateView,
} from "../types";

/** Whether the section is in force for the permanent carrying it. */
export type SectionInForce = (source: PermanentView) => boolean;

/** CR 601.2f — the gate for a cost modifier: both `appliesTo*` predicates,
 *  because a modifier may scope spells, abilities or both. An absent
 *  `effectSource` fails closed, since the section's state cannot be read. */
function gateCostModifier(
    effect: StaticCostModifier,
    inForce: SectionInForce
): StaticCostModifier {
    const { appliesToSpell, appliesToAbility } = effect;
    const live = (effectSource?: PermanentView): boolean =>
        effectSource !== undefined && inForce(effectSource);
    return {
        ...effect,
        ...(appliesToSpell
            ? {
                  appliesToSpell: (card, ctx, effectSource, announcerId) =>
                      live(effectSource) &&
                      appliesToSpell(card, ctx, effectSource, announcerId),
              }
            : {}),
        ...(appliesToAbility
            ? {
                  appliesToAbility: (
                      source,
                      ctx,
                      effectSource,
                      ability,
                      activatorId
                  ) =>
                      live(effectSource) &&
                      appliesToAbility(
                          source,
                          ctx,
                          effectSource,
                          ability,
                          activatorId
                      ),
              }
            : {}),
    };
}

/** A static effect printed in a gated section: its `applies` predicate (or a
 *  cost modifier's `appliesTo*`) holds only while the section is in force. */
export function gateSectionStatic(
    effect: GateableStaticEffect,
    inForce: SectionInForce
): GateableStaticEffect {
    if (effect.kind === "cost-modifier")
        return gateCostModifier(effect, inForce);
    const applies = effect.applies as (
        target: PermanentView,
        source: PermanentView,
        ctx: unknown
    ) => boolean;
    return {
        ...effect,
        applies: (target: PermanentView, source: PermanentView, ctx: unknown) =>
            inForce(source) && applies(target, source, ctx),
    } as GateableStaticEffect;
}

/** A triggered ability printed in a gated section: it is not an ability of
 *  the permanent while the section is out of force, so it cannot trigger
 *  there (CR 603.2 — only an ability the object HAS can trigger). */
export function gateSectionTrigger(
    ability: TriggeredAbility,
    inForce: SectionInForce
): TriggeredAbility {
    const matches = ability.matches;
    return {
        ...ability,
        matches: (
            event: GameEvent,
            self: PermanentView,
            state?: TriggerStateView
        ) => inForce(self) && matches(event, self, state),
    };
}
