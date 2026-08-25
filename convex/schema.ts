import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
// One Pool Arrangement entry (ADR 0060, issue #1247; Card Pins, ADR 0075
// §3/§5, issue #1621). NOT re-declared here: the validator is exported from
// `convex/limited/eventTypes.ts` alongside the `PoolArrangementEntry` type it
// describes, and is imported by BOTH storage sites below (the legacy inline
// `limitedEvents.seats[].poolArrangement` and the live
// `limitedSeats.poolArrangement`) AND by the returns validator in
// `convex/limitedEvents.ts` — one authority, so a new Pin namespace can't be
// added to one site and silently missed at another. That module is types +
// `convex/values` only (its `CardPins` import is type-only), so importing it
// here adds no runtime weight to the schema.
import { poolArrangementEntryValidator } from "./limited/eventTypes";
// The persisted Column Layout of a deck row (ADR 0075 §4, issue #1626). Same
// arrangement, same reason: declared once in the leaf module
// `convex/deckLayoutStorage.ts` (types + `convex/values` only — the Column
// Layout ENGINE it mirrors carries a card-registry edge this schema must not
// pull in) and imported by both the storage site below and `userDecks.ts`'s
// mutation args.
import { storedDeckColumnLayoutValidator } from "./deckLayoutStorage";

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
    v.literal("limited"),
    v.literal("manual")
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
    gameStates: defineTable({
        gameId: v.id("games"),
        seq: v.number(),
        state: v.any(),
        // Game-mode flags MIRRORED from the owning `games` row, stamped once
        // when this row is inserted (`saveGameState`, `convex/game.ts`) and
        // immutable thereafter — a Game never changes mode after creation.
        //
        // They live here purely as a read-bandwidth fix (PRD #1776 follow-up).
        // `getPublicState` needs exactly these two booleans off the `games`
        // row to pick the solo viewer seat, and nothing else — but a document
        // read is billed by the WHOLE document, and the prod `games` row
        // measures 8.3 KB of which 7.33 KB is the two decklists the query does
        // not project. That read re-executed on every subscription re-run
        // (~22K/month) and was 54% of `getPublicState`'s database I/O, the
        // single largest line on the deployment's bill.
        //
        // ABSENCE means "written before this field existed", NOT "false":
        // both are written together, explicitly, including the `false` case,
        // so `solo === undefined` is an unambiguous legacy marker and the
        // reader falls back to the `games` row. `backfillGameStateMode`
        // (`convex/game.ts`) stamps the rows that predate this.
        solo: v.optional(v.boolean()),
        vsAi: v.optional(v.boolean()),
        updatedAt: v.number(),
    }).index("by_gameId", ["gameId", "seq"]),
    // Tick row (PRD #1776 T3, issue #1778): a ~150-byte cheap wake-up signal
    // written alongside every `gameStates` write from `saveGameState`
    // (`convex/game.ts`) so a subscriber that only needs to know "did
    // something change, and does it need to act" doesn't have to hold a full
    // 3-9 KB `gameStates` subscription just to find out. One row per game
    // (patch in place, mirroring `gameStates`' single-row-per-game model),
    // carrying exactly the fields `useVsAiDriver` needs to decide whether the
    // bot seat owes input WITHOUT mounting `getPublicState`:
    // `priorityPlayerId`/`phase`/`expectedInputKind`/`owedPlayerIds`/`gameOver`.
    // `seq` is the authoritative "did this actually change" signature — the
    // driver's in-flight guard keys off THIS `seq`, not the (unsubscribed)
    // full state's, so the same tick never drives the bot twice.
    gameTicks: defineTable({
        gameId: v.id("games"),
        seq: v.number(),
        priorityPlayerId: v.optional(v.string()),
        phase: v.string(),
        // Mirrors `ExpectedInput["kind"]` (`convex/gre/expectedInput.ts`,
        // ADR 0047) minus the rest of the union's payload — the driver only
        // needs to know WHICH kind of input is expected, not the full target
        // list/choice shape (that still requires the fat state).
        expectedInputKind: v.optional(v.string()),
        // The player id(s) actually owed to act this tick (issue #1778 review
        // finding 1 — `computeOwedPlayerIds`, `convex/gre/expectedInput.ts`).
        // NOT simply `expectedInput.playerId`: the CR 510.1c/702.22j-k combat
        // damage-assignment sub-flow folds into a plain `{kind:"priority"}`
        // window gated `anyPlayer: true` (`setDamageAssignment`/
        // `confirmDamage`, `convex/game.ts`) while the real actor(s) live in
        // `combat.damageAssignerIds` and can differ from `priorityPlayerId` —
        // banding shifts assignment to the non-active player. A subscriber
        // MUST gate on membership in this array, never on equality with a
        // single player id, or a non-active damage assigner is never named
        // and the game deadlocks waiting for input that never arrives.
        owedPlayerIds: v.optional(v.array(v.string())),
        gameOver: v.optional(v.boolean()),
        updatedAt: v.number(),
    }).index("by_gameId", ["gameId"]),
    // Manual Mode state (ADR 0080) — mirrors gameStates, one row per game,
    // patched in place. State is opaque JSON (no compile-time shape); the
    // import-graph boundary guard ensures nothing here imports from convex/gre/.
    manualStates: defineTable({
        gameId: v.id("games"),
        seq: v.number(),
        state: v.any(),
        updatedAt: v.number(),
    }).index("by_gameId", ["gameId", "seq"]),
    // Manual Mode action log (ADR 0080) — one row per action, retained for
    // the normal retention window after game end (the only artefact worth
    // reading afterwards; the state row is deleted like gameStates).
    manualLog: defineTable({
        gameId: v.id("games"),
        action: v.any(),
        createdAt: v.number(),
    }).index("by_gameId", ["gameId"]),
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
        // Column Layout (ADR 0075 §4, PRD #1617, issue #1626) — the DECK half
        // of the deckbuilder workspace: the manual Columns the player added,
        // the Columns they deleted, and their Card Pins. Deck data, so it
        // follows the deck across devices, exactly as the Pool Arrangement
        // follows a Limited seat. Grouping, Ordering, zoom and split are NOT
        // here: those are per-USER view preferences and live in
        // `localStorage` (`src/lib/deckViewPrefs.ts`); the Zone filter is
        // never persisted at all.
        //
        // Optional, with every field inside it optional too, so a deck saved
        // before this slice loads with no layout and behaves exactly as it
        // did — no migration, the same tolerant-read rule ADR 0075 §5 applies
        // to `poolArrangement`. A Limited deck row leaves `pins` absent: its
        // Pins are keyed by `poolIndex` on the seat's Pool Arrangement so two
        // physical copies stay individually placeable.
        layout: v.optional(storedDeckColumnLayoutValidator),
    })
        .index("by_user", ["userId"])
        // Every `limited`-format deck tied to one event, across ALL users
        // (issue #1116: event completion needs "does every SEAT have a
        // deck", not "does this ONE user have a deck" — `by_user` can't
        // answer that without a full table scan). Bounded query: at most
        // `seatCount` (<=8) rows ever match one eventId.
        .index("by_limitedEvent", ["limitedEventId"]),
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
    //
    // The deck COPY itself no longer lives here — see the `matchDecks` comment
    // below (issue #2506). `players[].deck` keeps only the identity a reader
    // needs off the row (`id`/`name`/`format`); `maindeck`/`sideboard` are
    // optional purely so rows written before the split keep working.
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
                    // LEGACY ONLY (issue #2506) — the live copy is a
                    // `matchDecks` row. Present on rows written before the
                    // split; `convex/deckStore.ts` folds it in when no child
                    // row exists.
                    maindeck: v.optional(
                        v.array(
                            v.object({
                                cardId: v.string(),
                                cardName: v.string(),
                            })
                        )
                    ),
                    sideboard: v.optional(
                        v.array(
                            v.object({
                                cardId: v.string(),
                                cardName: v.string(),
                            })
                        )
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
        /** Limited Event this Match is a challenge within (issue #1577) — set
         *  only for a human-vs-human event challenge (`challengeLimitedSeat`),
         *  absent for every other Match. Binds the pairing to one event so the
         *  two seats' decks are validated to share it. */
        limitedEventId: v.optional(v.string()),
        /** Pending challenge metadata (issue #1577) — who challenged whom, by
         *  seat, within `limitedEventId`. Present alongside `limitedEventId`. */
        limitedChallenge: v.optional(
            v.object({
                challengerSeatIndex: v.number(),
                challengedUserId: v.string(),
                challengedSeatIndex: v.number(),
            })
        ),
        /** Round pairing this Match IS (PRD #1628, issue #1640) — set only for
         *  a Match created by the event's play phase, alongside
         *  `limitedEventId`. Absent for a free challenge (which carries
         *  `limitedChallenge` instead) and for every non-event Match. Present
         *  so a FINISHED Match can find the pairing to record its result
         *  against without scanning the event's rounds. */
        limitedPairing: v.optional(
            v.object({
                round: v.number(),
                seatA: v.number(),
                seatB: v.number(),
            })
        ),
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
            // play/draw choice; no gameStates row exists yet (CR 103.2-103.4).
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
                    // LEGACY ONLY (issue #2506) — the live snapshot is a
                    // `gameDecks` row. See the `gameDecks` comment below.
                    cards: v.optional(
                        v.array(
                            v.object({
                                cardId: v.string(),
                                cardName: v.string(),
                            })
                        )
                    ),
                }),
            })
        ),
        /** Every DISTINCT print id in this Game's two decklists, in first-seen
         *  order (issue #2506). The art-preload manifest `<Board>` used to
         *  derive by walking `players[].deck.cards` — the one thing the client
         *  actually wanted off the fat decklists. Deduped across both seats
         *  (~30 ids ≈ 1.1 KB) so it costs a fraction of the ~7.1 KB of card
         *  entries it replaces on the hot row, and no reader needs a second
         *  read to render the board. Absent on rows written before the split;
         *  `<Board>` falls back to the inline copy. */
        cardIds: v.optional(v.array(v.string())),
        /** ID of the winning player (set when status transitions to "finished"). */
        winner: v.optional(v.string()),
        /** Solo (single-user) game: both players belong to the same user. The client
         * auto-switches its viewer to the player who currently has priority. */
        solo: v.optional(v.boolean()),
        /** vs-AI game (ADR 0001): structurally a solo game where the SECOND seat
         *  (`${userId}-p2`) is driven by the client-side AI brain rather than by
         *  the human. The viewer stays pinned to the human's seat. */
        vsAi: v.optional(v.boolean()),
        /** Manual Mode (ADR 0080): when set, this game is a Manual Game — the
         *  client mounts the manual board instead of the GRE board. Read ONLY by
         *  the route that chooses which board, never by the engine. */
        mode: v.optional(v.literal("manual")),
        /** Limited Event this Game is a challenge within (issue #1577) — mirror
         *  of the owning Match's `limitedEventId`. Indexed (`by_limited_event`)
         *  so the event page can surface a seat's pending challenges. */
        limitedEventId: v.optional(v.string()),
        /** Pending challenge metadata (issue #1577) — mirror of the Match's
         *  `limitedChallenge`; `joinGame` reads it to gate the accept. */
        limitedChallenge: v.optional(
            v.object({
                challengerSeatIndex: v.number(),
                challengedUserId: v.string(),
                challengedSeatIndex: v.number(),
            })
        ),
        /** Round pairing this Game belongs to (PRD #1628, issue #1640) —
         *  mirror of the owning Match's `limitedPairing`, so a Game row alone
         *  identifies the pairing it counts towards. */
        limitedPairing: v.optional(
            v.object({
                round: v.number(),
                seatA: v.number(),
                seatB: v.number(),
            })
        ),
        /** Short human-typeable code for "Join by code" (issue #2649). Minted
         *  by `createGame` for a public Arena table and CLEARED the moment the
         *  table leaves `waiting` — so the field's presence IS the code's
         *  lifetime, and a stale code cannot resolve to anything.
         *
         *  Not a secret, and deliberately not described as one: `listOpenGames`
         *  strips it, but `getGame` is an unauthenticated public query that
         *  returns the raw row, so any client holding a game id can read that
         *  table's code (`docs/findings/2649-getgame-returns-any-games-row-
         *  unauthenticated-by-membership.md`). That leaks nothing a code buys —
         *  every table a code can name is already listed, by id, in the public
         *  lobby — but the next author must not build a secrecy assumption on
         *  this field. What the code IS: a way to reach a listed table without
         *  the list. */
        joinCode: v.optional(v.string()),
        createdAt: v.number(),
        updatedAt: v.number(),
    })
        .index("by_status", ["status"])
        .index("by_match", ["matchId"])
        .index("by_limited_event", ["limitedEventId"])
        .index("by_join_code", ["joinCode"]),
    // One seat's decklist, split out of `games.players[].deck.cards` (issue
    // #2506) — the same move `limitedSeats` made out of `limitedEvents.seats[]`
    // (see that table's comment for the general shape of the argument).
    //
    // Why it pays here: Convex bills a read by the bytes of the WHOLE document,
    // and the two decklists measured 7.33 KB of an 8.3 KB prod `games` row —
    // 88% of it. Almost nothing reads them. `findActiveGameForUser`
    // (`gameLifecycle.ts`) `.collect()`s EVERY waiting/playing row on every
    // create, every join and every `myActiveGame` subscription execution, and
    // uses exactly one field off each: `players[].id`. `getGame` is a live
    // board subscription that re-executes on every patch of the row. Neither
    // needs a card. The seats that DO need the list — game setup, a Tabletop
    // deck snapshot, a debug reset — read it once, by point lookup.
    //
    // The `games` row stays the authority on seat IDENTITY (`id`/`name`/
    // `bgColor`) and deck identity (`deck.id`/`name`/`format`), so a `gameDecks`
    // row is pure payload: it is never consulted to decide who sits where. It
    // is also IMMUTABLE for the Game's life (PRD #387 — sideboarding edits the
    // MATCH copy and the next Game gets a fresh row). `convex/deckStore.ts` is
    // the ONLY module that reads or writes this table.
    gameDecks: defineTable({
        gameId: v.id("games"),
        /** The opaque GRE seat handle — `games.players[].id`, NOT a user id. */
        playerId: v.string(),
        cards: v.array(v.object({ cardId: v.string(), cardName: v.string() })),
    })
        // Both seats of one game (the hydration read); doubles as the point
        // lookup for a single seat with `eq` on both components.
        .index("by_game", ["gameId", "playerId"]),
    // One seat's MUTABLE Match deck copy, split out of
    // `matches.players[].deck` (issue #2506). The `matches` twin of
    // `gameDecks`, and the bigger of the two: the same decklists PLUS the
    // sideboard measured 9.49 KB of a 10.6 KB prod `matches` row — 90%.
    //
    // `findActiveMatchForUser` (`matches.ts`) is the `games` scan's twin and
    // has the identical shape: it `.collect()`s every waiting/pregame/playing/
    // sideboarding row and reads only `players[].id`. On top of that EVERY
    // Match write rewrote the whole 10.6 KB document — a score bump, a ready
    // flag, a status flip — and re-fired every open `getMatch` subscription.
    //
    // Unlike `gameDecks` this row is MUTABLE: sideboarding re-partitions the
    // pool between `maindeck` and `sideboard` (PRD #387 / #395), which is
    // exactly why it must not be re-derived from anywhere. `convex/
    // deckStore.ts` is the ONLY module that reads or writes it.
    matchDecks: defineTable({
        matchId: v.id("matches"),
        /** The opaque GRE seat handle — `matches.players[].id`. */
        playerId: v.string(),
        maindeck: v.array(
            v.object({ cardId: v.string(), cardName: v.string() })
        ),
        sideboard: v.array(
            v.object({ cardId: v.string(), cardName: v.string() })
        ),
    }).index("by_match", ["matchId", "playerId"]),
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
        // FIXTURE handle (issue #2822) — the only way anything addresses ONE
        // specific event without knowing its id. Absent on every event a
        // player creates: it is written exclusively by
        // `convex/limitedFixtures.ts`'s seeder, which the `check:ui` lane's
        // Limited/Draft walks navigate to by label instead of taking "the
        // first row of whatever this account can see". Same shape and same
        // deployment-local tradeoff as a `debugScenarios` label
        // (`seedScenarioDirect`): not captured in git, seeded per deployment,
        // upserted by label.
        label: v.optional(v.string()),
        type: v.union(v.literal("sealed"), v.literal("draft")),
        // Event lifecycle (PRD #1628, ADR 0076 — which reverses ADR 0055
        // decision 1's "the event ends at the built Deck"):
        //   "open"     joining seats, not yet started; no Pools exist.
        //   "started"  every seat is filled (human or bot), Pools are
        //              generated/being drafted, seats build their decks.
        //   "playing"  the play phase: Swiss rounds are running.
        //   "finished" the last round is decided; standings are final.
        // NEVER compare these literals outside `convex/limited/eventStatus.ts`
        // — that module's exhaustive fact table is the single authority on what
        // each phase permits (a raw `!== "started"` silently breaks the moment
        // an event reaches the play phase).
        status: v.union(
            v.literal("open"),
            v.literal("started"),
            v.literal("playing"),
            v.literal("finished")
        ),
        // Match Format of every ROUND match (PRD #1628 stories 1-2), chosen at
        // creation. OPTIONAL only for backward compatibility — events created
        // before the play phase existed carry no value; every reader resolves
        // it through `resolveMatchFormat` (`convex/limited/matchFormat.ts`),
        // which defaults to "bo3", so nothing downstream ever sees `undefined`.
        matchFormat: v.optional(v.union(v.literal("bo1"), v.literal("bo3"))),
        // Optional round deadline in MINUTES (PRD #1628 stories 3-4/32-35).
        // Absent = no deadline: a relaxed table is never cut short by a timer.
        // Stored as the creator's configured duration, not an epoch — each
        // round stamps its own `deadlineAt` from it when it opens.
        roundDeadlineMinutes: v.optional(v.number()),
        // Play phase (PRD #1628, ADR 0076: EMBEDDED in the event document, not
        // in separate `limitedRounds`/`limitedPairings` tables — at most 8
        // seats x 3 rounds = 12 pairings, and the symmetry with the already-
        // embedded `seats` beats the isolation a join would buy). Absent on
        // every event that hasn't reached the play phase.
        //
        // 1-based number of the round currently being played.
        currentRound: v.optional(v.number()),
        // Every round opened so far, including the current one. Pairings are
        // PERSISTED, never derived: Swiss chooses randomly among equal-score
        // seats, so a re-derivation could disagree with what was played.
        // Standings are the opposite — always derived from these results at
        // read time, never stored (PRD #1628 story 47).
        rounds: v.optional(
            v.array(
                v.object({
                    roundNumber: v.number(),
                    startedAt: v.number(),
                    // Epoch ms this round's undecided human pairings are closed
                    // as losses. Absent when the event has no round deadline.
                    deadlineAt: v.optional(v.number()),
                    pairings: v.array(
                        v.object({
                            seatA: v.number(),
                            // Absent = BYE for `seatA`.
                            seatB: v.optional(v.number()),
                            // Only for a pairing involving a human — a
                            // bot-vs-bot pairing is evaluated, not played
                            // (ADR 0076), and a bye has no Match at all.
                            matchId: v.optional(v.id("matches")),
                            // Absent = undecided.
                            result: v.optional(
                                v.object({
                                    winsA: v.number(),
                                    winsB: v.number(),
                                    source: v.union(
                                        v.literal("played"),
                                        v.literal("simulated"),
                                        v.literal("bye"),
                                        v.literal("timeout")
                                    ),
                                })
                            ),
                        })
                    ),
                })
            )
        ),
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
        // Vintage Cube only (ADR 0062): the FROZEN card pool this draft deals
        // from, as canonical Card IDs, snapshotted once at `startEvent` from
        // `buildCubePool()`. Persisted rather than re-derived because the cube
        // is dealt as disjoint slices of ONE seeded shuffle, and only round 0
        // is dealt in `startEvent` — rounds 1+ are dealt in later `submitPick`
        // invocations. Rebuilding the pool from the live card registry per
        // round means implementing a single cube card mid-draft changes
        // `pool.length`, reshuffles the whole permutation, and makes the later
        // rounds' slices overlap the earlier ones (a card already picked
        // reappearing in a later pack). Absent for every non-cube event, and
        // for cube events dealt before this field existed.
        // LEGACY (see the `limitedCubePools` table below, which now holds
        // this): still DECLARED so events started before the split keep
        // validating, and `convex/limitedCubePoolStore.ts` folds an inline
        // copy in when no child row exists. Nothing writes it any more.
        cubePool: v.optional(v.array(v.string())),
        // Bot Drafter scorer version (issue #1613, ADR 0074 replay mode) —
        // `convex/limited/scorerVersion.ts`'s `SCORER_VERSION`, stamped once
        // at `startEvent` alongside `seed`. Lets the Draft Lab replay surface
        // show "drafted under vN, current scorer is vM" beside the
        // historical-vs-recomputed pick diff. Optional so an event created
        // before this field existed still validates; absent === unknown, not
        // "version 0".
        scorerVersion: v.optional(v.number()),
        // Per-pick timer on/off (issue #1114, PRD #1107 story 5/14; ADR 0060
        // / issue #1243 replaced the fixed `timerSeconds` value with this
        // boolean). Configured once at `createLimitedEvent`; absent/false ===
        // disabled (no countdown, no Auto-Pick ever scheduled). When true,
        // each pick's actual countdown length comes from the official
        // descending schedule indexed by cards remaining
        // (`convex/limited/pickTimerSchedule.ts`), never a fixed value. Draft
        // only — a Sealed event has no picks to time.
        timerEnabled: v.optional(v.boolean()),
        // Legacy pre-#1243 field: fixed per-pick countdown, superseded by
        // `timerEnabled` + the descending schedule. Kept only so documents
        // written before the switch still validate; never read.
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
        // Per-seat identity + SMALL mutable state. The heavy card payload
        // (`pool`/`currentPack`/`packQueue`/`poolArrangement`) lives in the
        // `limitedSeats` child table below — see its comment for why. The
        // legacy inline copies of those four fields are still DECLARED here so
        // documents written before the split keep validating; nothing writes
        // them any more, and `convex/limitedSeatStore.ts` is the only reader
        // (it treats an inline copy as an un-migrated row and folds it in).
        seats: v.array(
            v.object({
                seatIndex: v.number(),
                userId: v.optional(v.id("users")),
                nickname: v.optional(v.string()),
                // Bot Drafter placeholder (PRD #1107 story 8), set at
                // `startEvent` for every seat still unclaimed by a human.
                isBot: v.optional(v.boolean()),
                // How many cards are in this seat's Pool — the ONLY pool fact
                // the list queries need (`poolCount` on the wire). Denormalised
                // onto the slim row precisely so listing events never has to
                // read a single `limitedSeats` document. Absent before the
                // event starts (no Pool yet), 0 for a Draft seat that hasn't
                // picked. Written by `limitedSeatStore.ts` alongside every
                // pool write — never by hand.
                poolCount: v.optional(v.number()),
                // LEGACY (pre-split, see the `seats` comment above). Absent on
                // every row written since; kept only so old documents validate.
                pool: v.optional(
                    v.array(
                        v.object({
                            scryfallId: v.string(),
                            cardId: v.string(),
                            cardName: v.string(),
                        })
                    )
                ),
                // LEGACY (pre-split, see the `seats` comment above).
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
                // LEGACY (pre-split, see the `seats` comment above).
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
                // the event has `timerEnabled` unset/false, this is a Bot
                // Drafter seat (bots pick instantly, never idly holding a
                // pack), nothing is currently in front of the seat, or the
                // seat's current pack has only 1 card left ("auto" — see
                // `pickTimerSchedule.ts`). Server-written
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
                // LEGACY (pre-split, see the `seats` comment above).
                poolArrangement: v.optional(
                    v.array(poolArrangementEntryValidator)
                ),
                // Selected Card (ADR 0060, issue #1248): the seat's tentative
                // single-click selection within its OWN `currentPack` — never
                // a commit (that's `submitPick`). `pickId`-keyed, mirroring
                // `DraftPackCard.pickId`, so it always identifies an exact
                // physical booster card, never ambiguous across duplicate
                // prints. Absent = no selection. Server-persisted (not
                // client-local state) so it survives a refresh/device switch
                // and so a future Auto-Pick resolver (issue #1249) can honour
                // it on timer expiry — see `selectDraftPick`
                // (`convex/limitedEvents.ts`).
                // LEGACY (see the `limitedSelections` table below, which now
                // holds this): still DECLARED so seats written before the
                // split keep validating, and `convex/limitedSeatStore.ts`
                // folds an inline copy in when no selection row exists.
                // Nothing writes it any more.
                selectedPickId: v.optional(v.string()),
            })
        ),
        createdAt: v.number(),
        updatedAt: v.number(),
    })
        .index("by_status", ["status"])
        .index("by_createdBy", ["createdBy"])
        // Upsert-by-label for the `check:ui` fixtures (issue #2822). Sparse in
        // practice — only fixture rows carry a `label` at all.
        .index("by_label", ["label"]),
    // One seat's HEAVY card payload, split out of `limitedEvents.seats[]`.
    //
    // Why a child table when ADR 0076 deliberately EMBEDDED `rounds` in the
    // event row: `rounds` is at most 12 tiny pairings, this is up to 8 seats x
    // (a ~45-card Pool + a 15-card pack + a queue of packs) — the seats payload
    // measured 99% of a started event's document, up to 48 KB. Convex bills a
    // read by the bytes of the WHOLE document, so every event row a query
    // touched was billed for card data it did not project: `myLimitedEvents`
    // scans every event the viewer is seated in and needs only seat identity,
    // yet re-read ~315 KB per execution — and it re-runs on EVERY write to any
    // event, i.e. once per draft pick. That single amplification dominated the
    // deployment's database read bytes. Splitting the payload out leaves the
    // event row small enough that listing events is nearly free, and a pick
    // rewrites only the one or two seats it actually touched instead of all 8.
    //
    // The event row stays the authority on seat IDENTITY and small mutable
    // state (`userId`/`isBot`/`selectedPickId`/`pickDeadline`/`pickSeq`), so a
    // `limitedSeats` row is pure payload: it is never consulted to decide who
    // owns a seat. `convex/limitedSeatStore.ts` is the ONLY module that reads
    // or writes this table — every consumer keeps working against the
    // reassembled `LimitedEventSeat[]` the pure `convex/limited/**` modules
    // already expect.
    limitedSeats: defineTable({
        eventId: v.id("limitedEvents"),
        seatIndex: v.number(),
        // Same shapes as the legacy inline fields they replace — see
        // `convex/limited/eventTypes.ts` for the domain doc comments — with
        // the card payload INTERNED (issue #2507): `scryfallId` is the only
        // card identity stored, and `cardId`/`cardName` are resolved back at
        // the seam (`convex/limitedSeatStore.ts`) by the same
        // `convex/limitedCardMeta.ts` lookup that produced them. They were
        // ~3.8 KB of a 6.3 KB average row, on the table `submitPick` reads all
        // 8 seats of per pick.
        //
        // Both derived fields stay DECLARED and optional so rows written
        // before the intern keep validating and keep their own values (the
        // seam prefers a stored one over a fresh resolve). Nothing writes
        // them any more; `limitedEvents:migrateSeatCardPayload` drains the
        // legacy rows, after which a cleanup can drop the fields.
        pool: v.optional(
            v.array(
                v.object({
                    scryfallId: v.string(),
                    cardId: v.optional(v.string()),
                    cardName: v.optional(v.string()),
                })
            )
        ),
        currentPack: v.optional(
            v.array(
                v.object({
                    scryfallId: v.string(),
                    cardId: v.optional(v.string()),
                    cardName: v.optional(v.string()),
                    pickId: v.string(),
                })
            )
        ),
        packQueue: v.optional(
            v.array(
                v.array(
                    v.object({
                        scryfallId: v.string(),
                        cardId: v.optional(v.string()),
                        cardName: v.optional(v.string()),
                        pickId: v.string(),
                    })
                )
            )
        ),
        poolArrangement: v.optional(v.array(poolArrangementEntryValidator)),
    })
        // Every seat of one event, in seat order — the hydration read.
        // Doubles as the point lookup for a single seat (`eq` on both
        // components), which is what the draft/deckbuild write path uses.
        .index("by_event", ["eventId", "seatIndex"]),
    // One seat's Selected Card (ADR 0060, issue #1248) — the tentative,
    // never-committed single click inside its own booster — split out of
    // `limitedEvents.seats[].selectedPickId`.
    //
    // It was the smallest field on the event row and the most expensive one to
    // keep there: a click fired `selectDraftPick`, which rewrote the WHOLE
    // event document, which in turn re-executed EVERY open `getLimitedEvent`
    // subscription on the table — and a selection is the one piece of draft
    // state that is strictly private to its own seat (`projectLimitedEvent`
    // nulls it for every non-viewer). Eight seats clicking around a booster
    // were invalidating each other's board for state none of them could see.
    // It also put every click in write contention with every pick on one
    // document, which is what the deployment's OCC-retry warnings were.
    //
    // Absent row = no selection; clearing one deletes it. Written ONLY by
    // `selectDraftPick`; never cleared on a pick, because the engine
    // re-validates a selection against the LIVE `currentPack` and treats a
    // stale one as no selection at all (`resolveAutoPickTimeout`,
    // `convex/limited/draftEngine.ts`). `convex/limitedSeatStore.ts` is the
    // only module that reads it, folding it back into the reassembled
    // `LimitedEventSeat[]` every consumer already expects.
    limitedSelections: defineTable({
        eventId: v.id("limitedEvents"),
        seatIndex: v.number(),
        // `pickId`-keyed, mirroring `DraftPackCard.pickId`, so it always names
        // an exact physical booster card and never a duplicate print.
        pickId: v.string(),
    })
        // Point lookup on both components — the narrowed read path (the
        // viewer's own seat) MUST stay a single-key read, or every seat's
        // subscription would depend on every other seat's selection row and
        // the split would buy nothing.
        .index("by_event", ["eventId", "seatIndex"]),
    // A cube Draft's FROZEN card pool (ADR 0062), split out of
    // `limitedEvents.cubePool` for the same reason `limitedSeats` was split
    // out of `limitedEvents.seats[]`: Convex bills a read by the bytes of the
    // WHOLE document, and this array measured 11.71 KB of a 16.0 KB prod event
    // row — 73% of it.
    //
    // The asymmetry that makes the split pay: the pool is consumed ONLY when a
    // booster round is dealt (`generateCubeRoundPacks`, `draftEngine.ts`),
    // which happens `packSlots.length` times in a whole draft — while the
    // event row is re-read by every pick, every card click, every arrangement
    // drag, and by every open `getLimitedEvent` subscription each time any of
    // those writes it. Seven prod functions were paying for the pool; three
    // deals per draft actually needed it.
    //
    // One row per cube event, written once at `startLimitedEvent` and never
    // mutated — the freeze is the whole point (a pool re-derived per round
    // from the live registry re-deals cards an earlier round already dealt the
    // moment a cube card is implemented mid-draft). `convex/
    // limitedCubePoolStore.ts` is the ONLY module that reads or writes it.
    limitedCubePools: defineTable({
        eventId: v.id("limitedEvents"),
        // Canonical Card IDs, in `buildCubePool()` order — the exact array
        // that used to live on the event row.
        pool: v.array(v.string()),
    }).index("by_event", ["eventId"]),
    // Bot Drafter Pick Ratings (PRD #1296, ADR 0065, issue #1297). Evolves
    // the checked-in `data/pick-ratings/*.json` seed layer
    // (`convex/limited/pickRatings.ts`, issue #1117) into an Admin-editable
    // DATABASE override — mirrors ADR 0033's "Preset Decks → DB,
    // Admin-editable" move. One row per `(scope, cardId)`: `scope` is a
    // lowercased pack-source identity — a Draftable Set code (e.g. `"lea"`)
    // or the reserved Vintage Cube key (`convex/limited/cube.ts`'s
    // `CUBE_SOURCE_KEY`, `"vintage-cube"`) — the SAME string space as
    // `limitedEvents.packSlots`, so the layered read path
    // (`convex/limited/cardRatings.ts`'s `resolveEventPickRating`) never
    // needs a cube-specific branch. `cardId` is the canonical
    // `CardDefinition.id` (NOT a printing's `scryfallId`), matching
    // `PickRatingFile.ratings`'s key discipline. `rating` is
    // `PICK_RATING_MIN`..`PICK_RATING_MAX` (0-5, fractional allowed,
    // `pickRatings.ts`'s `isValidRating`). A database row for `(scope,
    // cardId)` OVERRIDES that pair's seed-file value; an empty table drafts
    // byte-identically to the seed-only path (this issue's regression
    // acceptance). Admin write mutations (`setCardRating`/`clearCardRating`,
    // PRD #1296 Slice B, issue #1298) live in
    // `convex/limited/cardRatings.ts` alongside the read-path core.
    cardRatings: defineTable({
        scope: v.string(),
        cardId: v.string(),
        // Bound enforced at the WRITE boundary, not the schema type: the
        // `setCardRating` mutation (`convex/limited/cardRatings.ts`) rejects
        // a non-finite or out-of-`[PICK_RATING_MIN, PICK_RATING_MAX]` value
        // via the shared `isValidRating` (`pickRatings.ts`) before ever
        // inserting/patching a row — mirrors how `PickRatingFile.ratings`'
        // bounds are enforced by `validatePickRatingFile`, not by a
        // schema-level range on JSON.
        rating: v.number(),
    })
        // Every rating for one scope — the shape the read path loads once
        // per distinct event scope (`resolveEventPickRating`'s caller).
        .index("by_scope", ["scope"])
        // Point lookup / upsert target for the Admin write mutations
        // (`setCardRating`/`clearCardRating`) — `(scope, cardId)` is this
        // table's natural primary key.
        .index("by_scope_and_card", ["scope", "cardId"]),
    // Bot Drafter Card Profiles (ADR 0072 "Card synergy as computed
    // Capability matching, not enumerated card pairs", PRD #1607 slice 1,
    // issue #1608). A STRUCTURAL CLONE of `cardRatings` above — same
    // `(scope, cardId)` key, same Pack Source scope string space (a
    // Draftable Set code or `CUBE_SOURCE_KEY`), same `by_scope`/index
    // shape — carrying ADR 0072's synergy model instead of a 0-5 rating:
    // which Archetype(s) a card steers toward (`reanimator`, `artifacts`,
    // `jeskai-tempo`), which Capabilities it PROVIDES/REQUIRES from the
    // closed `capabilityRegistry.ts` vocabulary, and optional signed Combo
    // Edge weights to specific partner cards. Layered over an optional
    // checked-in seed file by the pure read seam
    // `convex/limited/cardProfiles.ts`'s `resolveEventCardProfile` —
    // mirrors `cardRatings.ts`'s `resolveEventPickRating` exactly. THIS
    // SLICE IS A DATA FOUNDATION ONLY: no call site reads this table yet
    // (`convex/limited/botDrafter.ts` is unchanged) and no Admin write
    // mutation exists here either — both are later PRD #1607 slices.
    cardProfiles: defineTable({
        scope: v.string(),
        cardId: v.string(),
        // Free-text named strategies (ADR 0072) — deliberately NOT gated by
        // a closed registry the way `provides`/`requires` are; see
        // `CardProfile`'s doc comment in `cardProfiles.ts`.
        archetypes: v.array(v.string()),
        // Capability ids this card PROVIDES/REQUIRES — each string MUST be
        // a row of `CAPABILITY_REGISTRY` (`capabilityRegistry.ts`), checked
        // by `cardProfiles.ts`'s `validateCardProfileFile` for the seed
        // layer (the database layer gets the same check once an Admin
        // write mutation exists, mirroring `setCardRating`'s
        // `isValidRating` gate).
        provides: v.array(v.string()),
        requires: v.array(v.string()),
        // The Combo Edge escape hatch (ADR 0072): an explicit, signed,
        // directed pair reserved for a closed two-card loop no Capability
        // vocabulary can express (Painter's Servant + Grindstone).
        // OPTIONAL — most cards carry none.
        comboEdges: v.optional(
            v.array(v.object({ cardId: v.string(), weight: v.number() }))
        ),
        // LLM-seeded rows start `false`; a human reviewer flips it to
        // `true`. Load-bearing for a LATER slice's scoring (ADR 0072: an
        // unreviewed row's contribution is applied at HALF the contextual
        // cap) — this slice only carries the field, it does not consume it.
        reviewed: v.boolean(),
    })
        // Every profile for one scope — the shape the read path loads once
        // per distinct event scope (`resolveEventCardProfile`'s caller),
        // mirroring `cardRatings`'s `by_scope`.
        .index("by_scope", ["scope"])
        // Point lookup target for the (future) Admin write mutations and
        // for `resolveEventCardProfile`'s per-card DB read closure —
        // `(scope, cardId)` is this table's natural primary key, mirroring
        // `cardRatings`'s `by_scope_and_card`.
        .index("by_scope_card", ["scope", "cardId"]),
    // Bug reports filed from the in-app button. The GitHub issue is the WORK
    // ITEM; this row is the EVIDENCE, and the two are split on exactly one
    // line: the tracker repo is PUBLIC, so anything that identifies the
    // reporter or exposes hidden game information lives here and never crosses
    // into the issue body. Email (contacting the reporter), the full game
    // state (both players' hands and libraries, often mid-game) and the
    // attachment all stay server-side; the issue carries the description, the
    // non-sensitive board context and this row's id.
    bugReports: defineTable({
        // Who filed it, resolved server-side from the caller's identity — the
        // client-supplied name/email are display values and are NOT trusted to
        // identify the account.
        userId: v.id("users"),
        name: v.string(),
        // Contact address. The single reason this table exists rather than the
        // report living wholly in the issue.
        email: v.string(),
        description: v.string(),
        route: v.optional(v.string()),
        userAgent: v.optional(v.string()),
        attachmentId: v.optional(v.id("_storage")),
        attachmentName: v.optional(v.string()),
        // Board context, present only for a report filed from a game the
        // reporter is actually seated in. `state` is the EXPANDED `GameState`
        // (`v.any()`, mirroring `gameStates.state`): a frozen copy, not a
        // reference — the live row is patched in place on every action and
        // would no longer show what the reporter was looking at.
        gameId: v.optional(v.id("games")),
        seq: v.optional(v.number()),
        state: v.optional(v.any()),
        // Client-side AI diagnostics captured at filing time (issue #2470).
        // The play bot is client-hosted (ADR 0074), so the ONLY record of why
        // one of its decisions failed lives in the reporter's own tab and dies
        // with it: #2450 could not be root-caused because a bot that failed
        // every consult and a bot that chose to pass produce the same board.
        // `v.any()` for the same reason `state` is — a frozen diagnostic copy,
        // read by a human, must not go unwritable because its shape moved on.
        clientDiagnostics: v.optional(v.any()),
        // Back-reference to the filed issue, patched in after the GitHub POST
        // succeeds. Absent when the POST failed — the row is written FIRST so
        // a GitHub outage loses the issue, never the report.
        issueNumber: v.optional(v.number()),
        issueUrl: v.optional(v.string()),
    }).index("by_issueNumber", ["issueNumber"]),

    debugScenarios: defineTable({
        // Authorship provenance for interactively-saved rows only (set by
        // `saveDebugScenario` from the current admin). OPTIONAL because scenarios
        // are a SHARED admin tool — `listDebugScenarios` shows every row to every
        // admin regardless of owner — so the golden rows are ownerless: they are
        // seeded/written directly to the DB, belonging to the pool rather than to
        // whichever admin happened to write them.
        userId: v.optional(v.id("users")),
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
    // Per-user Settings (issue #2595, PRD #2405 slice 16/16, ADR 0101). The
    // v3 tokens (density/motion) and the phase-stop store were device-local
    // (`localStorage` / CSS attribute default) until this table; unlike the
    // deck-view prefs the `userDecks` comment above deliberately keeps
    // client-side (grouping/ordering/zoom — genuinely per-DEVICE, follow
    // nothing), these are per-USER preferences meant to follow the account
    // across devices, so they get a real table rather than another
    // `localStorage` key. One row per user (`by_user` unique in practice —
    // `getUserSettings`/`updateUserSettings` upsert against it, never insert
    // a second row). Every field optional: an absent field means "no
    // preference set yet", and the client applies the same default it always
    // hard-coded (`roomy` / `system` / `computed`) — no migration, no crash,
    // no flash of the wrong density on a user who predates this table.
    userSettings: defineTable({
        userId: v.id("users"),
        density: v.optional(
            v.union(
                v.literal("compact"),
                v.literal("comfortable"),
                v.literal("roomy")
            )
        ),
        motion: v.optional(v.union(v.literal("system"), v.literal("reduced"))),
        // Oracle/Printed default for `CardPreviewBody` (issue #2595). Manual
        // Game forces `"printed"` and hides the toggle regardless of this
        // value — unrelated to the user's general preference.
        previewPreference: v.optional(
            v.union(v.literal("computed"), v.literal("printed"))
        ),
    }).index("by_user", ["userId"]),
});
