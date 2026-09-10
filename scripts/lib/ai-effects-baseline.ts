/**
 * The aiEffects guard's BASELINE - the AI-blind population that predates the
 * guard, stored as a generated `data/` artifact instead of four hand-written
 * literal arrays in the test file (issue #3017).
 *
 * WHY THIS MOVED OUT OF THE TEST FILE
 *
 * Issue #1431 shipped the guard with an allowlist of every then-current
 * offender and stated the list would drain itself: "As migration drains FREE
 * -> effects[], those cards leave the allowlist automatically." That is false.
 * The arrays were literals keyed by a static `cardId`; nothing pruned them, so
 * migrating an allowlisted card turned the guard RED until a human hand-deleted
 * its block from a 3.3k-line test file. 497 entries across four arrays, all in
 * one file, in a repo whose merge discipline is a serial train: the allowlist
 * was the serialization point of the whole resolve()->effects[] migration, and
 * it was a test fixture.
 *
 * Staleness was DETECTED, never REPAIRED. This module repairs it.
 *
 * PRUNE-ONLY, WHICH IS NOT A RE-BASELINE
 *
 * `convex/cards/__tests__/compilerRoundTrip.baseline.ts` (SHRINK-ONLY) makes
 * the OPPOSITE call for Guard C's baseline, and says why: "a regeneration
 * command is a re-baseline command, and a baseline anybody can re-take is not
 * a baseline." That reasoning is right, and it does not reach this artifact,
 * because the two baselines differ in what a row CARRIES.
 *
 * A Guard C row carries a JUDGEMENT - the direction of the defect (compiler
 * gap / card defect / undetermined). Re-taking that baseline would have a
 * script auto-classify what a human adjudicated, which is why it has no
 * generator.
 *
 * An aiEffects row carries no judgement in the SHRINK direction: a row leaves
 * when its card or ability stops matching a purely mechanical predicate. So
 * the tool here PRUNES ONLY - {@link pruneBaseline} deletes rows whose subject
 * no longer offends and does nothing else:
 *
 *   - It NEVER adds a row. A live offender missing from the baseline is a
 *     hard refusal, with the same message the guard prints - a NEW resolve()
 *     card ships `aiEffects`/`aiValue`, it does not buy a baseline slot. This
 *     is strictly STRONGER than Guard C's `BASELINE_CEILING`, which a diff can
 *     satisfy by deleting a graduating row and spending the freed slot.
 *   - It NEVER writes a `note`. The disposition is human prose; a surviving
 *     row keeps the one it was authored with, verbatim.
 *   - It NEVER repairs a drifted `name`. An id that has moved onto a different
 *     card is the rebuilt/renumbered-catalogue signal the guard exists to
 *     surface, so it stays red for a human (see {@link AiEffectsNameDrift}).
 *
 * SHAPE: IMMUNE BY SHAPE, DELIBERATELY
 *
 * A bare array of per-row objects, sorted, one field per line - no header, no
 * content hash, no tally. That is the `data/card-index.json` shape, and
 * `scripts/lib/generated-artifacts.ts` explains why it matters: an artifact
 * conflicts when it commits a field that is a function of the WHOLE file, and
 * this one has none. Two PRs migrating two different cards touch disjoint line
 * ranges, which is the collision this issue set out to remove. The immunity is
 * pinned by `scripts/__tests__/generated-artifact-merge.test.ts` so it cannot
 * silently lapse, and the artifact is therefore NOT a member of
 * `REGENERATED_ARTIFACTS`.
 */

import type {
    ActivatedAbility,
    CardDefinition,
    DelayedTriggerDef,
    TriggeredAbility,
} from "../../convex/cards/types";

/** Repo-relative path of the committed baseline. */
export const AI_EFFECTS_BASELINE_PATH = "data/ai-effects-allowlist.json";

/** The `package.json` script that prunes it, run as `bun run <script>`. */
export const AI_EFFECTS_BASELINE_SCRIPT = "ai:allowlist";

/**
 * The four offender classes the guard sweeps, each the scope of one of the
 * literal arrays this artifact replaced.
 *
 *   `card`             - `CardDefinition.resolve`/`resolveSteps` with no
 *                        `effects[]` (issue #1431, was `AI_EFFECTS_ALLOWLIST`).
 *   `effect-shorthand` - the declarative card-level `effect` shorthand with no
 *                        `effects[]` (issue #1519, was
 *                        `EFFECT_SHORTHAND_ALLOWLIST`).
 *   `ability`          - an activated/triggered ability with a bare
 *                        `resolve()`/`resolveSteps` body (issue #1519, was
 *                        `ABILITY_AI_EFFECTS_ALLOWLIST`).
 *   `delayed-trigger`  - a `delayedTriggers[]` template body (issue #1436, was
 *                        `DELAYED_TRIGGER_AI_EFFECTS_ALLOWLIST`).
 */
