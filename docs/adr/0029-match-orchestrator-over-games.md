# Match as a thin orchestrator over Games (best-of-N)

To support best-of-3 play (and sideboarding), we introduce a **Match** as a first-class entity that owns a sequence of **Games**, rather than overloading the existing per-game row. A `matches` table records the best-of-N format, the running game score, each player's match-scoped deck (maindeck + sideboard), the between-games sideboarding ready state, and the play/draw chooser. Each Game keeps being the unit the GRE knows (its own `games` row + `game_states` stream), now tagged with `matchId` + `gameNumber`. Bo1 is simply a Match with `bestOf: 1` — there is no separate single-game code path.

## Status

accepted

## Decision

- **`matches` owns the cross-game state**; a Game stays a standalone GRE contest. The GRE and `game.ts` are almost unchanged — new logic lives in match-level transitions (score update, sideboarding gate, next-game build, match-over routing).
- **Every Game belongs to exactly one Match.** New `games` row per game (`matchId`, `gameNumber` 1..3), each with its own `game_states` seq stream — per-game history is preserved.
- **The Match holds the mutable deck copy** (snapshotted at match creation, main + side). Sideboarding mutates the match copy only; saved `userDecks` are read-only during a match. Each Game's library is built from the match copy's current maindeck.
- **Game-over is interstitial in Bo3**, terminal only when the match is decided (first to 2). Bo1 collapses game-over directly to match-over.
- **Concede splits into two actions**: `concede` loses the current Game (match continues to sideboarding); `forfeitMatch` loses the whole Match (CR 104.3a vs drop).
- **Single-active-game guard (#155) becomes single-active-match.**

## Considered Options

- **Extend the `games` row** with `matchId`/`gameNumber`/`bestOf` and no new table. Rejected: the score, the sideboard step, and the play/draw chooser have no natural home and would smear across game rows; "is this game over" and "is the match over" collapse into one overloaded check.
- **Wrap only Bo3 in a match, leave Bo1 bare.** Rejected: two permanent code paths for the same concept.

## Consequences

- Glossary inverts: per CR/tournament terms, **Match** = best-of-N set of **Games** (CONTEXT.md updated; the old _Avoid: Match_ is dropped).
- Cleanup cron deletes by finished Match (cascading its Games + game_states).
- AI sideboarding is deferred: the bot auto-readies with no swaps for now (real bot sideboard logic is future work).
