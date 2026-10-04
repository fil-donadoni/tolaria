/**
 * What the Bot-play sweep puts on the OPPONENT's battlefield for a spell that
 * taps every land a target player controls (CR 701.26a, issue #4827).
 *
 * "Tap all lands target player controls" does nothing against a player with no
 * lands, so on the empty opposing board the card pays mana to change nothing
 * and passing is right. The position used to hold no opposing land, so the
 * card read `never-chosen` — a limit of the harness, not a fact about the Bot.
 * The board learns the shape instead: untapped lands on the opponent's side,
 * so tapping them is an outcome the caster can want.
 *
 * Lives beside `botReach.ts` for the same reason as its siblings: it decides
 * what the position CONTAINS, so it is a verdict input and sits inside the Bot
 * hash (`scripts/lib/oracle-bot-reach.ts`).
 */

import type { CardDefinition } from "../../cards/types";
import type { ScenarioCard } from "../../debugScenarioSpec";

/** The opposing lands posed, a full mana base for a mid-game opponent. */
const OPPOSING_LANDS = 4;

/** An imperative `resolve()` carries no script to walk, so the class is read
 *  off the Oracle clause it implements. */
const TAPS_PLAYERS_LANDS = /\btap all lands target player controls\b/i;

/** The opposing lands the position hands a spell that taps a target player's
 *  lands, or none. */
export function landTapPose(def: CardDefinition): ScenarioCard[] {
    if (!def.types.some((t) => t === "Instant" || t === "Sorcery")) return [];
    if (!TAPS_PLAYERS_LANDS.test(def.oracleText ?? "")) return [];
    return [
        {
            name: "Island",
            owner: "opp",
            zone: "battlefield",
            count: OPPOSING_LANDS,
        },
    ];
}