export type AiEffectsOffenderClass =
    | "card"
    | "effect-shorthand"
    | "ability"
    | "delayed-trigger";

/** One committed baseline row. */
export interface AiEffectsBaselineRow {
    /** Which sweep excuses this row - see {@link AiEffectsOffenderClass}. */
    readonly class: AiEffectsOffenderClass;
    /** The card's registry id (`CardDefinition.id`). */
    readonly cardId: string;
    /** The card's name - the stale-name assertion catches an id that has
     *  drifted onto a different card (a rebuilt/renumbered catalogue). */
    readonly name: string;
    /** The offending `ActivatedAbility.id`/`TriggeredAbility.id`. Class
     *  `ability` only. */
    readonly abilityId?: string;
    /** The offending `DelayedTriggerDef.id`. Class `delayed-trigger` only. */
    readonly delayedTriggerId?: string;
    /** Real, OPEN tracking issue. Class `delayed-trigger` only - the shape the
     *  literal array carried, preserved rather than widened here. */
    readonly issue?: number;
    /** The `// no honest shadow script: <why>` disposition. Human prose: the
     *  prune never writes one and never rewrites one. */
    readonly note: string;
}

/** A live offender site, as the sweep finds it in the catalogue. */
export interface AiEffectsOffender {
    readonly class: AiEffectsOffenderClass;
    readonly cardId: string;
    readonly name: string;
    readonly abilityId?: string;
    readonly delayedTriggerId?: string;
}

// Predicates.
//
// The guard test and the prune script share these, so the artifact can never
// be pruned against a different definition of "offender" than the one the
// guard enforces.

/** True when `card`'s top-level spell resolution is a bare `resolve()` /
 *  `resolveSteps` closure with no real Effect Script the value model can
 *  walk (issue #1431 SCOPE - see the guard's header for the modal/`effect`
 *  shorthand exclusions). */
export function isResolveOnlySpell(card: CardDefinition): boolean {
    if (card.modes && card.modes.length > 0) return false;
    if (card.effects && card.effects.length > 0) return false;
    return (
        !!card.resolve || !!(card.resolveSteps && card.resolveSteps.length > 0)
    );
}

/** True when `card` already plugs the AI-blind gap: an `aiEffects` shadow
 *  script, or the coarser `aiValue` scalar override. */
export function hasShadowScript(card: CardDefinition): boolean {
    return (
        (!!card.aiEffects && card.aiEffects.length > 0) ||
        card.aiValue !== undefined
    );
}

/** True when `card`'s top-level spell resolution is the declarative `effect`
 *  shorthand (`EffectShorthand`, issue #1519 SCOPE) with no real Effect
 *  Script the value model can walk. A THIRD alternative to
 *  `resolve`/`resolveSteps`/`effects` (compiled into a resolve closure at
 *  lookup time) - exactly as AI-blind as {@link isResolveOnlySpell}, since
 *  `dslSpellScriptValue`'s `effectiveScript` (`gre/ai/cardScriptValue.ts`)
 *  never reads the shorthand. */
export function isEffectShorthandSpell(card: CardDefinition): boolean {
    if (card.modes && card.modes.length > 0) return false;
    if (card.effects && card.effects.length > 0) return false;
    return !!card.effect;
}

/** All of `card`'s activated + triggered abilities, PLUS its scheduled
 *  `delayedTriggers[]` template bodies - three ability-level effect sites
 *  walked by the ability-level guard (issue #1519 SCOPE; `delayedTriggers[]`
 *  folded in by PR #2010's review, MINOR 7 - it was previously invisible to
 *  this guard entirely, so a bare `resolve()` delayed-trigger body could ship
 *  with no `aiEffects` and no error). `DelayedTriggerDef` carries `id` /
 *  `resolve` / `effects` - the same shape this guard already reads on
 *  `ActivatedAbility`/`TriggeredAbility` - just no `resolveSteps`
 *  (template-path delayed triggers don't have a stepped-resolution variant),
 *  which {@link isResolveOnlyAbility} already treats as optional. */
export function abilitiesOf(
    card: CardDefinition
): (ActivatedAbility | TriggeredAbility | DelayedTriggerDef)[] {
    return [
        ...(card.activatedAbilities ?? []),
        ...(card.triggeredAbilities ?? []),
        ...(card.delayedTriggers ?? []),
    ];
}

