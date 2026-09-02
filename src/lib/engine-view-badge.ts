import type { CardDefinition, EffectOp } from "@convex/cards/types";

/**
 * The Card Preview's Engine View BADGE (ADR 0103 §9, issue #2728) — the
 * DSL/Protocol claim the slot's chip renders, and the `badge` field of the
 * Engine View TREE (issue #2704, `~/lib/engine-view-tree.ts`).
 *
 * Split out of `~/lib/preview-body.ts` when #2704 landed the tree: the tree
 * needs the badge (it is the same claim, and the two must never disagree) and
 * `preview-body.ts` needs the tree, so leaving the badge where it was made
 * those two modules import each other. One module, one direction:
 * `engine-view-badge` ← `engine-view-tree` ← `preview-body`.
 *
 * `preview-body.ts` re-exports {@link EngineViewBadge} and
 * {@link computeEngineViewBadge} so its existing importers — including the
 * catalogue-wide guard `src/lib/__tests__/engine-view-badge.catalogue.test.ts`
 * — keep resolving them at the path they were written against.
 */

/** How the engine implements a card's effect, read off the real
 *  `CardDefinition` — never a projected/wire field. `tryGetDefinition` is a
 *  client-side registry lookup (`convex/cards/registry.ts`) and
 *  `projectPublicState` never touches `CardDefinition`, so this is safe to
 *  compute purely client-side (ADR 0045/0046, issue #2728). */
export type EngineViewBadge =
    /** At least one resolution body on the card is HAND-WRITTEN TypeScript —
     *  `resolve()`, `resolveSteps[]`, or an ability's mana-ability `effect`
     *  closure. Wins outright over any Effect Script elsewhere on the same
     *  card: the badge is a claim about how the engine READS the card, and
     *  "some of it is imperative" is the honest reading. */
    | { kind: "protocol" }
    /** Every resolution body is declarative — an Effect Script (`effects[]`)
     *  or the registry `effect` shorthand — and there is at least one. */
    | { kind: "dsl"; opCount: number }
    /** No resolution body at all: a vanilla/French-vanilla creature, a basic
     *  land, a pure-`staticEffects[]` anthem. 24.6% of the catalogue. The
     *  slot still renders (it is #2704's mount point) but shows NO chip —
     *  a `DSL` chip here would assert a script the card does not have. */
    | { kind: "none" };

/** One site on a `CardDefinition` that can carry a resolution body. Structural
 *  (not the nominal `SpellMode`/`ActivatedAbility`/… union) because all four
 *  shapes are read identically here, and because `effect` means two different
 *  things depending on the owner — see {@link hasHandWrittenBody}. */
type ResolutionSite = {
    resolve?: unknown;
    resolveSteps?: unknown[];
    effect?: unknown;
    effects?: readonly EffectOp[];
};

/** Every site on `def` that can carry a resolution body — the single census
 *  both the imperative check and the Op count walk, so the two can never
 *  disagree about which producers exist (`convex/cards/types.ts`):
 *
 *  | site                                  | bodies it can carry                      |
 *  | ------------------------------------- | ---------------------------------------- |
 *  | the card itself                       | `resolve`, `resolveSteps`, `effect`(*), `effects` |
 *  | `modes[]` (modal spell, CR 700.2)     | `resolve`, `resolveSteps`, `effects`     |
 *  | `triggeredAbilities[]` + their modes  | `resolve`, `resolveSteps`, `effects`     |
 *  | `activatedAbilities[]` + their modes  | + the mana-ability `effect` CLOSURE      |
 *  | `grantTemplates[]` + their modes      | idem — a granted activated ability       |
 *  | `triggeredGrantTemplates[]` + modes   | idem — a granted triggered ability       |
 *  | `delayedTriggers[]` (CR 603.7a)       | `resolve`, `resolveSteps`, `effects`     |
 *
 *  (*) on the CARD, `effect` is the declarative `EffectShorthand` registry key,
 *  never a closure — see {@link hasHandWrittenBody}.
 *
 *  `chapterAbilities[]` (CR 714) is deliberately absent: `expandDefinition`
 *  (`convex/cards/registry.ts`) desugars it into `triggeredAbilities[]` before
 *  any registry lookup returns, and every path into this module goes through
 *  `tryGetDefinition`, so the chapters are already in the array above. */
