# Banlists become DB-backed, name-keyed, Scryfall-synced

## Status

accepted

## Context

ADR 0036 made a deliberate call: "Everything is code-side; no format data in
the DB. … A banlist or ruleset change is a code release." At the time this
was accepted because the affected cards had to be implemented in code anyway,
so the code-side `Set<CardId>` constants (`PREMODERN_BANNED`,
`OLD_SCHOOL_BANNED`, `OLD_SCHOOL_RESTRICTED` in `convex/formats.ts`) were
"silently the intersection with the implemented pool" — a known, accepted
consequence at the time.

In practice this intersection is now the problem, not an acceptable
approximation:

- The lists are keyed by canonical `CardDefinition.id`, so a card that is
  officially banned but not yet built in the engine — e.g. **Parallax Tide**
  in Premodern — simply never appears. The banlist a player sees is not the
  real banlist; it's "banned cards we happened to implement."
- There is no visible, authoritative list to consult in the deck builder at
  all — only the pass/fail reason on an individual illegal card.
- Keeping a list current means hand-editing UUID arrays in source and
  shipping a code release every time the officially-updated list moves —
  pure toil, easy to forget, and undiscoverable without reading the diff.
- **Silent-legal window**: when a previously-unbuilt banned card is later
  implemented, it is playable the instant it ships, until someone
  separately remembers to add its id to the code list and redeploy. The
  card's ban and its implementation are two unrelated events that must be
  manually kept in sync.

Premodern and Old School are both real, externally-defined banlists (Wizards
official list; Eternal Central for Old School) that already exist in a
canonical, machine-readable form on Scryfall (`banned:premodern`,
`banned:oldschool`, `restricted:oldschool`). Alpha 40, by contrast, has no
Scryfall-legality equivalent — it's a bespoke ruleset (rarity-tiered copy
caps, a Moderated override, five overlapping category budgets) that
references implemented cards and set modules directly; there is nothing to
sync it against.

## Decision

**Reverse the "banlist is code" clause of ADR 0036 for Premodern and Old
School only.** Banlists for these two formats become data: DB-backed,
name-keyed, resolved to `CardDefinition.id` live at read time, sourced from
Scryfall via an admin-triggered manual sync. Alpha 40 and Freeform are
explicitly **not** touched by this reversal — see Scope below.

**New table, keyed by oracle name, not id.** `formatBanlists` stores
`{ format, cardName, status: "banned" | "restricted", source, syncedAt }`,
indexed by format. Names are the full official list — including cards with
no `CardDefinition` yet (Parallax Tide is a real `banned` row in Premodern
even though nothing resolves it today). This is the structural fix for the
intersection problem: the stored list is the real list, not the pool
intersection.

**No stored `cardId` — resolution is always live.** A pure helper
(`resolveBanlistEnforcement(entries, resolve) → { banned, restricted }`)
maps each name to a `CardDefinition.id` via the existing `nameRegistry`
(`convex/cards/index.ts`) at every read, dropping names with no built card
from the *enforcement* sets while keeping them in the *display* list. This
is a deliberate design choice, not an oversight: if the id were captured and
cached at sync time, a card built after the last sync would stay silently
legal until the next manual sync — exactly the window this ADR exists to
close. Because resolution is live, a newly-implemented card that is already
on the stored name list is banned the instant its `CardDefinition` ships,
with no additional action.