/** Just the activated + triggered abilities - the ORIGINAL `abilitiesOf`
 *  scope (issue #1519), before `delayedTriggers[]` was folded in (PR #2010's
 *  review, MINOR 7). The `ability` class scopes to this so it isn't polluted
 *  by the (separately audited) `delayed-trigger` residue. */
export function abilityOnlyOf(
    card: CardDefinition
): (ActivatedAbility | TriggeredAbility)[] {
    return [
        ...(card.activatedAbilities ?? []),
        ...(card.triggeredAbilities ?? []),
    ];
}

/** Just `card.delayedTriggers[]` - the dedicated scope the `delayed-trigger`
 *  class audits (issue #1436). */
export function delayedTriggersOf(card: CardDefinition): DelayedTriggerDef[] {
    return card.delayedTriggers ?? [];
}

/** True when `ability`'s own effect is a bare `resolve()`/`resolveSteps`
 *  closure with no real Effect Script the value model can walk - the
 *  ability-level mirror of {@link isResolveOnlySpell} (issue #1519 SCOPE). */
export function isResolveOnlyAbility(
    ability: ActivatedAbility | TriggeredAbility | DelayedTriggerDef
): boolean {
    if (ability.effects && ability.effects.length > 0) return false;
    const resolveSteps =
        "resolveSteps" in ability ? ability.resolveSteps : undefined;
    return !!ability.resolve || !!(resolveSteps && resolveSteps.length > 0);
}

/** True when `ability` already plugs the AI-blind gap on its OWN - an
 *  `aiEffects` shadow script. There is no ability-level `aiValue` scalar;
 *  the owning CARD's `aiValue` (checked separately by the caller) already
 *  overrides the whole card's computed worth, ability scripts included
 *  (`gre/cardValue.ts` `latentValue`), so it plugs every ability gap on that
 *  card too without needing its own per-ability field. */
export function abilityHasShadowScript(
    ability: ActivatedAbility | TriggeredAbility | DelayedTriggerDef
): boolean {
    // `DelayedTriggerDef` carries no `aiEffects` at all (the field was deleted
    // as dead data, issue #2020), so this narrowing is also the whole reason a
    // delayed trigger can never be excused by a shadow script: `tsc` refuses to
    // write one, and this returns false for every one of them without a
    // special case.
    return (
        "aiEffects" in ability &&
        !!ability.aiEffects &&
        ability.aiEffects.length > 0
    );
}

// The live sweep.

/**
 * Every AI-blind site in `cards`, across all four classes - the live set the
 * baseline is compared against.
 *
 * The `delayed-trigger` class is deliberately NOT filtered by
 * {@link abilityHasShadowScript}, unlike `ability`: an `aiEffects` script on a
 * `delayedTriggers[]` template is read by no valuer, so letting it clear a site
 * would make a placebo fix look like a fix (the exact trap issue #2020 walked
 * into). Since `DelayedTriggerDef` has no `aiEffects` field to begin with, the
 * two readings coincide today - stating it keeps them coinciding on purpose
 * rather than by accident.
 */
export function enumerateAiEffectsOffenders(
    cards: readonly CardDefinition[]
): AiEffectsOffender[] {
    const offenders: AiEffectsOffender[] = [];
    for (const card of cards) {
        if (isResolveOnlySpell(card) && !hasShadowScript(card)) {
            offenders.push({
                class: "card",
                cardId: card.id,
                name: card.name,
            });
        }
        if (isEffectShorthandSpell(card) && !hasShadowScript(card)) {
            offenders.push({
                class: "effect-shorthand",
                cardId: card.id,
                name: card.name,
            });
        }
        // A card-level `aiValue` overrides the whole card's computed worth,
        // ability scripts included, so it plugs every ability-level gap on the
        // card and the sweep skips it outright.
        if (card.aiValue !== undefined) continue;
        for (const ability of abilityOnlyOf(card)) {
            if (!isResolveOnlyAbility(ability)) continue;
            if (abilityHasShadowScript(ability)) continue;
            offenders.push({
                class: "ability",
                cardId: card.id,
                name: card.name,
                abilityId: ability.id,
            });
        }
        for (const trigger of delayedTriggersOf(card)) {
            if (!isResolveOnlyAbility(trigger)) continue;
            offenders.push({
                class: "delayed-trigger",
                cardId: card.id,
                name: card.name,
                delayedTriggerId: trigger.id,
            });
        }
    }
    return offenders;
}

// Keys, ordering, serialization.

/** The identity of a site: class + card + the per-class site id. Stable, and
 *  the only thing compared between the live sweep and the baseline. */
