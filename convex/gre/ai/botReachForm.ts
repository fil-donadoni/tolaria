/**
 * The FORM a Bot-play verdict is aggregated by (ADR 0105 § 7.2, issue #3830) —
 * pure over a `CardDefinition`, and deliberately its own module.
 *
 * Two reasons it is not in `botReach.ts`:
 *
 *  - the lockfile driver (`scripts/lib/oracle-bot-reach.ts`, reached from the
 *    drift guard) needs it, and must not pull the search into the gate's
 *    module graph;
 *  - everything here decides the Bot GAP KEY, never a verdict, and the key is
 *    recomputed
 *    from the definition on every `oracle:compile`. So editing it must NOT
 *    invalidate the sweep's cache — which is why `botSourceFiles` excludes
 *    this one file by name.
 */

import type { CardDefinition, TargetRequirement } from "../../cards/types";

/** Every target TYPE a definition announces, at the card and mode levels. */
function targetTypes(def: CardDefinition): string[] {
    const reqs: TargetRequirement[] = [];
    if (def.targetRequirement) reqs.push(def.targetRequirement);
    for (const mode of def.modes ?? []) {
        if (mode.targetRequirement) reqs.push(mode.targetRequirement);
    }
    return reqs.flatMap((r) => (Array.isArray(r.type) ? r.type : [r.type]));
}

/**
 * The card's cast shape: its primary card type, the target types it announces,
 * whether its cost carries a variable X, and its printed keywords.
 *
 * The keywords are what keep the ranking honest. Without them the biggest row
 * of the first full pass was `never-chosen › Creature › (no Ops)`, 67 cards —
 * and most of them have FLASH (Plumeveil, Vexing Gull, Winged Coatl), where
 * not casting at sorcery speed in one's own main phase is CORRECT play, not a
 * valuation gap. A gap table that ranks correct play alongside a real gap is
 * a table nobody can act on.
 */
export function castShape(def: CardDefinition): string {
    const primary = def.types[0] ?? "Card";
    const targets = [...new Set(targetTypes(def))].sort();
    const parts: string[] = [primary];
    if (targets.length > 0) parts.push(`target:${targets.join("|")}`);
    // CR 107.3 — a VARIABLE X is the string marker; a number is generic.
    if (def.manaCost?.X === "X") parts.push("X");
    const keywords = [...new Set(def.staticAbilities ?? [])].sort();
    if (keywords.length > 0) parts.push(`[${keywords.join(",")}]`);
    return parts.join(" ");
}
