/**
 * Canonical form of a Scryfall print id.
 *
 * The project has ONE id space (ADR 0080): `CardDefinition.id` **is** a
 * Scryfall print UUID, dashed — that is what `data/card-index.json`, every
 * `sets/**` definition and every persisted deck row carry, and what
 * `cards.scryfall.io` puts in its image paths (`/grid/front/a/7/<uuid>.webp`).
 *
 * Two client-side sources hand out the DASHLESS form instead: the Full
 * Catalogue asset (dashes stripped for size, per the ADR 0080 reduction) and
 * Scryfall's own `/cards/search` response as we used to map it. An id from
 * either one flows straight into `cardId` / `prints[].printId` and from there
 * into image URLs and saved manual decks — where a dashless UUID 404s on the
 * CDN and fails to match any in-code definition.
 *
 * So canonicalise at the BOUNDARY where the foreign shape enters, never at
 * each consumer: one call site per source, and everything downstream holds a
 * real print id. Idempotent — an already-dashed id passes through unchanged.
 */
export function toDashedUuid(id: string): string {
    if (id.length !== 32 || id.includes("-")) return id;
    return [
        id.slice(0, 8),
        id.slice(8, 12),
        id.slice(12, 16),
        id.slice(16, 20),
        id.slice(20),
    ].join("-");
}
