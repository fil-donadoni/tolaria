/**
 * What the Bot-play sweep puts in the holder's hand for a card that ADDS MANA
 * (CR 106.1, issue #4822).
 *
 * A ritual is worth the spell it pays for: mana added in a main phase empties
 * at the end of that phase (CR 500.5), so with nothing in hand to spend it on
 * the card is a net loss of itself and passing is right. The position used to
 * hold only an opaque card, so every instant that adds mana read
 * `never-chosen` — a limit of the harness, not a fact about the Bot. The hand
 * learns the shape instead: one spell the position's lands cannot pay for but
 * the ritual's net mana can.
 *
 * Lives beside `botReach.ts` for the same reason as its siblings: it decides
 * what the position CONTAINS, so it is a verdict input and sits inside the Bot
 * hash (`scripts/lib/oracle-bot-reach.ts`).
 */

import { tryGetCardByName } from "../../cards/catalogue";
import type { CardDefinition, Color } from "../../cards/types";
import type { ScenarioCard } from "../../debugScenarioSpec";
import { manaValue } from "../constants";

/** A coloured spell per colour, each one mana value 5 — out of reach of the
 *  three lands a one-mana ritual is posed on, in reach once the ritual nets
 *  two more. */
const MANA_SINKS: Readonly<Record<Exclude<Color, "C">, string>> = {
    W: "Serra Angel",
    U: "Air Elemental",
    B: "Sengir Vampire",
    R: "Fire Elemental",
    G: "Force of Nature",
};

/** The colours `node` adds to the controller's pool, at any depth, and the
 *  total mana it adds. */
function addedMana(node: unknown): { colors: Set<string>; total: number } {
    const found = { colors: new Set<string>(), total: 0 };
    const walk = (n: unknown): void => {
        if (Array.isArray(n)) return n.forEach(walk);
        if (n === null || typeof n !== "object") return;
        const rec = n as Record<string, unknown>;
        if (rec.op === "addMana" && typeof rec.mana === "object" && rec.mana) {
            for (const [color, count] of Object.entries(rec.mana)) {
                if (typeof count !== "number" || count <= 0) continue;
                found.colors.add(color);
                found.total += count;
            }
        }
        Object.values(rec).forEach(walk);
    };
    walk(node);
    return found;
}

/** The spell the position hands a card that adds mana, or none. Posed only for
 *  an instant or sorcery whose script nets mana (it adds more than it costs):
 *  a land or a permanent's mana ability is a different card. */
export function manaSinkPose(
    def: CardDefinition,
    landCount: number
): ScenarioCard[] {
    if (!def.types.some((t) => t === "Instant" || t === "Sorcery")) return [];
    const { colors, total } = addedMana(def.effects);
    if (total <= manaValue(def.manaCost)) return [];
    const reach = landCount - manaValue(def.manaCost) + total;
    for (const color of Object.keys(MANA_SINKS) as Exclude<Color, "C">[]) {
        if (!colors.has(color)) continue;
        const name = MANA_SINKS[color];
        const sink = tryGetCardByName(name);
        if (!sink) continue;
        const mv = manaValue(sink.manaCost);
        if (mv > landCount && mv <= reach)
            return [{ name, owner: "me", zone: "hand" }];
    }
    return [];
}
