# 0056 — Boosters from MTGJSON print sheets, draftability gated on complete sets

## Status

Accepted

## Context

Generating a Booster requires knowing a set's real pack structure and print
distribution. MTGJSON publishes per-set booster configs (slots + weighted print
sheets), including the quirks of old sets. Meanwhile the repo censuses ~160
sets but few are fully implemented — a booster drawn from a partial set would
either skew the distribution or contain unplayable cards.

## Decision

- **Booster Configs are imported from MTGJSON via a repo script** (same pattern
  as the rarity backfill): per-set data files with slots and weighted Booster
  Sheets, mapping MTGJSON UUIDs → Scryfall ids. **Foil and variant slots are
  dropped** — foilness does not exist in the engine. Every new set inherits its
  real pack structure for free; no hand-written per-set pack research.
- **A set is a Draftable Set only when every card in its booster sheets
  resolves to an implemented CardDefinition/CardPrint**, minus cards declared
  out of scope by ADR (treated as absent from the print run). The gate is
  computed mechanically from the imported sheets — no hand-maintained
  whitelist. No booster is ever generated with placeholder or skewed contents.

## Considered options

- **Sample only implemented cards** (skewed but works on partial sets):
  rejected — a distorted print run silently misrepresents the Limited
  environment the engine exists to study.
- **Real boosters with unplayable holes**: rejected — phantom bombs in the
  pool are a frustrating, misleading experience.
- **Hand-written per-rarity slot configs**: rejected — unfaithful for old sets
  and a per-set manual research cost.

## Consequences

- Draftability becomes a driver for finishing sets: LEA (complete minus ADR
  0010 exclusions) is the natural first Draftable Set; a set like INV becomes
  draftable the day its census closes.
- The importer needs collector-level print mapping (MTGJSON UUID → Scryfall
  id) that the current card-index does not carry; it lives in the booster
  pipeline, not in `card-index.json`.
