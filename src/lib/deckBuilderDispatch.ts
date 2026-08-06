// Save-path dispatch for the deck editor (PRD #466, ADR 0033). The editor is
// shared between two kinds of decks: a user's own `userDecks` row and an
// admin-curated `presetDecks` row. They persist through different Convex
// mutations and key off different identities (a Convex `Id<"userDecks">` vs a
// stable preset slug). This module is the PURE seam between the editor's
// debounced autosave and those mutation pairs, so the dispatch is unit-testable
// without React or a Convex harness.

import type { DeckCard } from "~/types/game";
import type { FormatId } from "@convex/formats";
import type { StoredDeckColumnLayout } from "@convex/deckLayout";

/** The editable deck payload the editor flushes on autosave. The `format` is
 *  carried for the create path only — it is immutable after creation (ADR
 *  0036), so the update sinks drop it before patching. */
export interface DeckSavePayload {
    name: string;
    format: FormatId;
    colors: string[];
    cards: DeckCard[];
    sideboard: DeckCard[];
    // Featured Card override (PRD #589, issue #599). The Card ID the player (or
    // an admin, for a preset) picked to supply the deck's art. Optional: absent
    // ⇒ the server/resolver defaults to the first Maindeck card. Carried on both
    // the create and update paths — unlike `format`, it stays editable.
    featuredCardId?: string;
    // Persisted Column Layout (ADR 0075 §4, PRD #1617, issue #1626) — manual
    // Columns, deleted Columns and Card Pins. `undefined` means "the player
    // never touched the arrangement in this session", and the sinks omit the
    // field entirely so the stored row is left byte-identical; an empty object
    // is the explicit "arrangement cleared" signal and overwrites.
    //
    // `userDecks` ONLY: `presetDecks` has no `layout` column yet, so the
    // preset sinks strip it through `toPresetPayload` below rather than
    // sending a field the mutation would reject at runtime.
    layout?: StoredDeckColumnLayout;
}

/** The patch sent on an UPDATE — everything in a save payload EXCEPT the
 *  immutable `format` (ADR 0036). */
export type DeckUpdatePatch = Omit<DeckSavePayload, "format">;

/** A save payload with no Column Layout — what the PRESET sinks send (issue
 *  #1626). `presetDecks` stores no `layout`, and Convex rejects an argument
 *  the validator doesn't declare, so the field is dropped at this one boundary
 *  rather than guarded at each preset call site. Deletes the KEY rather than
 *  setting it `undefined`: an explicitly-undefined field still travels as an
 *  argument. */
export type PresetSavePayload = Omit<DeckSavePayload, "layout">;

export function toPresetPayload(payload: DeckSavePayload): PresetSavePayload {
    const rest = { ...payload };
    delete rest.layout;
    return rest;
}

/**
 * Strip the immutable `format` from a save payload to build an update patch
 * (ADR 0036). Format is chosen at creation and can never change, and the
 * `userDecks.update` / `decks.updatePreset` mutations reject it — so the update
 * path must drop it. Pure and exported so the immutability boundary is
 * unit-tested without React or a Convex harness.
 */
export function toUpdatePatch(payload: DeckSavePayload): DeckUpdatePatch {
    const patch: DeckUpdatePatch = {
        name: payload.name,
        colors: payload.colors,
        cards: payload.cards,
        sideboard: payload.sideboard,
        // Unlike `format`, the Featured Card is editable on update (PRD #589,
        // issue #599). Both `userDecks.update` and `decks.updatePreset` accept
        // it; the latter is server-gated by `assertIsAdmin` (ADR 0033).
        featuredCardId: payload.featuredCardId,
    };
    // The Column Layout key is added only when the payload HAS one (issue
    // #1626): `userDecks.update` reads an absent `layout` as "leave the stored
    // arrangement alone", which is what editing a pre-#1626 deck's cards must
    // do, and `decks.updatePreset` declares no such argument at all.
    if (payload.layout !== undefined) patch.layout = payload.layout;
    return patch;
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
 * The four Convex mutations the editor's sinks are built on, as plain
 * functions. Declared here — rather than the route wiring the payload shaping
 * inline — because the two SHAPING rules are load-bearing and were previously
 * uncovered (issue #1626, PR #2318 review NB2): drop the `toPresetPayload`
 * call and every preset save becomes a runtime `ArgumentValidationError`
 * (Convex object validators reject an undeclared argument) with a fully green
 * suite, because no test reached the only production caller.
 */
export interface DeckMutationApi {
    createUserDeck: (payload: DeckSavePayload) => Promise<string>;
    updateUserDeck: (id: string, patch: DeckUpdatePatch) => Promise<void>;
    createPreset: (input: PresetSavePayload) => Promise<{ slug: string }>;
    updatePreset: (
        slug: string,
        patch: Omit<PresetSavePayload, "format">
    ) => Promise<void>;
}

/**
 * Builds the editor's sink pair, applying the two payload-shaping rules at the
 * ONE boundary that owns them:
 *
 *  - **`format` is immutable after creation** (ADR 0036) — stripped from every
 *    update patch by `toUpdatePatch`, because both update mutations reject it;
 *  - **`presetDecks` stores no Column Layout** (issue #1626) — stripped from
 *    every preset payload by `toPresetPayload`, on create AND update.
 *
 * Pure: it only closes over the functions it is handed, so the rules are
 * unit-testable without React, a router or a Convex harness.
 */
export function buildDeckBuilderSinks(api: DeckMutationApi): DeckBuilderSinks {
    return {
        user: {
            create: (payload) => api.createUserDeck(payload),
            update: async (id, payload) => {
                await api.updateUserDeck(id, toUpdatePatch(payload));
            },
        },
        preset: {
            create: async (payload) => {
                const { slug } = await api.createPreset(
                    toPresetPayload(payload)
                );
                return slug;
            },
            update: async (slug, payload) => {
                await api.updatePreset(
                    slug,
                    toUpdatePatch(toPresetPayload(payload))
                );
            },
        },
    };
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
