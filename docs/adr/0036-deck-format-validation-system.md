# Deck Format validation system

## Status

accepted

## Context

Decks carry a free-form `format` string that always reads `"Freeform"` — never validated, never selected in the UI, never enforced. We want real constructed **Formats**: deck-construction constraints chosen up front and validated, so a deck can be marked legal/illegal and the legal ones gated into play.

Three formats are in scope:

- **Freeform** — no constraints (today's behaviour).
- **Alpha 40** — Alpha/Beta cards only, ≥40 maindeck, no sideboard.
- **Old School (93/94)** — Alpha, Beta, Arabian Nights, Antiquities, Legends, The Dark; ≥60 maindeck, ≤15 sideboard.

Two problems make this more than a size check:

1. **The two non-trivial formats have incompatible legality shapes.** Old School is the familiar 4-copy limit plus a one-copy **Restricted** list and a zero-copy **Banned** list. Alpha 40 is a bespoke system: per-card copy caps **by rarity** (commons unlimited, uncommons ≤6, rares ≤3), a **Moderated** override (specific commons capped at 3), and five **Category Budgets** (Fast Mana, Power, Draw, Destruction, Charm) each allowing _one card from the whole list_, with overlap (Ancestral Recall counts against both Power and Draw). A single flat rule record cannot express both.

2. **Old School has no single official banlist.** Eternal Central (EC), Swedish (n00bcon), and Italian rulesets diverge. We must pick one.

A third issue surfaced during design: Alpha 40's rarity caps require per-card **Rarity**, which the model does not carry (`CardDefinition`/`CardPrint` have no rarity; it exists only in the raw MTGJSON under `data/json/`).

## Decision

**A single code-side registry, one bespoke validator per format.** `convex/formats.ts` exports `FORMAT_RULES: Record<FormatId, FormatMeta>` where `FormatId = "freeform" | "alpha-40" | "old-school"`. Each `FormatMeta` carries shared metadata (`label`, `allowedSets`, `minMain`, `maxSide`) plus a per-format `validate(deck, resolve): Reason[]`. Shared helpers (`checkSize`, `checkSets`, `countByCardId`) compose into each validator; the bespoke parts (Old School restricted/banned, Alpha 40 rarity/Moderated/category budgets) live in their own validator. The legality lists are `Set<CardId>` constants in the same module — a card not yet implemented simply never appears, so the lists are implicitly the intersection of the official policy with the implemented pool.

**Everything is code-side; no format data in the DB.** The only format datum on a row is the `format` string, now typed as a `v.union` of the three literals. A banlist or ruleset change is a code release. This is acceptable because restricted/banned/category cards must be implemented in code anyway, and `allowedSets` references the set modules.

**Legality is derived, never stored.** `validateDeck(deck, formatId)` is a pure function imported by both the server (authoritative gate at game start; legality on the lobby deck list) and the client (live validation panel in the builder). It lives in `convex/formats.ts`, importable from the frontend like `convex/cards/index.ts` — it is not a `convex/gre/` module, so it does not cross the engine boundary. A ruleset deploy reclassifies every deck automatically with no migration.

**Save-always, gate-at-play.** The debounced auto-save never blocks on legality — an in-progress deck is a legal draft to persist. An illegal deck is listed but disabled for play, with its `reasons` shown. The authoritative check is server-side at game start.

**Format is chosen at creation and immutable.** The create flow has a required format select; edit shows it read-only. Changing format would mass-invalidate a deck, so cross-format reuse goes through a new **Export** (deck → MTGA/Scryfall text, by card name, symmetric with the existing importer) → create a new deck in the target format → **Import**. Match play is **not** format-gated for now: any legal deck may face any other.

**Old School ruleset: Eternal Central + the Swedish dexterity ban.** Restricted list per EC; Chaos Orb and Falling Star banned (Swedish), which is moot in practice — both are manual-dexterity cards (CR 712), unimplementable, and already out of scope. The banned list is a documentation guard, not an active filter.

**Rarity is added to the model.** `rarity: "common" | "uncommon" | "rare"` is added to `CardPrint` (per printing) and the home-set `CardDefinition`, backfilled one-shot from MTGJSON via `scripts/json-to-cards.mjs` and required on all future cards. Basic lands are exempt from every copy/rarity cap and are always set-legal (identified by the `Basic` supertype).

**Presets are wiped, not migrated.** Existing `presetDecks` rows are deleted (admin recreates them with proper formats); the in-code seed is emptied so they do not reappear. Existing `userDecks` migrate their `"Freeform"` string to `"freeform"`.

## Considered Options

- **Flat uniform `FormatRule` data record** (`copyLimit`, `restricted[]`, `banned[]`) — rejected: cannot express Alpha 40's rarity tiers, Moderated override, and one-from-the-list category budgets with overlap.
- **Format rules in the DB with an admin editing UI** (mirroring ADR 0033 for presets) — rejected: the rules reference implemented cards and set modules, which are code anyway; rulesets change ~yearly, so the admin surface and a drift guard are not worth it.
- **Storing `isLegal` on the deck row** — rejected: it is a pure function of code + contents and would go stale the moment a card lands or a banlist deploys.
- **Hard-blocking illegal saves** — rejected: the auto-saving builder must persist in-progress (and thus illegal) drafts.
- **Mutable format / format-gated matches** — deferred: both add revalidation and lobby-negotiation complexity for no current need; export-and-reimport covers cross-format reuse.
- **Swedish or Italian ruleset for Old School** — rejected as the base: EC is the most documented and widely used online; we borrow only Swedish's dexterity ban.

## Consequences

- A banlist/ruleset change requires a code deploy. Accepted: the affected cards are code anyway.
- `CardPrint`/`CardDefinition` gain a `rarity` field and the generator a backfill pass; every future card must declare rarity.
- The legality lists are silently the intersection with the implemented pool — an official restricted card that isn't built yet is a no-op until it ships, and adding it later tightens existing decks retroactively (correctly, via derivation).
- Cross-format matches are allowed; the lobby format select is a navigation filter (`All` + the three formats, default `All`, persisted client-side), not a match constraint.
- Manual-dexterity and ante cards stay out of scope; their banned-list entries are guards, consistent with ADR 0010.
