// Pure logic for the deck-builder Featured Card picker (PRD #589, issue #599).
// The picker stores a Featured Card ID override on the working deck, persisted
// through the existing deck update mutation (admin-gated for presets, ADR 0033).
// These seams are pure and unit-tested without React so the toggle and the
// across-reloads resolution can't silently regress.

import { resolveFeaturedCardId } from "@convex/deckPresets";
import type { DeckCard } from "~/types/game";

/**
 * Toggle the Featured Card override. Picking a different card sets it; clicking
 * the card that's already featured clears the override (`undefined`), reverting
 * to the first-Maindeck-card default (User Story 13). `current` is the override
 * stored on the working deck, not the resolved value.
 */
export function toggleFeatured(
    current: string | undefined,
    cardId: string
): string | undefined {
    return current === cardId ? undefined : cardId;
}

/**
 * Resolve the card currently supplying the deck's art for the builder's
 * indicator. The effective override is the one picked this session
 * (`workingOverride`), or — when untouched — the value the deck loaded with
 * (`loadedFeaturedCardId`, already resolved server-/client-side), so the
 * indicator survives reloads (User Story 16). Either way it runs through the
 * shared resolver against the LIVE Maindeck, so an override pointing at a
 * removed card falls back to the first remaining card (User Story 17) and an
 * empty deck resolves to `null`.
 */
export function effectiveFeatured(
    workingOverride: string | undefined,
    loadedFeaturedCardId: string | null | undefined,
    cards: DeckCard[]
): string | null {
    const override = workingOverride ?? loadedFeaturedCardId ?? undefined;
    return resolveFeaturedCardId({
        featuredCardId: override ?? undefined,
        cards,
    });
}