export function offenderKey(
    row: AiEffectsBaselineRow | AiEffectsOffender
): string {
    const site = row.abilityId ?? row.delayedTriggerId ?? "";
    return `${row.class} ${row.cardId} ${site}`;
}

/** A human-readable rendering of a site, for guard and CLI messages. */
export function describeOffender(
    row: AiEffectsBaselineRow | AiEffectsOffender
): string {
    const site = row.abilityId
        ? ` ability:${row.abilityId}`
        : row.delayedTriggerId
          ? ` delayedTrigger:${row.delayedTriggerId}`
          : "";
    return `[${row.class}] ${row.cardId} (${row.name})${site}`;
}

const CLASS_ORDER: readonly AiEffectsOffenderClass[] = [
    "card",
    "effect-shorthand",
    "ability",
    "delayed-trigger",
];

/**
 * Canonical committed order: class (in sweep order), then card NAME, then the
 * site id, then the card id. Sorting by name is what makes a migration read as
 * the list of cards it graduated, and what keeps two unrelated PRs on disjoint
 * line ranges (`data/card-index.json` precedent).
 */
export function sortBaseline(
    rows: readonly AiEffectsBaselineRow[]
): AiEffectsBaselineRow[] {
    return [...rows].sort((a, b) => {
        const byClass =
            CLASS_ORDER.indexOf(a.class) - CLASS_ORDER.indexOf(b.class);
        if (byClass !== 0) return byClass;
        if (a.name !== b.name) return a.name < b.name ? -1 : 1;
        const siteA = a.abilityId ?? a.delayedTriggerId ?? "";
        const siteB = b.abilityId ?? b.delayedTriggerId ?? "";
        if (siteA !== siteB) return siteA < siteB ? -1 : 1;
        if (a.cardId !== b.cardId) return a.cardId < b.cardId ? -1 : 1;
        return 0;
    });
}

/** The committed bytes for `rows`: sorted, 4-space, one field per line, with a
 *  trailing newline - the form prettier already produces for this shape, so
 *  the artifact stays inside `check:all`'s formatting verification instead of
 *  needing a `.prettierignore` entry. */
export function serializeBaseline(
    rows: readonly AiEffectsBaselineRow[]
): string {
    return `${JSON.stringify(sortBaseline(rows), null, 4)}\n`;
}

// Prune.

/** A baseline row whose card exists but now answers to a different name - the
 *  rebuilt/renumbered-catalogue signal. Never auto-repaired. */
export interface AiEffectsNameDrift {
    readonly row: AiEffectsBaselineRow;
    readonly liveName: string;
}

export interface AiEffectsPruneResult {
    /** Live offender sites with no baseline row. A hard refusal: a NEW site
     *  ships `aiEffects`/`aiValue`, it never buys a baseline slot. */
    readonly grown: AiEffectsOffender[];
    /** Baseline rows whose site no longer offends - what the prune removes. */
    readonly graduated: AiEffectsBaselineRow[];
    /** Rows whose card id now carries a different name. Refused, not repaired. */
    readonly drifted: AiEffectsNameDrift[];
    /** The baseline after pruning, canonically ordered. Only meaningful when
     *  `grown` and `drifted` are both empty. */
    readonly pruned: AiEffectsBaselineRow[];
}

/**
 * Compare the committed baseline against the live sweep.
 *
 * PRUNE-ONLY: `pruned` is always a SUBSET of `baseline` with every field of
 * every surviving row untouched. Growth and name drift are reported for the
 * caller to refuse on; neither is ever absorbed into `pruned`.
 */
export function pruneBaseline(
    baseline: readonly AiEffectsBaselineRow[],
    cards: readonly CardDefinition[]
): AiEffectsPruneResult {
    const offenders = enumerateAiEffectsOffenders(cards);
    const liveByKey = new Map(offenders.map((o) => [offenderKey(o), o]));
    const baselineKeys = new Set(baseline.map(offenderKey));

    const grown = offenders.filter((o) => !baselineKeys.has(offenderKey(o)));
    const graduated: AiEffectsBaselineRow[] = [];
    const pruned: AiEffectsBaselineRow[] = [];
    const drifted: AiEffectsNameDrift[] = [];

    for (const row of baseline) {
        const live = liveByKey.get(offenderKey(row));
        if (!live) {
            graduated.push(row);
            continue;
        }
        if (live.name !== row.name) drifted.push({ row, liveName: live.name });
        pruned.push(row);
    }

    return { grown, graduated, drifted, pruned: sortBaseline(pruned) };
}
