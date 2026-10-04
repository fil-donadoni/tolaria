/**
 * What the Bot-play sweep puts on the OPPONENT's battlefield for a permanent
 * that destroys every permanent of a subtype at an end step (CR 603.6a,
 * CR 701.8, issue #4826).
 *
 * "At the beginning of the end step, destroy all Goblins" kills the caster's
 * own copy too, so on an empty opposing board the card pays mana for a
 * creature that lives one turn and passing is right. The position used to
 * hold an empty opposing board, so the card read `never-chosen` — a limit of
 * the harness, not a fact about the Bot. The board learns the shape instead:
 * two small creatures of the swept subtype on the opponent's side, so the
 * sweep is a trade the caster can want.
 *
 * Lives beside `botReach.ts` for the same reason as its siblings: it decides
 * what the position CONTAINS, so it is a verdict input and sits inside the Bot
 * hash (`scripts/lib/oracle-bot-reach.ts`).
 */

import { getAllCatalogueCards } from "../../cards/catalogue";
import type { CardDefinition } from "../../cards/types";
import type { ScenarioCard } from "../../debugScenarioSpec";
import { manaValue } from "../constants";

/** The opposing creatures posed, enough for the sweep to out-trade the card. */
const SWEPT_CREATURES = 2;

/** The subtype a `destroy` inside a `forEach` sweeps, at any depth, or null. */
function sweptSubtype(node: unknown, inForEach = false): string | null {
    if (Array.isArray(node)) {
        for (const child of node) {
            const found = sweptSubtype(child, inForEach);
            if (found) return found;
        }
        return null;
    }
    if (node === null || typeof node !== "object") return null;
    const rec = node as Record<string, unknown>;
    if (rec.op === "forEach") {
        const select = rec.select as
            | { filter?: { subtype?: unknown } }
            | undefined;
        const subtype = select?.filter?.subtype;
        const kills = JSON.stringify(rec.effects ?? []).includes(
            '"op":"destroy"'
        );
        if (kills && typeof subtype === "string") return subtype;
    }
    for (const value of Object.values(rec)) {
        const found = sweptSubtype(value, inForEach);
        if (found) return found;
    }
    return null;
}

/** The cheapest creature of `subtype` (name order breaks ties) — a stable
 *  stand-in for "an opposing creature the sweep would kill". */
function cheapestOfSubtype(subtype: string): CardDefinition | null {
    const candidates = getAllCatalogueCards()
        .filter(
            (c) =>
                c.types.includes("Creature") &&
                c.subtypes?.includes(subtype) &&
                !c.staticAbilities?.length &&
                !c.triggeredAbilities?.length &&
                !c.activatedAbilities?.length
        )
        .sort(
            (a, b) =>
                manaValue(a.manaCost) - manaValue(b.manaCost) ||
                a.name.localeCompare(b.name)
        );
    return candidates[0] ?? null;
}

/** The opposing creatures the position hands a permanent whose triggered
 *  ability destroys every permanent of a subtype, or none. */
export function subtypeSweepPose(def: CardDefinition): ScenarioCard[] {
    if (def.types.includes("Instant") || def.types.includes("Sorcery"))
        return [];
    const subtype = sweptSubtype(def.triggeredAbilities ?? []);
    if (!subtype) return [];
    const victim = cheapestOfSubtype(subtype);
    if (!victim) return [];
    return [
        {
            name: victim.name,
            owner: "opp",
            zone: "battlefield",
            count: SWEPT_CREATURES,
        },
    ];
}