**Enforcement stays pure (ADR 0036's purity is preserved, not reversed).**
`validateDeck` / `assertDeckLegal` gain an optional injected
`banlist: { banned, restricted }` of cardIds, exactly like the existing
`resolve` dependency. Server gates (`game.ts`, `decks.ts`) and the client
builder panel load and inject it; when it is absent (fresh deploy, no sync
yet, or a test that doesn't care), each validator falls back to today's code
const (`banlist?.banned ?? PREMODERN_BANNED`, etc.). The functions remain
pure — only their caller's data source moves.

**Admin-only, manual sync — no cron.** A `syncBanlist({ format })` action
fetches the relevant Scryfall search(es) (`banned:premodern`; for Old School,
both `banned:oldschool` and `restricted:oldschool`), parses and dedupes by
name, and atomically replaces that format's rows via an internal mutation
(delete + insert in one mutation), reporting an added/removed diff and a
`syncedAt` timestamp. Gated the same way as other admin actions
(`assertIsAdmin`, mirroring ADR 0033's preset-deck admin gate). A fetch or
parse failure aborts before touching existing rows — a bad sync degrades to
"stale," never to "empty."

**Full list surfaced to every player.** The deck builder's legality area
shows the complete stored banlist (built or not) via a read-only query, so
the list a player sees finally matches the real one — not just the subset
that happens to be implemented.

## Scope

This reversal applies **only to Premodern and Old School banned/restricted
lists**. It explicitly does not extend to:

- **Alpha 40** — stays fully code-managed. Its ruleset (rarity caps,
  Moderated override, category budgets) has no Scryfall-legality equivalent
  to sync against, and every entry already references code (implemented
  cards, set modules). ADR 0036's original reasoning ("the affected cards
  must be implemented in code anyway") still holds for it undiluted.
- **Freeform** — has no constraints; nothing to move.
- **Premodern's restricted list** — Premodern has no official restricted
  list; only its banned list is DB-backed.
- Any other format-level rule (set legality, min/max deck size, category
  budgets) — those remain the code-side `FormatMeta` shape from ADR 0036,
  untouched.

## Considered Options

- **Keep banlists fully code-side (status quo / re-affirm ADR 0036)** —
  rejected: this is precisely the toil and staleness this ADR exists to fix;
  the pool-intersection behavior actively misrepresents the real banlist to
  players.
- **Store the resolved `cardId` in the DB row instead of the name** —
  rejected: this reopens the silent-legal window this ADR is meant to close.
  A card built after a sync would sit un-enforced until the next manual
  sync, and a card removed from the pool (unlikely but possible) would leave
  a dangling id. Storing the name and resolving live keeps enforcement
  synchronized with the pool automatically.
- **Automatic/scheduled sync (a cron)** — rejected for this slice: adds a
  scheduled dependency and a "what if Scryfall is down at 3am" failure mode
  for a policy that changes at most a few times a year. An admin-triggered
  manual button with a visible last-synced timestamp is enough signal for
  the maintainer to notice staleness and re-run it.
- **Extend the DB-backed treatment to Alpha 40** — rejected: Alpha 40 has no
  Scryfall legality format to sync against (rarity caps and category budgets
  aren't expressible as a Scryfall search), and its rules already reference
  code (set modules, implemented cards) directly. There is nothing here to
  move to data.
- **Versioned sync history / rollback** — deferred: a single "last synced"
  timestamp plus an added/removed summary is enough for the current
  single-admin workflow; per-sync audit history is unneeded complexity for
  now.

## Consequences

- The Premodern and Old School banlists now reflect the true official list,
  including cards not yet implemented — the pool-intersection defect from
  ADR 0036 is fixed for these two formats.
- A banned/restricted card is enforced the instant it is both on the synced
  list and implemented, with no separate "add its id to the code list" step
  — the silent-legal window is closed by construction (live name resolution,
  never a stored id).
- Keeping these two formats current is now an admin button click against
  Scryfall, not a code change and redeploy — but it also means the banlist
  can now go stale silently between syncs if nobody clicks it; the
  `syncedAt` timestamp is the only staleness signal (no cron nags the
  admin).
- The code-side constants (`PREMODERN_BANNED`, `OLD_SCHOOL_BANNED`,
  `OLD_SCHOOL_RESTRICTED`) are not deleted — they are demoted to
  seed/fallback, used only when the DB has no rows for a format, so a fresh
  deploy and existing tests keep working unchanged before the first sync.
- Alpha 40 keeps ADR 0036's original code-side reasoning verbatim; readers of
  that ADR should treat its banlist clause as superseded **only** insofar as
  it applied to Premodern/Old School, not as fully retired.
- A Scryfall outage or malformed response must not be allowed to wipe an
  existing list; `syncBanlist` computing and applying its diff atomically
  (delete+insert in one mutation, only after a successful parse) is now a
  correctness requirement for this table, not just a nicety.
