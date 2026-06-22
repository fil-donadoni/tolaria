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
 * A preset is created on first save (no slug yet — the server derives it from
 * the name) then patched by its immutable slug. The slug is never sent in the
 * update payload, so a rename can't change identity (delete is #470).
 */
export interface PresetDeckSink {
    create: (payload: DeckSavePayload) => Promise<string>;
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

/**
 * Persist a save for a brand-new-or-existing PRESET deck (issue #469). On the
 * first flush there is no slug yet — the create mutation derives it from the
 * name server-side and returns it; subsequent flushes patch by that slug, which
 * is then immutable (a rename never changes it).
 */
export async function savePresetCreate(
    sink: PresetDeckSink,
    currentSlug: string | null,
    payload: DeckSavePayload
): Promise<string> {
    if (currentSlug === null) {
        return await sink.create(payload);
    }
    await sink.update(currentSlug, payload);
    return currentSlug;
}

export type DeckBuilderKind = "user" | "preset";
export type DeckBuilderMode = "create" | "edit";

/**
 * Pure dispatch: map the editor `kind` + `mode` + current identity to the
 * single async "save this payload, return the resulting identity" call the
 * editor needs. The editor never branches on `kind` itself — it calls the
 * returned function.
 *
 * - `kind: "user"` — create on the first save (null id), then patch by id.
 * - `kind: "preset"`, `mode: "create"` — create on the first save (null slug;
 *   the server derives the slug from the name), then patch by that slug.
 * - `kind: "preset"`, `mode: "edit"` — patch the (always-present) slug; a null
 *   identity is an error (an editable preset must already exist).
 */
export function dispatchDeckSave(
    kind: DeckBuilderKind,
    sinks: DeckBuilderSinks,
    identity: string | null,
    mode: DeckBuilderMode = "edit"
): (payload: DeckSavePayload) => Promise<string> {
    if (kind === "preset") {
        if (mode === "create") {
            return (payload) =>
                savePresetCreate(sinks.preset, identity, payload);
        }
        if (identity === null) {
            // Edit mode requires an existing preset slug.
            throw new Error("Preset edit requires an existing slug");
        }
        return (payload) => savePreset(sinks.preset, identity, payload);
    }
    return (payload) => saveUserDeck(sinks.user, identity, payload);
}
