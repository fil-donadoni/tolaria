import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Typed, immutable deck Format (PRD #509, ADR 0036). `userDecks` and
// `presetDecks` store one of exactly three literals — a non-conforming string
// is rejected at the DB boundary. Kept in sync with `FormatId` in
// `convex/formats.ts` (the single source of truth for format policy).
const formatValidator = v.union(
    v.literal("freeform"),
    v.literal("alpha-40"),
    v.literal("old-school"),
    v.literal("premodern")
);

export default defineSchema({
    ...authTables,
    users: defineTable({
        name: v.optional(v.string()),
        image: v.optional(v.string()),
        email: v.optional(v.string()),
        emailVerificationTime: v.optional(v.number()),
        phone: v.optional(v.string()),
        phoneVerificationTime: v.optional(v.number()),
        isAnonymous: v.optional(v.boolean()),
        nickname: v.string(),
        // Admin flag (PRD #466, ADR 0033). A trusted user flagged `isAdmin`
        // may curate the built-in Preset Decks from the deck editor. Optional
        // so existing rows load unchanged (absent === not an admin).
        isAdmin: v.optional(v.boolean()),
    }).index("email", ["email"]),
    game_states: defineTable({
        gameId: v.id("games"),
        seq: v.number(),
        state: v.any(),
        updatedAt: v.number(),
    }).index("by_gameId", ["gameId", "seq"]),
    decks: defineTable({
        presetId: v.string(),
        name: v.string(),
        format: v.string(),
        description: v.optional(v.string()),
        colors: v.array(v.string()),
        cards: v.array(
            v.object({
                cardId: v.string(),
                cardName: v.string(),
            })
        ),
    }).index("by_presetId", ["presetId"]),
    userDecks: defineTable({
        userId: v.id("users"),
        name: v.string(),
        // Typed, immutable deck Format (ADR 0036). Chosen at creation; edit is
        // read-only. Existing `"Freeform"` rows are migrated to `"freeform"`.
        format: formatValidator,
        description: v.optional(v.string()),
        colors: v.array(v.string()),
        // Maindeck: the cards that build the starting Library.
        cards: v.array(
            v.object({
                cardId: v.string(),
                cardName: v.string(),
            })
        ),
        // Sideboard: 0–15 cards held aside (PRD #387, issue #391). Optional so
        // decks saved before sideboarding load unchanged (absent === empty).
        sideboard: v.optional(
            v.array(
                v.object({
                    cardId: v.string(),
                    cardName: v.string(),
                })
            )
        ),
        // Featured Card override (PRD #589, issue #593). A Card ID picked to
        // represent the deck's art in the lobby. Optional: absent ⇒ the
        // resolver defaults to the first card inserted into the Maindeck. Stored
        // as a Card ID only — art uses the default printing (no migration: an
        // absent value resolves to the default). Not part of legality (ADR
        // 0036). Resolved via the pure `resolveFeaturedCardId`.
        featuredCardId: v.optional(v.string()),
    }).index("by_user", ["userId"]),
    // Preset Decks (PRD #466, ADR 0033). The built-in decklists, moved out of
    // the in-code `PRESET_DECKS` constant into the DB so a trusted Admin can
    // curate them live from the deck editor. Mirrors `userDecks` minus
    // ownership: no `userId`. The `slug` is a stable, human-readable identity
    // (e.g. `mono-red-burn`) derived from the name at creation and immutable
    // thereafter — external references (lobby selection, wire payloads, debug
    // scenarios) key off the slug, NOT the random Convex `_id`.
    presetDecks: defineTable({
        slug: v.string(),
        name: v.string(),
        // Typed deck Format (ADR 0036). An Admin chooses it when authoring a
        // preset. Existing rows are wiped (not migrated) and recreated.
        format: formatValidator,
        description: v.optional(v.string()),
        colors: v.array(v.string()),
        // Maindeck: the cards that build the starting Library.
        cards: v.array(
            v.object({
                cardId: v.string(),
                cardName: v.string(),
            })
        ),
        // Sideboard: 0–15 cards held aside (PRD #387). Optional; absent ===
        // empty for presets that ship without one.
        sideboard: v.optional(
            v.array(
                v.object({
                    cardId: v.string(),
                    cardName: v.string(),
                })
            )
        ),
        // Featured Card override (PRD #589, issue #593). Mirrors `userDecks`:
        // a Card ID representing the preset's art in the lobby. Absent ⇒ the
        // resolver defaults to the first Maindeck card. Card ID only (default
        // printing); not part of legality (ADR 0036).
        featuredCardId: v.optional(v.string()),
    }).index("by_slug", ["slug"]),
    // A Match (ADR 0029 / PRD #387) is a best-of-N set of Games. The single
    // create/join/solo paths build a `bestOf: 1` Match whose first Game is the
    // existing init path. The Match owns the cross-game state: running score,
    // the mutable per-player deck copy (maindeck + sideboard) snapshotted at
    // creation, the sideboarding ready flags, and the play/draw chooser.
    matches: defineTable({
        bestOf: v.union(v.literal(1), v.literal(3)),
        status: v.union(
            // Mirrors the game lifecycle: a 2-player Match opens "waiting" for
            // an opponent; "pregame" is the G1 coin-toss + play/draw gate (CR
            // 103.2-103.4) before the first Game builds; then "playing";
            // "sideboarding" is the Bo3 between-games gate; "finished" is
            // terminal.
            v.literal("waiting"),
            v.literal("pregame"),
            v.literal("playing"),
            v.literal("sideboarding"),
            v.literal("finished")
        ),
        // Per-player Match-scoped state. `id` is the same opaque GRE handle the
        // `games` row uses. `deck` is the MUTABLE Match copy (sideboarding edits
        // it; `userDecks` is read-only for the Match's duration). Each Game's
        // library is built from `deck.maindeck` as of that Game's start.
        players: v.array(
            v.object({
                id: v.string(),
                name: v.string(),
                bgColor: v.string(),
                deck: v.object({
                    id: v.string(),
                    name: v.string(),
                    format: v.string(),
                    maindeck: v.array(
                        v.object({
                            cardId: v.string(),
                            cardName: v.string(),
                        })
                    ),
                    sideboard: v.array(
                        v.object({
                            cardId: v.string(),
                            cardName: v.string(),
                        })
                    ),
                }),
                /** Games won so far in this Match. */
                score: v.number(),
                /** Sideboarding ready flag; reset between Games (Bo3). */
                ready: v.boolean(),
            })
        ),
        currentGameNumber: v.number(),
        currentGameId: v.optional(v.id("games")),
        /** Loser of the previous Game who chooses play/draw for the next one. */
        playDrawChooserId: v.optional(v.string()),
        /** Player id of the Match winner (set when status → "finished"). */
        winner: v.optional(v.string()),
        solo: v.optional(v.boolean()),
        vsAi: v.optional(v.boolean()),
        createdAt: v.number(),
        updatedAt: v.number(),
    }).index("by_status", ["status"]),
    games: defineTable({
        name: v.string(),
        /** Owning Match (ADR 0029). Every Game belongs to exactly one Match. */
        matchId: v.optional(v.id("matches")),
        /** 1-based position of this Game within its Match. */
        gameNumber: v.optional(v.number()),
        status: v.union(
            v.literal("waiting"),
            // "pregame": the owning Match is resolving the G1 coin toss +
            // play/draw choice; no game_states row exists yet (CR 103.2-103.4).
            v.literal("pregame"),
            v.literal("playing"),
            v.literal("finished")
        ),
        // `players[].id` is an opaque player handle used by the GRE as
        // controllerId/ownerId. For 2-player games it equals the user's
        // `Id<"users">`; for solo games it is `${userId}-p1` / `${userId}-p2`.
        // Keep as v.string() to accommodate both shapes.
        players: v.array(
            v.object({
                id: v.string(),
                name: v.string(),
                bgColor: v.string(),
                deck: v.object({
                    id: v.string(),
                    name: v.string(),
                    format: v.string(),
                    cards: v.array(
                        v.object({
                            cardId: v.string(),
                            cardName: v.string(),
                        })
                    ),
                }),
            })
        ),
        /** ID of the winning player (set when status transitions to "finished"). */
        winner: v.optional(v.string()),
        /** Solo (single-user) game: both players belong to the same user. The client
         * auto-switches its viewer to the player who currently has priority. */
        solo: v.optional(v.boolean()),
        /** vs-AI game (ADR 0001): structurally a solo game where the SECOND seat
         * (`${userId}-p2`) is driven by the client-side AI brain rather than by
         * the human. The viewer stays pinned to the human's seat. */
        vsAi: v.optional(v.boolean()),
        createdAt: v.number(),
        updatedAt: v.number(),
    })
        .index("by_status", ["status"])
        .index("by_match", ["matchId"]),
});
