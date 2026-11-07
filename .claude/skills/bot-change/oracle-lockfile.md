# Oracle lockfile — a bare compile never replays for your Bot

Read when a Bot change touches card verdicts in the Oracle lockfile (a blade
`moves` entry, a refit, a card whose `frozen` status should flip).

A bare `bun run oracle:compile` plays only the cards it graduates to
`ready` and carries drift verdicts `botStale` for the base to replay
(issue #6688), header on the committed Bot hash. The whole replay under your Bot
(`--replay-bot`, 20–47 min) runs ONCE on the base after your PR merges
(`derive:sync --replay-bot`, the `bot-replay` job): no card left `ready` →
swept lockfile pushed; a card your change froze → a `bug` (`area:game-bot`)
naming it and your commit range, never a silent lockfile write.

Need FRESH verdicts for a few cards (the ones a blade entry or a refit is
about, or whose `frozen` status the change should flip)?
`bun run oracle:compile --carry-bot --replay-card "<name>"` (repeatable,
issue #4957): every other verdict is carried, only the named cards are
played, and the header Bot hash stays the committed one. An unknown name, or
a card that does not compile `ready`, exits non-zero and writes nothing.
