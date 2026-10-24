/**
 * What the Bot-play sweep puts in the OPPONENT's graveyard for a spell that
 * exiles a player's graveyard (CR 404.1, CR 406.1, issue #4829).
 *
 * The position's graveyards hold a filler creature that nothing can cast from
 * there, and the evaluator prices a graveyard card at zero unless its owner can
 * reach it (`graveyardReach`, issue #3042). Exiling it was worth nothing, so
 * the spell read `never-chosen` — a limit of the harness, not a fact about the
 * Bot. The graveyard learns the shape instead: cards the opponent can use from
 * there, so the exile takes something away and casting is an outcome the
 * caster can want.
 *
 * HOW MANY, and WHICH (issue #5071). The credit is capped (`graveyardReachCap`,
 * 2 cards at `graveyardReachFraction` of their latent worth), so exiling a
 * graveyard is worth at most a small slice of a card in hand: at 1-ply a lone
 * flashback spell left the cast ~58 below `pass` (hand 66 vs 8 against an
 * 8.27 reach gain) and the three-way near-tie in mean reward fell to the
 * material tie-break — `played` on 10/40 (seed, seat) pairs over seeds 1–20,
 * and `ignored` at the default budget. Two copies of a self-recursion creature
 * (a body, so a larger latent worth than a spell) fill the cap: `played` on
 * 40/40 and at the default budget. The pose was the noise, not the valuation —
 * the cap is deliberate (`graveyardReachTerm`: a trade must not become a
 * wash).
 *
 * Lives beside `botReach.ts` for the same reason as its siblings: it decides
 * what the position CONTAINS, so it is a verdict input and sits inside the Bot
 * hash (`scripts/lib/oracle-bot-reach.ts`).
 */

import type { CardDefinition } from "../../cards/types";
import type { ScenarioCard } from "../../debugScenarioSpec";

/** A creature the opponent can return from its graveyard on its own
 *  (`activateFromGraveyard`); it prices at a creature's latent worth. */
const RECURSIVE_CARD = "Ashen Ghoul";

/** `graveyardReachCap` cards: the most the term credits a graveyard. */
const POSED_COPIES = 2;

/** A `moveZone` to exile that reads from a graveyard, at any depth of the
 *  script. */
function exilesGraveyard(node: unknown): boolean {
    if (Array.isArray(node)) return node.some(exilesGraveyard);
    if (node === null || typeof node !== "object") return false;
    const rec = node as Record<string, unknown>;
    if (rec.op === "moveZone" && rec.to === "exile") {
        const from = rec.fromZones;
        if (Array.isArray(from) && from.includes("graveyard")) return true;
    }
    return Object.values(rec).some(exilesGraveyard);
}

/** The opposing graveyard cards the position hands a spell that exiles a
 *  graveyard, or none. */
export function graveyardExilePose(def: CardDefinition): ScenarioCard[] {
    if (!def.types.some((t) => t === "Instant" || t === "Sorcery")) return [];
    if (!def.targetRequirement || Array.isArray(def.targetRequirement))
        return [];
    if (def.targetRequirement.type !== "player") return [];
    if (!exilesGraveyard(def.effects ?? [])) return [];
    return Array.from({ length: POSED_COPIES }, () => ({
        name: RECURSIVE_CARD,
        owner: "opp" as const,
        zone: "graveyard" as const,
    }));
}
