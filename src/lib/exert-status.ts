import type { CardInstance, Combat } from "~/types/game";

/** CR 701.43a / 508.1g — how a permanent stands with respect to exert.
 *   - `pending`: chosen for the declaration being made (held on
 *     `combat.exertedIds`), still revocable until attackers are confirmed;
 *   - `paid`: the permanent's own one-shot "skips its next untap step" flag is
 *     armed (CR 302.6 / 502.1) — the cost is paid and locked in. The flag also
 *     carries non-exert causes, so this is "will not untap", not "was exerted";
 *   - `null`: neither.
 *  Reads projected state only, never the card name or art. */
export type ExertStatus = "pending" | "paid" | null;

export function exertStatus(
    card: Pick<CardInstance, "id" | "skipNextUntap"> | undefined,
    combat: Pick<Combat, "exertedIds" | "confirmed"> | undefined
): ExertStatus {
    if (!card) return null;
    if (card.skipNextUntap) return "paid";
    if (combat && !combat.confirmed && combat.exertedIds?.includes(card.id))
        return "pending";
    return null;
}
