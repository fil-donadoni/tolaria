import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Typed, immutable deck Format (PRD #509, ADR 0036). `userDecks` and
// `presetDecks` store one of these literals — a non-conforming string is
// rejected at the DB boundary. Kept in sync with `FormatId` in
// `convex/formats.ts` (the single source of truth for format policy).
// `"limited"` (ADR 0054/0055, issue #1109) is pool-scoped rather than
// catalogue-scoped — see `userDecks.limitedEventId`/`limitedSeatId` below.
const formatValidator = v.union(
    v.literal("freeform"),
    v.literal("alpha-40"),
    v.literal("old-school"),
    v.literal("premodern"),
    v.literal("limited")
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
        // Limited Event + Seat reference (ADR 0054/0055, issue #1109). Set
        // once at creation for a `format: "limited"` deck — its whole Pool
        // was generated (Sealed) or drafted at this Seat. Opaque string
        // handles (like `players[].id`), NOT `v.id()`: the event/seat tables
        // land in a later slice (issue #1110), so this is forward-compatible
        // storage, not yet a foreign key. `convex/formats.ts`'s
        // `checkPoolMembership` is the only reader (via an injected
        // `ResolvePool`); absent on every non-limited deck.
        limitedEventId: v.optional(v.string()),
        limitedSeatId: v.optional(v.string()),
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
    // Format banlists (PRD #1138, ADR 0057, issue #1141) — the full OFFICIAL
    // banlist by oracle name, including cards not yet implemented in the
    // engine (e.g. Parallax Tide for Premodern). Names only — NO cardId is
    // stored; enforcement resolves name → `CardDefinition.id` LIVE at read
    // time via the `nameRegistry` (`resolveBanlistEnforcement` in
    // `convex/formats.ts`), so a card built after a sync is banned instantly.
    // Populated by the (future) admin "Sync from Scryfall" action; until then,
    // `convex/banlists.ts` falls back to a code-side seed when a format has no
    // rows, so the display list is never empty pre-sync.
    formatBanlists: defineTable({
        format: v.union(v.literal("premodern"), v.literal("old-school")),
        cardName: v.string(),
        status: v.union(v.literal("banned"), v.literal("restricted")),
        source: v.string(),
        syncedAt: v.number(),
        // Scryfall card id (PRD #1138 follow-up) — captured at sync so the
        // admin dialog can render a card's image even when it has no
        // CardDefinition in our engine. Optional: code-seed rows and rows
        // synced before this field existed carry no id.
        scryfallId: v.optional(v.string()),
    }).index("by_format", ["format"]),
    // Cube lists (deck-builder discovery filter). A named, curated card list
    // (e.g. the Vintage Cube) that narrows the builder's card pool to its
    // members — a card *list*, not a set list, so it does not fit a Format's
    // `allowedSets`. Stored by oracle NAME (not cardId), resolved to the built
    // pool at read time via `tryGetCardByName` (same pattern as `formatBanlists`
    // + `ResolveCardByName`): a name with no built `CardDefinition` is dropped
    // from the filter, and a card ships straight into every cube it's named in
    // with no cube edit. Purely a discovery filter — it never gates deck
    // legality (`validateDeck`/`assertDeckLegal`). Write path is `assertIsAdmin`
    // -gated (`convex/cubes.ts`).
    cubeLists: defineTable({
        slug: v.string(),
        name: v.string(),
        cardNames: v.array(v.string()),
        updatedAt: v.number(),
    }).index("by_slug", ["slug"]),
    // Debug scenarios (issue #769, ADR 0044). A preset board state — the
    // *argument* to the unchanged `debugSetupScenario` builder — relocated out
    // of the `PRESET_SCENARIOS` code literal into the DB, scoped per user. The
    // panel lists a user's rows and, on click, passes the stored `spec` straight
    // to `debugSetupScenario`. The write path is `assertIsAdmin`-gated
    // (`convex/debugScenarios.ts`), inheriting the same gate as the builder.
    // Limited Event skeleton + Sealed flow (PRD #1107, ADR 0054/0055, issue
    // #1110). A single row per event carries every Seat inline (array, like
    // `matches.players` — at most 8 seats, so an atomic single-row patch is
    // simpler than a child table and keeps join/start race-free under Convex
    // OCC). `createLimitedEvent` is `assertIsAdmin`-gated; `joinEvent` fills a
    // free seat for any authenticated user; `startEvent` (the event's
    // `createdBy`) fills every still-empty seat with a Bot Drafter placeholder
    // and — for a Sealed event — deals each seat's Pool via the pure seeded
    // Booster generator (`convex/limited/boosterGenerator.ts`). Draft's
    // synchronous pick/pass flow is a later slice; this table already carries
    // `type: "draft"` so the event/lobby skeleton doesn't need a second
    // migration when that lands.
    limitedEvents: defineTable({
        createdBy: v.id("users"),
        type: v.union(v.literal("sealed"), v.literal("draft")),
        // "open": joining seats, not yet started. "started": every seat is
        // filled (human or bot) and — for Sealed — Pools are generated.
        // Completion / all-Pools-reveal (PRD #1107 story 26) is deck-building
        // integration, deferred to a later slice.
        status: v.union(v.literal("open"), v.literal("started")),
        seatCount: v.number(),
        // Pack Source per pack slot (Draftable Set codes, e.g. ["lea"] or
        // ["lea","lea","lea"] for a 3-round Draft). A Sealed event cycles this
        // list across `sealedBoosterCount` boosters per seat.
        packSlots: v.array(v.string()),
        // Sealed boosters per seat (default 6). Optional so a Draft-typed
        // event (whose pack count is `packSlots.length`, not this field) can
        // omit it; `startEvent` defaults it when generating a Sealed Pool.
        sealedBoosterCount: v.optional(v.number()),
        // Event RNG seed (ADR 0055), set once at `startEvent` so the seat
        // Pools it produced are reproducible/replayable given the same seed.
        seed: v.optional(v.number()),
        // Per-pick timer, in seconds (issue #1114, PRD #1107 story 5/14).
        // Configured once at `createLimitedEvent`; absent === disabled (no
        // countdown, no Auto-Pick ever scheduled). Draft only — a Sealed
        // event has no picks to time.
        timerSeconds: v.optional(v.number()),
        // Draft only (issue #1112): 0-indexed current booster round —
        // `packSlots[draftRound]` is the Pack Source of the boosters in play.
        // Absent for Sealed / before a Draft starts.
        draftRound: v.optional(v.number()),
        // Draft only: packs of the CURRENT round not yet fully picked through
        // (`draftEngine.ts`'s `applyPick`). Reaching 0 either deals the next
        // round or — on the last round — completes the draft.
        draftPacksRemaining: v.optional(v.number()),
        // Draft only: set once, the instant the last pack of the last round
        // empties — every seat's Pool is final and deckbuilding can start.
        // Absent while the draft is still in progress (or for Sealed).
        draftCompletedAt: v.optional(v.number()),
        seats: v.array(
            v.object({
                seatIndex: v.number(),
                userId: v.optional(v.id("users")),
                nickname: v.optional(v.string()),
                // Bot Drafter placeholder (PRD #1107 story 8), set at
                // `startEvent` for every seat still unclaimed by a human.
                isBot: v.optional(v.boolean()),
                // The seat's authoritative Pool (ADR 0054/0055) — one entry
                // per physical card opened, not yet grouped into counts (the
                // legality-side `Pool`/`PoolCard` shape in `convex/formats.ts`
                // is derived from this at the deckbuilding seam, a later
                // slice). Absent until `startEvent` generates it (Sealed: in
                // full; Draft: accumulates one Pick at a time, issue #1112).
                pool: v.optional(
                    v.array(
                        v.object({
                            scryfallId: v.string(),
                            cardId: v.string(),
                            cardName: v.string(),
                        })
                    )
                ),
                // Draft only: the pack currently in front of this seat to
                // Pick from (`pickId` disambiguates a duplicate scryfallId
                // within the same pack). Absent while waiting for the next
                // pass, or for a Sealed event.
                currentPack: v.optional(
                    v.array(
                        v.object({
                            scryfallId: v.string(),
                            cardId: v.string(),
                            cardName: v.string(),
                            pickId: v.string(),
                        })
                    )
                ),
                // Draft only: packs passed here while `currentPack` was still
                // non-empty, FIFO (PRD #1107 story 13).
                packQueue: v.optional(
                    v.array(
                        v.array(
                            v.object({
                                scryfallId: v.string(),
                                cardId: v.string(),
                                cardName: v.string(),
                                pickId: v.string(),
                            })
                        )
                    )
                ),
                // Draft only, timer-on events (issue #1114): epoch ms when
                // this seat's CURRENT pack's pick timer expires. Absent when
                // the event has no `timerSeconds`, this is a Bot Drafter seat
                // (bots pick instantly, never idly holding a pack), or
                // nothing is currently in front of the seat. Server-written
                // only (`draftEngine.ts`'s pure stamping helpers) — never
                // client-settable, so a client can't extend its own timer.
                pickDeadline: v.optional(v.number()),
                // Draft only, timer-on events: monotonic counter bumped every
                // time this seat's `currentPack` is freshly assigned (dealt
                // or passed in) — NOT bumped when a pick merely clears it to
                // empty. `startLimitedEvent`/`submitPick` schedule the
                // Auto-Pick timeout with the value captured at scheduling
                // time; `autoPickSeatTimeout` re-checks it against the LIVE
                // value when it fires — a mismatch means a human pick (or a
                // later pack) already superseded this schedule, so the
                // timeout is a no-op. This is the seq-based cancellation
                // CLAUDE.md's priority-timeout pattern uses, adapted here
                // since Convex has no cheap "cancel a scheduled job" call.
                pickSeq: v.optional(v.number()),
            })
        ),
        createdAt: v.number(),
        updatedAt: v.number(),
    })
        .index("by_status", ["status"])
        .index("by_createdBy", ["createdBy"]),
    debugScenarios: defineTable({
        userId: v.id("users"),
        label: v.string(),
        // The resolved spec, same shape `debugSetupScenario` accepts (minus
        // `gameId`). Stored as `v.any()` on PURPOSE so the load path is TOLERANT
        // (ADR 0044): a row written under today's shape still loads after a
        // field is added/removed — `normalizeScenarioSpec` drops unknown fields
        // and defaults missing ones. The strict `scenarioSpecValidator`
        // (`convex/debugScenarioSpec.ts`) guards only the WRITE path.
        spec: v.any(),
        // Disposable/promotable rows (issue #772, ADR 0044). `golden` promotes a
        // row to "keep" — golden rows survive `cleanupEphemeralScenarios`,
        // ephemeral (non-golden) rows are pruned past a bound. `prompt` stores the
        // originating NL description (metadata only — the frozen `spec` is what
        // loads, never the prompt); it drives regenerate/vary. `schemaVersion`
        // stamps only golden rows so schema drift against a long-lived curated row
        // is detectable (ADR 0044: "only the few golden rows warrant a version
        // tag").
        golden: v.optional(v.boolean()),
        prompt: v.optional(v.string()),
        schemaVersion: v.optional(v.number()),
        createdAt: v.number(),
    }).index("by_user", ["userId"]),
});
