---
name: profile-census
disable-model-invocation: true
description: "Profile Census (PRD #8772): capability, archetype or delta pass — unreviewed seed rows, a residue, promotion tickets."
argument-hint: "capability | archetype <scope> | delta <scope> --rows <id,id>"
---

# /profile-census — propose Card Profile rows, never certify them

The **Profile Census** (`GLOSSARY.md`) reads judgement — what a card is FOR
in an environment — where the derivator of PRD #3602 reads structure. It
proposes; a human certifies in the Admin editor. Everything mechanical about
what it may write is enforced by `bun run census:check` (pure validator
`scripts/lib/profile-census.ts`, residue schema and rationale vocabulary in
`convex/limited/cardProfilesCore.ts`); this file is the judgement.

## The three invariants

1. **Seed rows only, `reviewed: false`.** The census writes
   `data/card-profiles/capabilities.json` or
   `data/card-profiles/archetypes/<scope>.json` — never the database, never a
   Convex mutation, never the Admin page.
2. **A `reviewed: true` row is the human's.** Not edited, not deleted, not
   re-tagged — even when the census disagrees (say so in the residue's `why`
   or the PR, never in the row).
3. **Any data source produces suggestions, never rows** — a set review, a
   cube write-up, a future decklist corpus: each is evidence for a proposal
   the census writes unreviewed, never a row written on its authority.

## The rubric — read before tagging

- **Capabilities**: `CAPABILITY_REGISTRY` in
  `convex/limited/capabilityRegistry.ts` — each row's `description` (both
  sides, PROVIDES / REQUIRES), `gloss` and `example`. Closed vocabulary.
- **Archetypes**: `data/archetype-catalogue.json` — each row's `TAG WHEN:` /
  `NOT:` description, gloss and example card. Closed vocabulary (seed; a row
  added in the Admin DB layer is promoted to the seed before a census tags it).
- **The card**: its Oracle text from its definition (`convex/cards`,
  `resolveCardName` / `tryGetCardByName`), never recalled.
- **Online**: set reviews, cube write-ups, declared interactions, popular
  picks for the scope. Search, read, cite the kind (below); never copy text.

## The passes

| Pass                         | Over                                                 | Writes                                                          | Once per        |
| ---------------------------- | ---------------------------------------------------- | --------------------------------------------------------------- | --------------- |
| `capability`                 | the card catalogue (cards with no Capability row)    | `capabilities.json` — `provides` / `requires`                   | card            |
| `archetype <scope>`          | one scope's cards (`listScopeCards(scope)`)          | `archetypes/<scope>.json` — `archetypes`; new scope → new file  | scope           |
| `delta <scope> --rows <ids>` | one scope, for the named new catalogue/registry rows | only the tags named in `--rows`; every other tag stays as found | new row × scope |

A new archetype file is registered in `CHECKED_IN_CARD_ARCHETYPES`
(`cardProfilesCore.ts`) — a Convex isolate cannot list a directory.

Per card: read the rubric rows that could apply, the Oracle text, then the
online sources; tag only what a `TAG WHEN:` / PROVIDES-REQUIRES clause
covers and no `NOT:` excludes. No tag is a legal answer — an empty row scores
nothing (ADR 0072). Work in batches of ~40 cards, run `census:check` after
each batch, commit, push.

## The rationale — one line, the source kind first

Every row the pass writes or changes carries
`rationale: "<kind>[+<kind>]: <one line>"`, kind from `CENSUS_SOURCE_KINDS`:

| Kind                   | The line rests on                                                 |
| ---------------------- | ----------------------------------------------------------------- |
| `oracle`               | the card's own text — checkable on the card                       |
| `set-review`           | a published review of the card's set                              |
| `cube-writeup`         | a cube designer's or list's write-up of the card's role           |
| `declared-interaction` | a named interaction people describe (with the partner card named) |
| `popular-pick`         | pick-order or deck-inclusion popularity for the scope             |
| `rubric`               | a catalogue/registry row's `TAG WHEN:` or example names it        |

`oracle+cube-writeup: discards as a cost; cube lists run it in reanimator`
— the reviewer reads the kind and knows how far to trust the line.

## The residue — what the census could not say

A card that needs a Capability the registry lacks is NOT tagged with an
invented id (`census:check` refuses an unregistered id): the need goes to the
pass's residue file, `data/card-profiles/residue/<pass>-<scope>.json`
(`capability-catalogue.json` for the capability pass):

```json
{
    "pass": "archetype",
    "scope": "vintage-cube",
    "candidates": [
        {
            "name": "graveyard-card-types",
            "providers": ["<cardId>", "<cardId>"],
            "requirers": ["<cardId>"],
            "why": "cube-writeup: fetchlands feed Barrowgoyf's card-type count"
        }
    ]
}
```

Schema (`validateCensusResidue`): `pass` ∈ capability/archetype/delta;
`scope` lowercase, `catalogue` exactly for the capability pass; `rows` on a
delta only; per candidate a kebab-case `name` that is neither a registered
Capability nor an Archetype id, ≥1 resolving provider and ≥1 resolving
requirer, a one-line `why`. Read-only to the engine; the Admin panel shows
it. Fixture: `scripts/__tests__/fixtures/profile-census/residue.fixture.json`.

## Promotion — the census files the ticket

A candidate with **≥2 providers and ≥2 requirers in the scope** earns a
registry ticket, filed by the pass itself as a sub-issue of PRD #8772
(`.claude/skills/next-ticket/filing.md` for band and labels:
`area:limited-bot`, `enhancement`, `ready-for-agent`). Fewer → it stays in
the residue as evidence; the next scope may complete it. Every card named
in the ticket body is a link (`docs/agents/issue-tracker.md`
§ Card names are Scryfall links; `bun run card:link`). Template:

```markdown
## Parent

#8772

## What to build

Promote Capability candidate `<name>` from the census residue
(`data/card-profiles/residue/<file>`) into `CAPABILITY_REGISTRY`, with its
gloss, cluster and example, and tag its providers and requirers (unreviewed).

- PROVIDES: <clause> — e.g. <card> (<one line>)
- REQUIRES: <clause> — e.g. <card> (<one line>)
- Providers in <scope>: <card>, <card>, …
- Requirers in <scope>: <card>, <card>, …

## Why a Capability

- Not an Archetype: <a card-to-card relation, not a deck plan — why>
- Not a Combo Edge: <more than one partner on each side — why>
- Not a duplicate: <the nearest registered row and the card it splits on>
- Structural derivation: <the rule the derivator of PRD #3602 could read, or "none — judgement">

## Acceptance criteria

- [ ] Registry row with description (both sides), gloss, cluster, example
- [ ] Providers/requirers tagged `reviewed: false` with rationale; `census:check` passes

## Target files

- `convex/limited/capabilityRegistry.ts`
- `data/card-profiles/capabilities.json`
```

## The check — before every commit

```bash
bun run census:check -- --layer archetypes --scope <scope> [--rows a,b]
bun run census:check -- --layer capabilities [--rows a,b]
bun run census:check -- --residue data/card-profiles/residue/<file>.json
```

It diffs the seed against `HEAD` (`--ref` to change): refuses a write onto
or deletion of a reviewed row, `reviewed: true` written, an unregistered
Capability / Archetype / card id, a missing or unsourced rationale, a Combo
Edge, and — with `--rows` — any tag change outside the rows. Exit 1 lists
every reason; fix the rows, never the validator.

## Hand-off

The pass ships through the ordinary pipeline: worktree, PR, `land:ready`
(a `data/**`-only diff). The PR names the pass, the scope, the row count
written, the residue file and the promotion tickets filed.
