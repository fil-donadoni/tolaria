import { tryGetDefinition } from "@convex/cards";
import type { CardInstance, Player } from "~/types/game";
import { displayCardId } from "~/lib/card-utils";

/** Attachment host lookup (CR 303.4 Auras, CR 301.5 Equipment, CR 702.151b
 *  Reconfigure) — the single place the UI resolves what a permanent's
 *  `attachedTo` handle points AT.
 *
 *  `attachedTo` is an opaque id: it names either a permanent on ANY
 *  battlefield (the host may be controlled by the other player — Control
 *  Magic, or an opponent's Aura enchanting your creature) or, for an "enchant
 *  player" Aura (CR 303.4), a `PlayerState.id`. Both shapes resolve to a
 *  display name here so every surface (board badge, pile dialog caption, card
 *  preview) writes the SAME "Attached to: X" text from one derivation.
 *
 *  The host can itself be attached (Power Leak — "Enchant enchantment" — on
 *  Holy Strength on a creature): each link names its OWN host, never the root
 *  of the chain, which is exactly the distinction the board's nested cluster
 *  renders visually. */

/** The permanent `card` is attached to, or undefined when it is unattached /
 *  attached to a player / the host has left the battlefield. */
export function findAttachmentHost(
    card: Pick<CardInstance, "attachedTo">,
    allPlayers: Player[]
): CardInstance | undefined {
    if (!card.attachedTo) return undefined;
    for (const p of allPlayers) {
        for (const c of p.battlefield) {
            if (c.id === card.attachedTo) return c;
        }
    }
    return undefined;
}

/** Display name of `card`'s host — a card name, a player name (CR 303.4
 *  "enchant player"), or null when the card is not attached to anything that
 *  still exists. */
export function attachmentHostName(
    card: Pick<CardInstance, "attachedTo">,
    allPlayers: Player[]
): string | null {
    if (!card.attachedTo) return null;
    const host = findAttachmentHost(card, allPlayers);
    if (host) {
        // Issue #1735 — the host may itself be a face-down permanent under
        // the viewer's OWN control (Power Leak enchanting your own face-down
        // creature): `host.card.id` stays the CR 708.2 sentinel for every
        // viewer including its controller, so the "Attached to: X" line must
        // read the display-only `knownCardId` affordance, exactly like the
        // battlefield tile that same host renders as.
        return tryGetDefinition(displayCardId(host))?.name ?? "permanent";
    }
    const player = allPlayers.find((p) => p.id === card.attachedTo);
    return player ? player.name : null;
}

/** The full "Attached to: X" line, or null when there is nothing to say.
 *  Every UI surface renders this string verbatim — do not re-word it locally. */
export function attachmentLabel(
    card: Pick<CardInstance, "attachedTo">,
    allPlayers: Player[]
): string | null {
    const name = attachmentHostName(card, allPlayers);
    return name ? `Attached to: ${name}` : null;
}
