---
name: mtg-rules-check
description: Look up MTG Comprehensive Rules and cross-reference with the Tolaria GRE implementation. Use when implementing cards, abilities, or game mechanics.
argument-hint: "[rule number, keyword, or card name]"
allowed-tools: Bash(bun run cr:*) Bash(bun scripts/cr.ts:*) WebFetch(domain:api.scryfall.com) WebFetch(domain:scryfall.com)
---

# MTG Rules Lookup and Cross-Reference

You are verifying Magic: The Gathering rules for the Tolaria game engine.

## The rules source — one, official, local (ADR 0098)

The **only** authority is the official Comprehensive Rules document published by
Wizards, vendored at `data/cr/comprehensive-rules.txt` and sliced by
`bun run cr`. Never quote CR text from memory, from a third-party mirror
(yawgatog, ancestral.vision, mtg.fandom, a wiki), or from an ad-hoc
`curl` of a CR URL you recall — model-recalled rule NUMBERS are the single
largest source of wrong citations in this repo, and mirrors lag the official
document by an unknown amount.

```
bun run cr 605.1a           # exactly that subrule, verbatim
bun run cr 605              # section header + every subrule
bun run cr grep "mana ability"      # rule ids + first line of each hit
bun run cr grep -f "morbid"         # full text of each hit
bun run cr glossary "Mana Ability"
bun run cr version          # which CR revision is vendored
bun run cr:check            # ONLINE: has Wizards published a newer CR?
```

Everything except `cr:check` / `cr:sync` is offline, so it works inside agents
with no WebFetch permission and costs only the tokens of the rule you asked for.

**Never cite a rule number you have not printed.** If `bun run cr <id>` says
the rule does not exist, the citation is wrong — find the real one with
`bun run cr grep`, do not "fix" the letter by guessing.

## Workflow

Given a rule number, keyword, or card name:

### Step 1 — Print the official rule text

- **By number** (e.g. `704`): `bun run cr 704`
- **By keyword** (e.g. `trample`): `bun run cr grep "^702\.[0-9]+\. ?Trample$"` to
  find the section, then `bun run cr 702.19` for the whole keyword
- **By card name**: WebFetch `https://api.scryfall.com/cards/named?fuzzy={name}`
  for the oracle text, then find the relevant rules with `bun run cr grep`

Quote the exact CR text with its rule number.

### Step 2 — Find current implementation

Search the codebase for related code:

- `convex/gre/` — engine modules (phases.ts, stack.ts, rules.ts, sba.ts, combat.ts, triggers.ts)
- `convex/cards/` — card definitions (types.ts, sets/)
- `convex/gre/__tests__/` — existing test coverage

Use Grep to find references to the rule keyword or mechanic.

### Step 3 — Gap analysis report

Output a structured report:

```
## Rule: CR {number} — {title}

### Official text
> {exact CR text, as printed by `bun run cr {number}`}

### Current implementation
- File: {path}:{line}
- Status: IMPLEMENTED / PARTIAL / MISSING
- {description of what's implemented}

### Gaps
- {what's missing or differs from CR}

### Edge cases to consider
- {interactions, corner cases from the CR}

### Verdict: {COMPLIANT / PARTIAL / NOT IMPLEMENTED}
```

## Staleness

`data/cr/VERSION.json` records the vendored revision. Wizards republishes the
document on its own cadence (roughly every set) at
<https://magic.wizards.com/en/rules>. Run `bun run cr:check` when starting
rules work after a set release, or whenever a rule reads unexpectedly; if it
reports a newer document, `bun run cr:sync`, commit the new text, and re-verify
the mechanics the diff touches.

## Quick reference — common rule sections

| Topic               | CR Section |
| ------------------- | ---------- |
| Casting spells      | 601        |
| Lands               | 305        |
| Creatures           | 302        |
| Instants            | 304        |
| Sorceries           | 307        |
| State-Based Actions | 704        |
| Combat              | 506-511    |
| Stack               | 405        |
| Priority            | 117        |
| Turn structure      | 500-514    |
| Mana abilities      | 605        |
| Triggered abilities | 603        |
| Activated abilities | 602        |
| Static abilities    | 604        |
| Keywords            | 702        |
| Targets             | 115        |
