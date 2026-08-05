---
name: mtg-rules-check
description: Look up MTG Comprehensive Rules and cross-reference with the Tolaria GRE implementation. Use when implementing cards, abilities, or game mechanics.
argument-hint: "[rule number, keyword, or card name]"
allowed-tools: WebFetch(domain:yawgatog.com) WebFetch(domain:mtg.fandom.com) WebFetch(domain:scryfall.com)
---

# MTG Rules Lookup and Cross-Reference

You are verifying Magic: The Gathering rules for the Tolaria game engine.

## Workflow

Given a rule number, keyword, or card name:

### Step 1 — Fetch official rule text

- **By number** (e.g. `704`): WebFetch `https://yawgatog.com/resources/magic-rules/#R{number}` (e.g. `#R704`)
- **By keyword** (e.g. `trample`): WebFetch `https://yawgatog.com/resources/magic-rules/` and search for the keyword
- **By card name**: WebFetch from Scryfall API `https://api.scryfall.com/cards/named?fuzzy={name}` to get oracle text, then find the relevant rules

Extract the exact CR text with rule numbers.

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
> {exact CR text}

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
