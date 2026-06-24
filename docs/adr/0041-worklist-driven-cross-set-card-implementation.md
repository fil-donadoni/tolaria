# Worklist-driven cross-set card implementation

## Status

accepted

## Context

Until now every card batch has been organized **one set at a time**: pick a set
(ARN, LEG, DRK, FEM…), download its MTGJSON blob with `scripts/json-to-cards.mjs`,
and implement it to a chosen depth before moving on. The set is both the
_selection unit_ (which cards to build next) and the _organizing unit_ (the
home-set file the cards live in).

We want to keep the organizing unit but **change the selection strategy**: build
cards chosen by a cross-set logic — "the current Vintage Cube", "premodern
staples" — rather than completing a single set. A cross-set list scatters across
~40 real sets (Swords to Plowshares → LEA, Wasteland → TMP, Toxic Deluge →
Commander 2014), most of which we have no local MTGJSON file for and would never
fully implement.

This forces several decisions at once: where the cards physically live, what
data source feeds them, how the per-set MTGJSON id-guard survives without local
set blobs, and how a thematically-incoherent power pile gets clustered into
shippable work.

## Decision

**A worklist is a selection strategy, not a data-model entity.** A "Vintage Cube"
list is a curated TODO that decides _which cards to build next_. It never becomes
a schema table, a `cube.ts` module, or a player-facing entity. Each card still
files under its **real home set**; `setCode` stays equal to the real set; prints,
pool availability, and `isPrintedInSet` are untouched. The cube exists only as a
committed worklist file plus a PRD/issues — never as a code entity.

**Home set = earliest paper printing.** "First print" is resolved deterministically
as Scryfall's `game:paper unique:prints order:released dir:asc`, first row —
excluding digital-only, gold-border, oversized, and non-tournament printings.
Whatever set that is (expansion, core, _or_ supplemental) becomes the home-set
file and supplies the `scryfallId` for art. Home-set files are created lazily, so
a 540-card cube can spin up dozens of **sparse** set files (a handful of cards
each). That is accepted: the registry just imports them; sparse files are
self-organizing and cheaper than misattributing a card to a "cleaner" later set.

**Two source adapters, one lockfile, one emitter.** Card data comes from whichever
upstream fits the job, behind a common output:

- **Set mode** — MTGJSON whole-set blob (`json-to-cards.mjs`), best for "implement
  set X" (1 download beats ~350 single calls).
- **List mode** — Scryfall per card for a curated cross-set list (`POST
/cards/collection`, 75 ids/call → ~8 calls for a 540-card cube). Scryfall is the
  upstream MTGJSON copies `scryfallId` from and carries everything implementation
  needs (oracle text, cost, type, P/T, loyalty, keywords, `id`=scryfallId,
  `oracle_id`); single-card fetch and always-current data make it the right tool
  for lists.

Both write the same committed lockfile `data/card-index.json`
(`{ name, scryfallId, oracleId, firstSet }` per card) and emit stubs into the
right home-set files. The lockfile is the **central index of all implemented
cards**, backfilled once for the existing catalogue (since `CardDefinition.id` is
the scryfallId, not the oracleId).

**The lockfile replaces per-set MTGJSON as the id-guard source.** The old guards
(`check-scryfall-ids.mjs`, `card-id-scryfall.test.ts`) read `data/json/<SET>.json`
with a hardcoded set list — unworkable for cards from undownloaded sets. They are
generalized to validate every card `id` against `data/card-index.json`. Tests stay
offline and deterministic; no 500MB AllPrintings blob, no live API in CI, no
hardcoded set list to maintain. MTGJSON's only load-bearing role (an offline file
the guard reads) is taken over by the committed lockfile.

**Dedup by `oracleId`.** A worklist overlaps heavily with the existing catalogue
(cube has many Alpha cards already in `lea.ts`). The tool resolves each name →
`oracleId`, diffs against the lockfile, and emits only the missing — robust to
reprints, alt-names, and split/adventure name quirks that a name-match breaks.

**Worklists are committed static files.** `data/worklists/<slug>.txt`, one card name
per line (`#` comments allowed), seeded once from CubeCobra and committed. A
worklist is itself a reviewable, hand-editable, reproducible artifact — no live
CubeCobra dependency that rots or makes runs non-deterministic.

**Clustering is by engine-capability gap, agent-driven over a mechanical pre-split.**
A cube has no thematic factions to cluster on, so the axis is _shared missing
capability_. The tool does only a **mechanical pre-split**: vanilla detection
(empty oracle text + creature/land), known-keyword match against `combatRegistry`
and supported `staticAbilities`. Everything else is `needs-triage`, and an **agent**
reads it and assigns capability clusters (no machine-readable capability registry
exists to diff against, so semantic judgment is required). Output per worklist is
**four buckets**:

- **done** — already implemented (oracleId hit).
- **free** — emitted as **active, complete `CardDefinition`s** (vanilla/keyword-only,
  or unique `resolve()` composing existing primitives — no _new_ capability). Shipped
  as slice 1 in one PR.
- **capability cluster** — emitted as **commented-out stubs** (id/name/cost/types/P/T
  filled, body TODO; build stays green). One `ready-for-agent` issue + PR per cluster:
  build the missing capability once, then uncomment every card it unlocks. Prioritized
  by _(cards unlocked ÷ build effort)_.
- **out-of-scope** — cards whose **layout** isn't modeled (transform/MDFC/split/
  adventure/meld/flip) or otherwise deferred. No stub; listed in the coverage report
  with a reason; one **`ready-for-human`** issue per layout (schema-level work).

## Consequences

- A 540-card cube produces many **sparse home-set files** and matching registry
  imports. Accepted as self-organizing; the alternative (misattributing cards to a
  later "cleaner" set) breaks "prima stampa" and picks the wrong art.
- "Free" means _no new engine capability_, **not** zero-code: many free-tranche cards
  still need a small bespoke `resolve()`. The free tranche is large but not free to
  type.
- Finishing the current Vintage Cube front-loads the highest-frequency mechanics. As a
  _count of distinct mechanics_ that is ~40-50% (the long tail of niche set mechanics
  remains); **frequency-weighted, ~65-75% of an arbitrary new constructed-playable card
  becomes near-free** thereafter. Biggest remaining buckets: planeswalkers, the modeled
  layouts above, and rare set mechanics.
- The lockfile becomes a load-bearing committed artifact: forgetting to refresh it on
  import breaks the id-guard. That is the intended failure mode (loud, in CI) rather
  than silent art breakage.
