/**
 * CR 604.1 / 611.3a / 613.1f — the definition-declared static abilities in
 * force for a permanent right now.
 *
 * A static ability's effect applies only while the ability exists, so a
 * permanent whose abilities are suppressed by a layer-6 "loses all abilities"
 * effect (Humility, Titania's Song) generates nothing — no attack or block
 * restriction, no cast restriction or permission, no damage prevention, no
 * enters-tapped replacement. The marker is `abilitiesSuppressedBy`, written by
 * the layer-6 pass onto the permanent itself.
 *
 * Structural on purpose: the battlefield scans in `convex/cards/` run on the
 * engine's `CardInstanceState` AND on the client's projected views, and both
 * carry `card` and `abilitiesSuppressedBy` through. A card off the battlefield
 * (hand, stack) never carries the marker, so reading its own definition
 * through this is identical to reading it raw.
 *
 * Read characteristics (types, mana cost, P/T, name) through
 * `tryGetDefinition`, never through this: they are not abilities, and a
 * suppressed permanent still has them.
 */
import { tryGetDefinition } from "./registry";
import type { CardDefinition } from "./types";

/** The two fields the suppression read needs — satisfied by
 *  `CardInstanceState`, `PermanentView` and every projected battlefield row. */
export interface LiveStaticSource {
    card?: unknown;
    abilitiesSuppressedBy?: ReadonlyArray<unknown>;
}

type StaticEffect = NonNullable<CardDefinition["staticEffects"]>[number];

/** The source's definition while its abilities are in force, else
 *  `undefined` (suppressed, or no resolvable card id). */
export function liveDefinitionOf(
    source: LiveStaticSource
): CardDefinition | undefined {
    if ((source.abilitiesSuppressedBy?.length ?? 0) > 0) return undefined;
    const cardId = (source.card as { id?: string } | undefined)?.id;
    return (cardId ? tryGetDefinition(cardId) : null) ?? undefined;
}

/** The source's `staticEffects[]` while its abilities are in force, else
 *  empty. */
export function liveStaticEffectsOf(
    source: LiveStaticSource
): readonly StaticEffect[] {
    return liveDefinitionOf(source)?.staticEffects ?? [];
}
