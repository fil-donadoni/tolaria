// Oracle text aggregator for the deck-builder card index. CardDefinition does
// not store a single oracle blob — rules text lives on individual abilities
// (`activatedAbilities[].oracleText`, `triggeredAbilities[].oracleText`,
// `delayedTriggers[].oracleText`) and as keyword strings on `staticAbilities`.
// This helper walks every text-bearing field and produces a single searchable
// string for fuzzy matching plus a human-readable display string.

import { LAND_SUBTYPE_MANA } from "../gre/constants";
import type { CardDefinition } from "./types";

export interface AggregatedOracleText {
    /** Lowercased blob used for substring/token search. */
    searchable: string;
    /** Human-readable, case-preserving rendering. Newline-separated clauses. */
    display: string;
}

/** Builds a searchable + human-readable oracle text blob from a card
 *  definition. Concatenates: keyword `staticAbilities`, every ability's
 *  `oracleText`, intrinsic basic-land mana ("{T}: Add {W}." etc.), and any
 *  delayed-trigger oracle text. The aggregation is a strict subset of the
 *  text the engine already exposes — no manual annotations are added. */
export function aggregateOracleText(def: CardDefinition): AggregatedOracleText {
    const lines: string[] = [];

    if (def.staticAbilities && def.staticAbilities.length > 0) {
        for (const kw of def.staticAbilities) {
            lines.push(kw);
        }
    }

    if (def.activatedAbilities) {
        for (const ability of def.activatedAbilities) {
            if (ability.oracleText) lines.push(ability.oracleText);
        }
    }

    if (def.triggeredAbilities) {
        for (const ability of def.triggeredAbilities) {
            if (ability.oracleText) lines.push(ability.oracleText);
        }
    }

    if (def.delayedTriggers) {
        for (const trig of def.delayedTriggers) {
            if (trig.oracleText) lines.push(trig.oracleText);
        }
    }

    // Intrinsic basic-land mana ability (CR 305.6) is implicit on the
    // definition — no `activatedAbilities` entry — so add a synthetic line
    // when the card carries a basic land subtype.
    if (def.types.includes("Land") && def.subtypes) {
        for (const subtype of def.subtypes) {
            const color = LAND_SUBTYPE_MANA[subtype];
            if (color && def.subtypes.length === 1) {
                lines.push(`{T}: Add {${color}}.`);
            }
        }
    }

    const display = lines.join("\n");
    return {
        searchable: display.toLowerCase(),
        display,
    };
}
