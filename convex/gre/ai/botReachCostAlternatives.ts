/**
 * What the Bot-play sweep puts in the HOLDER's graveyard and on its
 * battlefield for a spell whose whole cost is paid by delve and convoke
 * (CR 702.66, CR 702.51, CR 601.2f, issue #4845).
 *
 * "You can't spend mana to cast this spell. Convoke, delve" has no mana
 * payment at all, so the position's lands count for nothing and its filler
 * graveyard (one creature) and empty board pay for nothing either: the engine
 * refuses a human the cast, and the card read `position-unmodelled` — a limit
 * of the harness, not a fact about the Bot. The position learns the shape
 * instead: delve fodder for the generic part and untapped creatures of the
 * pips' colour for the rest, so the cast is one the caster can afford.
 *
 * Lives beside `botReach.ts` for the same reason as its siblings: it decides
 * what the position CONTAINS, so it is a verdict input and sits inside the Bot
 * hash (`scripts/lib/oracle-bot-reach.ts`).
 */

import type { CardDefinition } from "../../cards/types";
import type { ScenarioCard } from "../../debugScenarioSpec";

/** The graveyard card each delved generic pip exiles. */
const DELVE_FODDER = "Grizzly Bears";

/** A green creature: pays a generic pip or a {G} / {B/G} pip when convoked. */
const CONVOKE_CREATURE = "Grizzly Bears";

/** The cards the position hands a spell paid only by delve and convoke, or
 *  none. */
export function costAlternativesPose(def: CardDefinition): ScenarioCard[] {
    if (!def.cantSpendManaToCast) return [];
    const abilities = def.staticAbilities ?? [];
    const delves = abilities.includes("delve");
    const convokes = abilities.includes("convoke");
    if (!delves || !convokes) return [];
    const hybrid = def.manaCost.hybrid ?? [];
    // Only the green-capable pips are modelled: a pip of another colour would
    // need a creature of that colour, and no card shape asks for one yet.
    if (!hybrid.every((pip) => pip.includes("G"))) return [];
    const generic = def.manaCost.X ?? 0;
    const cards: ScenarioCard[] = [];
    if (generic > 0)
        cards.push({
            name: DELVE_FODDER,
            owner: "me",
            zone: "graveyard",
            count: generic,
        });
    if (hybrid.length > 0)
        cards.push({
            name: CONVOKE_CREATURE,
            owner: "me",
            zone: "battlefield",
            count: hybrid.length,
        });
    return cards;
}
