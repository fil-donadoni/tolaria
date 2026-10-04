/**
 * What the Bot-play sweep puts on the OPPONENT's battlefield for a spell that
 * clears or equalizes creatures for every player (CR 701.8a, CR 701.21a,
 * issue #4831).
 *
 * "Destroy all creatures" and "each player sacrifices creatures down to the
 * fewest" cost the caster as much as the opponent when both boards match, so
 * on the position's symmetric boards (one creature a side) the spell changes
 * nothing relative and passing is right. The position used to hold matching
 * boards, so these spells read `never-chosen` — a limit of the harness, not a
 * fact about the Bot. The opposing board learns the shape instead: extra
 * creatures (and, for an equalizer, extra lands, which the caster would
 * otherwise sacrifice down to an empty opposing land count), so the spell is a
 * trade the caster can want.
 *
 * Lives beside `botReach.ts` for the same reason as its siblings: it decides
 * what the position CONTAINS, so it is a verdict input and sits inside the Bot
 * hash (`scripts/lib/oracle-bot-reach.ts`).
 */

import type { CardDefinition } from "../../cards/types";
import type { ScenarioCard } from "../../debugScenarioSpec";

/** Opposing creatures posed beyond the caster's own. */
const EXTRA_CREATURES = 3;

/** Opposing lands posed, more than the caster controls in any pose. */
const OPPOSING_LANDS = 8;

const DESTROYS_ALL_CREATURES = /\bdestroy all creatures\b/i;
const EQUALIZES_TO_FEWEST = /\bthe fewest\b/i;

/** The opposing permanents the position hands a creature sweep or an
 *  equalizer, or none. */
export function creatureSweepPose(def: CardDefinition): ScenarioCard[] {
    if (!def.types.some((t) => t === "Instant" || t === "Sorcery")) return [];
    const text = def.oracleText ?? "";
    const equalizes = EQUALIZES_TO_FEWEST.test(text);
    if (!equalizes && !DESTROYS_ALL_CREATURES.test(text)) return [];
    const pose: ScenarioCard[] = [
        {
            name: "Grizzly Bears",
            owner: "opp",
            zone: "battlefield",
            count: EXTRA_CREATURES,
        },
    ];
    if (equalizes)
        pose.push({
            name: "Plains",
            owner: "opp",
            zone: "battlefield",
            count: OPPOSING_LANDS,
        });
    return pose;
}
