/**
 * What the Bot-play sweep puts in the HOLDER's graveyard for a card whose
 * script offers a may-pay GRAVEYARD leg (CR 118.3 / 118.12a) — "sacrifice it
 * unless you return a basic land card from your graveyard to your hand"
 * (Harvest Wurm).
 *
 * The position's filler graveyard holds no card that pays such a leg, so the
 * punisher always fires: casting the card loses it for nothing and passing is
 * right — the card read `never-chosen`, a limit of the harness, not a fact
 * about the Bot. The graveyard learns the shape instead: enough cards matching
 * the leg's filter, chosen by the engine's own leg matcher
 * (`mayPayGraveyardCandidates`), so paying is a play the caster can want.
 *
 * Lives beside `botReach.ts` for the same reason as its siblings: it decides
 * what the position CONTAINS, so it is a verdict input and sits inside the Bot
 * hash (`scripts/lib/oracle-bot-reach.ts`).
 */

import type { CardDefinition, CostLegs } from "../../cards/types";
import type { ScenarioCard } from "../../debugScenarioSpec";
import { tryGetCardByName } from "../../cards";
import { mayPayGraveyardCandidates } from "../state";

/** Graveyard bodies tried in order, the first matching the leg's filter is
 *  posed: a basic land, a creature, an artifact creature, an enchantment. */
const GRAVEYARD_BODIES = ["Forest", "Grizzly Bears", "Ornithopter", "Castle"];

/** Every may-pay graveyard leg in the card's scripts, at any depth. */
function graveyardLegs(
    node: unknown,
    out: NonNullable<CostLegs["graveyard"]>[] = []
): NonNullable<CostLegs["graveyard"]>[] {
    if (Array.isArray(node)) {
        for (const child of node) graveyardLegs(child, out);
        return out;
    }
    if (node === null || typeof node !== "object") return out;
    const rec = node as Record<string, unknown>;
    if (rec.op === "mayPay") {
        const cost = rec.cost as CostLegs | undefined;
        if (cost && typeof cost === "object" && cost.graveyard)
            out.push(cost.graveyard);
    }
    for (const child of Object.values(rec)) graveyardLegs(child, out);
    return out;
}

/** The graveyard cards the position hands a card whose script offers a
 *  may-pay graveyard leg, or none. */
export function mayPayGraveyardPose(def: CardDefinition): ScenarioCard[] {
    // The whole definition is walked: a compiled card carries its triggers
    // as `compiledTriggeredAbilities`, a hand-written one as
    // `triggeredAbilities`, and the leg is the same either way.
    const legs = graveyardLegs(def);
    return legs.flatMap((leg) => {
        const name = GRAVEYARD_BODIES.find((body) => {
            const card = tryGetCardByName(body);
            return (
                card !== null &&
                mayPayGraveyardCandidates(
                    [{ id: body, card: { id: card.id } }],
                    leg
                ).length > 0
            );
        });
        return name === undefined
            ? []
            : [
                  {
                      name,
                      owner: "me" as const,
                      zone: "graveyard" as const,
                      count: leg.count,
                  },
              ];
    });
}
