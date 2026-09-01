// The single enumeration of a card's Effect Script SITES, shared by every
// catalogue-wide script sweep (ADR 0045 / ADR 0046).
//
// A `CardDefinition` carries scripts in five distinct places — the spell site
// (`effects` / `aiEffects`), activated abilities, triggered abilities (plus both
// grant-template flavours), and cast-time MODES (`modes[].effects`, CR 700.2).
// Every sweep that walks "all of a card's scripts" needs the SAME list, and a
// hand-rolled second walker is how a site silently stops being covered: the
// Kicker declaration guard (issue #1937) shipped omitting `modes[].effects` and
// `aiEffects`, so a `{ additionalCostPaid: "<id>" }` inside a modal card's mode script
// escaped the fail-closed trap that guard exists to be. Adding a new site kind
// here covers every sweep at once.

import type { CardDefinition } from "../types";

/** Every ability site (activated + triggered, plus both grant-template
 *  flavours) on a card that can carry an Effect Script, tagged with the owning
 *  card's label (ADR 0045, issue #803). Modes carry their own per-mode
 *  resolution site; those are spell-site scripts enumerated by `modeSites`
 *  below (a mode's script lives on `mode.effects`, NOT on `card.effects`, so
 *  the card-level `validateEffectScript` pass returns early and never reaches
 *  them). */
export function abilitySites(card: CardDefinition): {
    ability: {
        id: string;
        effects?: unknown;
        aiEffects?: unknown;
        /** CR 700.2 / 603.3c — declared so the modal mutual-exclusivity check
         *  in `validateAbilityEffectScript` sees the field it validates rather
         *  than relying on it riding along untyped (issue #2461). */
        modes?: unknown;
    };
    label: string;
    triggerEventType?: string;
}[] {
    const label = `${card.name} (${card.id})`;
    // Activated abilities have no firing event ($event illegal); triggered
    // abilities carry `event`, threaded so the trigger-site $event scope
    // (ADR 0049, issue #865) is validated with the right event type.
    const activated = [
        ...(card.activatedAbilities ?? []),
        ...(card.grantTemplates ?? []),
    ].map((ability) => ({ ability, label }));
    const triggered = [
        ...(card.triggeredAbilities ?? []),
        ...(card.triggeredGrantTemplates ?? []),
    ].map((ability) => ({
        ability,
        label,
        // A single-event trigger pins one event type for `$event.<field>`
        // static validation (ADR 0049); an array-`event` (multi-event, CR
        // 603.2) has no single firing type — leave it undefined, which is
        // sound since an Effect Script cannot read `$event` anyway.
        triggerEventType: Array.isArray(
            (ability as { event?: string | string[] }).event
        )
            ? undefined
            : (ability as { event?: string }).event,
    }));
    // CR 714.2 (ADR 0078) — a Saga's chapter lines (`chapterAbilities[]`) need
    // no branch here: `getAllCards()` routes through `expandDefinition`
    // (`cards/index.ts`), which desugars them into `COUNTER_ADDED` triggers, so
    // every chapter's Effect Script already arrives above as a
    // `triggeredAbilities[]` entry.
    //
    // CR 700.2 / 602.2b (issue #1341) — each MODE of a modal ACTIVATED ability
    // is its own ability-site script: it resolves with the source's `$source` /
    // `$host` in scope and no firing event, and its `effects` are mutually
    // exclusive with the mode's own `resolve`. Wrapped as a synthetic ability
    // so the same validator walks it (the ability-site twin of `modeSites`
    // below, which covers the cast-time `modes[]` of a SPELL).
    //
    // CR 603.3c (issue #2461) — each mode of a modal TRIGGERED ability is the
    // same kind of site: same `AbilityMode` shape, same `$source`/`$host`
    // bindings, same mutual exclusivity with the mode's own `resolve`. It is
    // wrapped identically, WITHOUT threading `triggerEventType`: an
    // announcement-time mode script cannot read `$event` (the interpreter binds
    // the event only for an ability-level trigger script), so pinning the
    // firing type here would legalize a ref the runtime never fills.
    const abilityModes = [
        ...(card.activatedAbilities ?? []),
        ...(card.grantTemplates ?? []),
        ...(card.triggeredAbilities ?? []),
        ...(card.triggeredGrantTemplates ?? []),
    ].flatMap((ability) =>
        (ability.modes ?? []).map((mode) => ({
            ability: {
                id: `${ability.id}#${mode.id}`,
                effects: mode.effects,
                resolve: mode.resolve,
            },
            label,
        }))
    );
    return [...activated, ...triggered, ...abilityModes];
}

/** Every cast-time MODE site (CR 700.2 / 601.2c `modes[]`) on a card that
 *  carries an Effect Script, wrapped as a synthetic spell-site host so
 *  `validateEffectScript` walks it: a mode resolves like a spell (no
 *  `$source` permanent, no firing `$event`), and its `effects` are mutually
 *  exclusive with the mode's own `resolve` — exactly the spell-site rules. */
export function modeSites(card: CardDefinition): {
    host: CardDefinition;
    label: string;
    effects: unknown;
}[] {
    return (card.modes ?? [])
        .filter((mode) => mode.effects !== undefined)
        .map((mode) => ({
            host: {
                ...card,
                id: `${card.id}#${mode.id}`,
                name: `${card.name} mode "${mode.id}"`,
                effects: mode.effects,
                // The card-level authoring fields belong to the CARD, not to
                // this mode — only the mode's own `resolve` would conflict.
                resolve: mode.resolve,
                resolveSteps: undefined,
                effect: undefined,
                modes: undefined,
            } as CardDefinition,
            label: `${card.name} (${card.id}) mode "${mode.id}"`,
            effects: mode.effects,
        }));
}

/** Every raw Effect-Script-bearing VALUE on a card, for sweeps that only need
 *  to walk the scripts (not validate them site by site): the spell site and its
 *  `aiEffects` shadow (PRD #1423), every ability site and its shadow, and every
 *  cast-time mode site (CR 700.2). Derived from `abilitySites`/`modeSites`
 *  above so the three stay in lockstep. */
export function allEffectScriptValues(card: CardDefinition): unknown[] {
    const values: unknown[] = [];
    const push = (v: unknown) => {
        if (v !== undefined) values.push(v);
    };
    push(card.effects);
    push(card.aiEffects);
    for (const site of abilitySites(card)) {
        push(site.ability.effects);
        push(site.ability.aiEffects);
    }
    for (const site of modeSites(card)) push(site.effects);
    return values;
}
