// Save-path dispatch for the deck editor (PRD #466, ADR 0033). The editor is
// shared between two kinds of decks: a user's own `userDecks` row and an
// admin-curated `presetDecks` row. They persist through different Convex
// mutations and key off different identities (a Convex `Id<"userDecks">` vs a
// stable preset slug). This module is the PURE seam between the editor's
// debounced autosave and those mutation pairs, so the dispatch is unit-testable
// without React or a Convex harness.

import type { DeckCard } from "~/types/game";

/** The editable deck payload the editor flushes on autosave. */
export interface DeckSavePayload {
    name: string;
    format: string;
    colors: string[];
    cards: DeckCard[];
    sideboard: DeckCard[];
}

/** A user deck is created on first save (no id yet) then patched by id. */
export interface UserDeckSink {
    create: (payload: DeckSavePayload) => Promise<string>;
    update: (id: string, payload: DeckSavePayload) => Promise<void>;
}

/**
 * A preset is edited only (create/delete are #469/#470). It always exists in
 * edit mode and is patched by its immutable slug — the slug is never sent in
 * the payload, so a rename can't change identity.
 */
export interface PresetDeckSink {
    update: (slug: string, payload: DeckSavePayload) => Promise<void>;
}

export interface DeckBuilderSinks {
    user: UserDeckSink;
    preset: PresetDeckSink;
}

/**
 * Persist a save for a brand-new-or-existing USER deck. Returns the deck id
 * (freshly created on the first flush, unchanged thereafter). Mirrors the
 * pre-#466 behavior verbatim.
 */
export async function saveUserDeck(
    sink: UserDeckSink,
    currentId: string | null,
    payload: DeckSavePayload
): Promise<string> {
    if (currentId === null) {
        return await sink.create(payload);
    }
    await sink.update(currentId, payload);
    return currentId;
}

/**
 * Persist a save for an existing PRESET deck. The slug is the stable identity
 * passed straight through; it is intentionally read-only and never derived from
 * `payload.name`, so renaming a preset can't change its slug.
 */
export async function savePreset(
    sink: PresetDeckSink,
    slug: string,
    payload: DeckSavePayload
): Promise<string> {
    await sink.update(slug, payload);
    return slug;
}

export type DeckBuilderKind = "user" | "preset";

/**
 * Pure dispatch: map the editor `kind` + current identity to the single async
 * "save this payload, return the resulting identity" call the editor needs.
 * The editor never branches on `kind` itself — it calls the returned function.
 * For `kind: "preset"`, `identity` is the (always-present) slug; for
 * `kind: "user"` it is the deck id or null on the first save.
 */
export function dispatchDeckSave(
    kind: DeckBuilderKind,
    sinks: DeckBuilderSinks,
    identity: string | null
): (payload: DeckSavePayload) => Promise<string> {
    if (kind === "preset") {
        if (identity === null) {
            // Edit-only in this slice: a preset must already exist.
            throw new Error("Preset edit requires an existing slug");
        }
        return (payload) => savePreset(sinks.preset, identity, payload);
    }
    return (payload) => saveUserDeck(sinks.user, identity, payload);
}
