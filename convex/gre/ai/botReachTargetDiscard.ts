/**
 * What the Bot-play sweep seeds the opponent's library with for a spell that
 * makes a target player discard a card the CASTER picks through a filter
 * (CR 701.9a, CR 701.20a — Duress: "You choose a noncreature, nonland card
 * from it. That player discards that card.", issue #8977).
 *
 * `discardsFromTarget` (`botReach.ts`) gives the opponent a hidden hand the
 * search re-deals from spells on top of their library. Those spells were all
 * creatures (Serra Angel) and the rest of the pile basic lands, so a pick
 * filtered to "noncreature, nonland" found nothing in any determinization: the
 * spell took no card, and passing over it was right. The card read
 * `never-chosen` — a limit of the harness, not a fact about the Bot. The pile
 * learns the shape instead: the first candidate every hand-pick filter of the
 * script admits.
 *
 * Lives beside `botReach.ts` for the same reason as its siblings: it decides
 * what the position CONTAINS, so it is a verdict input and sits inside the Bot
 * hash (`scripts/lib/oracle-bot-reach.ts`).
 */

import { definitionMatchesFilter } from "../alternativeCost";
import { tryGetCardByName } from "../../cards";
import type { CardDefinition, EffectCardFilter } from "../../cards/types";
import { etbAbilityScripts } from "./botReachTarget";

/** The noncreature spell a filtered pick can take when the default pile spell
 *  is refused: cheap (mana value 2), so a mana-value ceiling ("mana value 3 or
 *  less") admits it too. */
const NONCREATURE_DISCARD_SPELL = "Counterspell";

/** True when `player` names an announced target (`{ target: N }`). */
function aimedAtTarget(player: unknown): boolean {
    return (
        player !== null &&
        typeof player === "object" &&
        typeof (player as { target?: unknown }).target === "number"
    );
}

/** The filter of every hand pick out of a TARGET player's hand, at any depth:
 *  a `choose-hand-card` whose hand belongs to the target (`zoneOwnerId`), or
 *  a `discard-hand` the target answers (`player`). A filterless pick adds
 *  nothing — every card passes it. */
function targetHandPickFilters(node: unknown, out: EffectCardFilter[]): void {
    if (Array.isArray(node)) {
        for (const child of node) targetHandPickFilters(child, out);
        return;
    }
    if (node === null || typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    const picksTargetHand =
        rec.op === "choice" &&
        ((rec.kind === "choose-hand-card" && aimedAtTarget(rec.zoneOwnerId)) ||
            (rec.kind === "discard-hand" && aimedAtTarget(rec.player)));
    if (picksTargetHand && rec.filter !== undefined)
        out.push(rec.filter as EffectCardFilter);
    for (const child of Object.values(rec)) targetHandPickFilters(child, out);
}

/** The spell the opponent's library is seeded with for a target-aimed
 *  discard: `fallback` (the sweep's default pile spell) when every hand-pick
 *  filter admits it — so no other card's position moves — else
 *  {@link NONCREATURE_DISCARD_SPELL} when they all admit it, else
 *  `fallback`. */
export function targetDiscardSpell(
    def: CardDefinition,
    fallback: string
): string {
    const filters: EffectCardFilter[] = [];
    for (const script of [def, ...etbAbilityScripts(def)]) {
        targetHandPickFilters(script.effects, filters);
        targetHandPickFilters(script.modes, filters);
    }
    const admits = (name: string): boolean => {
        const candidate = tryGetCardByName(name);
        return (
            candidate !== null &&
            candidate !== undefined &&
            filters.every((f) => definitionMatchesFilter(candidate, f))
        );
    };
    if (admits(fallback)) return fallback;
    return admits(NONCREATURE_DISCARD_SPELL)
        ? NONCREATURE_DISCARD_SPELL
        : fallback;
}