function resolutionSites(def: CardDefinition): ResolutionSite[] {
    const sites: ResolutionSite[] = [def];
    for (const mode of def.modes ?? []) sites.push(mode);
    for (const ability of [
        ...(def.triggeredAbilities ?? []),
        ...(def.activatedAbilities ?? []),
        // Granted abilities (Urza's Saga chapter II, Splinter Twin, Zombie
        // Master) live in their own template arrays and never appear in the
        // two above — omitting them read Urza's Saga, whose granted ability
        // is a documented protocol-like `resolve()`, as `DSL · 5`.
        ...(def.grantTemplates ?? []),
        ...(def.triggeredGrantTemplates ?? []),
    ]) {
        sites.push(ability);
        for (const mode of ability.modes ?? []) sites.push(mode);
    }
    for (const t of def.delayedTriggers ?? []) sites.push(t);
    return sites;
}

/** True when this site's body is hand-written TypeScript rather than data —
 *  the DSL-first escape hatch a card earns only with a recorded justification
 *  (ADR 0045, `.claude/rules/gre-development.md` § DSL-first authoring, which
 *  names all three of `resolve()` / `resolveSteps` / `effect`).
 *
 *  The `typeof === "function"` test on `effect` is load-bearing, because the
 *  field is overloaded: on an `ActivatedAbility` it is the mana-ability
 *  CLOSURE (`(ctx: ActivatedAbilityContext) => void`, `types.ts` — Black
 *  Lotus, Sol Ring, Birds of Paradise, every dual land), while on the
 *  `CardDefinition` it is `EffectShorthand`, a declarative registry key the
 *  engine compiles at lookup time (Disenchant, Stone Rain). Same name,
 *  opposite verdicts. */
function hasHandWrittenBody(site: ResolutionSite): boolean {
    return (
        typeof site.resolve === "function" ||
        typeof site.effect === "function" ||
        (Array.isArray(site.resolveSteps) && site.resolveSteps.length > 0)
    );
}

/** Counts Effect Script Ops, walking every structural nesting shape the DSL
 *  admits (ADR 0045/0046): a plain list, `if`'s `then`/`else` branches, a
 *  `choice`/modal Op's `modes[]`, and the inline bodies of `forEach` /
 *  `delayedTrigger` / `reflexiveTrigger` — all keyed `effects`
 *  (`convex/cards/types.ts`). A presence count, not the interpreter-coverage
 *  `n/n` the real Engine View tree (#2704) computes. */
function countEffectOps(effects: readonly EffectOp[] | undefined): number {
    if (!effects) return 0;
    let count = 0;
    for (const op of effects) {
        count += 1;
        const nested = op as unknown as {
            effects?: EffectOp[];
            then?: EffectOp[];
            else?: EffectOp[];
            modes?: { effects?: EffectOp[] }[];
        };
        count += countEffectOps(nested.effects);
        count += countEffectOps(nested.then);
        count += countEffectOps(nested.else);
        for (const mode of nested.modes ?? [])
            count += countEffectOps(mode.effects);
    }
    return count;
}

/** Declarative Ops contributed by ONE site: its Effect Script, plus 1 for the
 *  `EffectShorthand` (a single registered primitive — `effectRegistry.ts`)
 *  when the site carries one. A closure-valued `effect` is never counted here
 *  — {@link hasHandWrittenBody} has already ruled the whole card `protocol`. */
function countSiteOps(site: ResolutionSite): number {
    const shorthand =
        site.effect !== undefined && typeof site.effect !== "function" ? 1 : 0;
    return shorthand + countEffectOps(site.effects);
}

/** Reads the DSL/protocol badge straight off the real `CardDefinition` (see
 *  {@link EngineViewBadge}). Protocol wins over DSL when a card carries both
 *  (Mishra's Factory: an imperative mana closure beside two Effect Scripts) —
 *  the fail-safe direction, since the alternative advertises a purity the
 *  card does not have. */
export function computeEngineViewBadge(def: CardDefinition): EngineViewBadge {
    const sites = resolutionSites(def);
    if (sites.some(hasHandWrittenBody)) return { kind: "protocol" };
    const opCount = sites.reduce((n, site) => n + countSiteOps(site), 0);
    return opCount > 0 ? { kind: "dsl", opCount } : { kind: "none" };
}
