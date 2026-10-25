/**
 * What the Bot-play sweep gives a spell whose number of targets is read off
 * the opponent's board when it is cast (CR 601.2c, CR 107.3): "return up to X
 * target cards from your graveyard to your hand, where X is the number of
 * black permanents target opponent controls".
 *
 * The position's opponent controls no permanent of the counted colour, so
 * X = 0 and the cast returns nothing: passing is right and the spell read
 * `never-chosen` — a limit of the harness, not a fact about the Bot. The
 * position learns the shape instead: permanents of the counted colour on the
 * opponent's side and as many cards in the holder's graveyard, so the bound is
 * positive and casting brings something back.
 *
 * Lives beside `botReach.ts` for the same reason as its siblings: it decides
 * what the position CONTAINS, so it is a verdict input and sits inside the Bot
 * hash (`scripts/lib/oracle-bot-reach.ts`).
 */

import type { CardDefinition } from "../../cards/types";
import type { ScenarioCard } from "../../debugScenarioSpec";

/** Permanents of the counted colour the opponent controls = the bound X. */
const COUNTED_PERMANENTS = 2;

/** Cards the holder's graveyard holds beyond the filler: more than X, so the
 *  bound is the limit and not the graveyard. */
const GRAVEYARD_CARDS = 3;

/** A creature of each colour for the opponent's side. */
const PERMANENT_BY_COLOR: Readonly<Record<string, string>> = {
    W: "White Knight",
    U: "Merfolk of the Pearl Trident",
    B: "Black Knight",
    R: "Mons's Goblin Raiders",
    G: "Grizzly Bears",
};

/** The colour of the battlefield permanents a graveyard-target count is
 *  bound to (`count.max = { count: { zone: "battlefield", filter: { color } } }`),
 *  at any depth of the requirement. */
function countedColor(node: unknown): string | undefined {
    if (Array.isArray(node)) {
        for (const child of node) {
            const found = countedColor(child);
            if (found) return found;
        }
        return undefined;
    }
    if (node === null || typeof node !== "object") return undefined;
    const rec = node as Record<string, unknown>;
    const counted = rec.count as
        | { zone?: unknown; filter?: { color?: unknown } }
        | undefined;
    if (
        counted &&
        typeof counted === "object" &&
        counted.zone === "battlefield" &&
        typeof counted.filter?.color === "string" &&
        counted.filter.color in PERMANENT_BY_COLOR
    )
        return counted.filter.color;
    for (const child of Object.values(rec)) {
        const found = countedColor(child);
        if (found) return found;
    }
    return undefined;
}

/** The cards the position hands a spell that returns up to X cards from the
 *  holder's graveyard, X counted on the opponent's battlefield, or none. */
export function countedReturnPose(def: CardDefinition): ScenarioCard[] {
    if (!def.types.some((t) => t === "Instant" || t === "Sorcery")) return [];
    const extra = def.additionalTargetRequirements;
    if (!extra) return [];
    const isGraveyardGroup = (r: unknown): boolean =>
        (r as { zone?: unknown }).zone === "graveyard";
    const groups = Array.isArray(extra) ? extra : [extra];
    const color = countedColor(groups.filter(isGraveyardGroup));
    if (!color) return [];
    return [
        {
            name: PERMANENT_BY_COLOR[color]!,
            owner: "opp",
            zone: "battlefield",
            count: COUNTED_PERMANENTS,
        },
        {
            name: "Grizzly Bears",
            owner: "me",
            zone: "graveyard",
            count: GRAVEYARD_CARDS,
        },
    ];
}
