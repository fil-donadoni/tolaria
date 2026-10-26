/**
 * The `## Target files` of a Grammar Gap issue — the grammar module its rule
 * lands in, derived from the gap's key (issue #6921).
 *
 * `gaps:sync` files one issue per gap KEY, so two keys one Grammar Rule closes
 * ("You draw a card and lose N life", "You draw X cards and lose X life") are
 * two issues. Without a shared declared file the planner runs them at once,
 * the first landing makes the second redundant, and the second PR dies
 * rebasing onto the rule file. Declaring that file lets `queue:plan`'s
 * in-flight overlap and reservation serialise them; once the first lands, the
 * next `gaps:sync` retires the second if its gap is gone.
 *
 * A key is `slot › path… › shape` (`gapOf`): the INNERMOST name — the last
 * sub-grammar on the path, else the slot — is the one the compiler blamed, so
 * its module is where the missing rule goes. `GRAMMAR_BLAME_FILES` is the one
 * table from that name to the file; `grammar-gap-target-files.test.ts` reds on
 * a row whose file no longer declares the name, and on a name the compiled
 * lockfile blames that has no row.
 */

import { CARD_LEVEL, NO_SLOT, OP_LEVEL } from "./grammar-gaps";

const GRAMMAR = "convex/oracle/grammar";

/**
 * Every name a refusal's attribution can carry — a slot (`attribution.slot`)
 * or a sub-grammar (`attribution.path[n]`) — and the module whose rules read
 * it. `(no slot)` is a line the router could not route: a new slot or a
 * routing rule, both the router's.
 */
export const GRAMMAR_BLAME_FILES: Readonly<Record<string, string>> = {
    // Slots.
    static: `${GRAMMAR}/slots/staticSlot.ts`,
    triggered: `${GRAMMAR}/slots/triggered.ts`,
    spell: `${GRAMMAR}/slots/spell.ts`,
    activated: `${GRAMMAR}/slots/activated.ts`,
    "keyword-line": `${GRAMMAR}/slots/keywordLine.ts`,
    "mana-ability": `${GRAMMAR}/slots/manaAbility.ts`,
    "alternative-cost": `${GRAMMAR}/slots/alternativeCost.ts`,
    [NO_SLOT]: `${GRAMMAR}/router.ts`,
    // Sub-grammars.
    "effect clause": `${GRAMMAR}/shared/effectClause.ts`,
    "sentence assembly": `${GRAMMAR}/shared/effectClause.ts`,
    "static clause": `${GRAMMAR}/shared/staticClause.ts`,
    "trigger head": `${GRAMMAR}/shared/triggerHead.ts`,
    "activation cost": `${GRAMMAR}/shared/cost.ts`,
    "object descriptor": `${GRAMMAR}/shared/targetFilter.ts`,
    "target filter": `${GRAMMAR}/shared/targetFilter.ts`,
    "keyword ability": `${GRAMMAR}/slots/keywordLine.ts`,
    condition: `${GRAMMAR}/shared/condition.ts`,
    duration: `${GRAMMAR}/shared/duration.ts`,
    "verb frame": `${GRAMMAR}/shared/verbFrames.ts`,
    "zone reference": `${GRAMMAR}/shared/zoneRef.ts`,
    "mana production": `${GRAMMAR}/slots/manaAbility.ts`,
    "mana ability rider": `${GRAMMAR}/slots/manaAbility.ts`,
    "mass subject": `${GRAMMAR}/shared/massSubject.ts`,
    "from among": `${GRAMMAR}/shared/fromAmong.ts`,
    quantity: `${GRAMMAR}/shared/quantity.ts`,
    "counted set": `${GRAMMAR}/shared/quantity.ts`,
    "number of set": `${GRAMMAR}/shared/quantity.ts`,
    "player reference": `${GRAMMAR}/shared/playerRef.ts`,
};

/** The separator `gapOf` joins a key's parts with. */
const KEY_SEPARATOR = " › ";

/**
 * The name a gap key blames: the last sub-grammar on its path, else its slot.
 * `null` for a card-level refusal (a layout, a type line — no grammar module
 * owns it) and an Op-census gap (named by its Op, never by a slot).
 */
export function blamedName(key: string): string | null {
    const parts = key.split(KEY_SEPARATOR);
    const slot = parts[0]!;
    if (slot === CARD_LEVEL || slot === OP_LEVEL) return null;
    // `slot › path… › shape`: the shape is the last part, never a name.
    const path = parts.slice(1, -1);
    return path.length > 0 ? path[path.length - 1]! : slot;
}

/**
 * The files a Grammar Gap issue declares, or `null` when the key blames no
 * grammar module — an unknown name included, so a gap the table has not
 * caught up with stays "unknown" (scheduled solo) rather than guessed.
 */
export function grammarGapTargetFiles(key: string): string[] | null {
    const name = blamedName(key);
    if (name === null) return null;
    const file = GRAMMAR_BLAME_FILES[name];
    return file === undefined ? null : [file];
}

/**
 * The `## Target files` section a body ends on — opening blank line included —
 * or no lines when the key blames nothing.
 */
export function renderGrammarGapTargetFiles(key: string): string[] {
    const files = grammarGapTargetFiles(key);
    if (files === null) return [];
    return ["", "## Target files", "", ...files.map((f) => `- \`${f}\``)];
}
