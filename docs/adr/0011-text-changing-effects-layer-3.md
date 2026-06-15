# ADR 0011 — Text-changing effects (CR 612, layer 3) on a data-driven engine

**Status:** Accepted (2026-06-14)

## Context

Two Alpha cards are text-changing effects (CR 612, CR 613.1c layer 3):

- **Magical Hack** — "replace all instances of one basic land type with
  another" on a target spell or permanent. On a basic land this changes its
  land subtype (and therefore its intrinsic mana, CR 305.6) and rewrites
  landwalk references (`swampwalk` → `plainswalk`).
- **Sleight of Mind** — "replace all instances of one color word with
  another". This changes color _words inside ability text_ — "protection from
  white" → "protection from blue", "target blue spell" → "target red spell" —
  **not** the object's own color.

Both last **indefinitely** (CR 612.6) and end when the object changes zones
(CR 612.7 — a new object).

The hard part: Tolaria has **no card text at runtime**. Abilities are
structured data (`StaticEffect` discriminated union, `staticAbilities: string[]`
keyword strings, `targetRequirement`), not prose. CR 612 "change the text" has
no text to act on. The CLAUDE.md note listing "Layer system for static
effects" as out of scope reflected this — text-changing was deferred.

We chose to build it **generally** (a real layer-3 substitution substrate)
rather than as a pair of card-specific hacks, on the explicit understanding
that future sets reuse it.

## Decision

### Substitution is a continuous effect carried on the instance

A new **optional** field on `CardInstanceState`:

```ts
textChanges?: { kind: "land-type" | "color-word"; from: string; to: string }[];
```

- **Optional** — absent on essentially every instance. `applySubstitution`
  fast-paths `if (!instance.textChanges) return raw`, so normal cards pay
  nothing at read time and the field costs no memory when undefined.
- **Carried on the instance** gives the CR 612.6/612.7 duration for free: on a
  zone change the instance is a new object, so the field is naturally dropped.
- Added to `PERSISTED_OPTIONAL_KEYS` (`serialize.ts`) with a round-trip smoke
  test (CLAUDE.md serialization rule).

`CardDefinition`s are **never touched** — the ~290 existing card data records
stay byte-for-byte unchanged. This is the decisive advantage over a
"tag substitutable fields in the type" approach, which would reshape card data
across the catalogue.

### A registry of word-bearing fields, applied at read time

The substitution surface — the finite set of structured places a color word or
land-type word can live — is captured as a **registry of rewriter rules** in
the GRE, not as a side note in each consumer. `applySubstitution(instance)`
walks that registry and returns a rewritten view. The current surface:

- land subtype → intrinsic mana (`getBasicLandMana`) and landwalk
- landwalk keyword strings in `staticAbilities` (`LANDWALK_KEYWORDS`)
- `protection from <color>` strings (via `parseProtectionFromColor` /
  `getProtectedColors`)
- color-based `targetRequirement`
- color-conditional `StaticEffect` members

The stringly-typed half is **already funnelled** through a small set of named
parsers (`parseProtectionFromColor`, `LANDWALK_KEYWORDS`, `LAND_SUBTYPE_MANA`,
color derivation). Substitution hooks **inside those parsers**, so every
consumer that uses a parser inherits it for free — no scattered edits.

### Enforcement: the compiler and a guard test, never memory

The danger of a read-point approach is forgetting to route a **new** consumer:
a future card adds "can't be blocked by white creatures", and Sleight of Mind
silently fails to affect it. We make that impossible to ship:

1. **Structured half — compile-time.** `applySubstitution` switches on the
   `StaticEffect` / ability / `targetRequirement` discriminated unions with
   `default: assertNever(x)`. Adding a new word-bearing `kind` **breaks the
   build** until the author classifies it (carries-word: yes/no).

2. **Stringly-typed half — guard test.** A test scans every registered
   `CardDefinition` for any color-word or land-type-word token appearing in a
   string field and **fails** if that token is not claimed by a
   substitution-aware parser. A new card with a color clause in an unhandled
   string pattern turns the test red — not into a silent runtime bug.

Together: structured additions break compilation, string additions break the
test. No reliance on a developer remembering.

## Rationale

1. **General, because the user asked for layer-3 proper**, not two hacks. The
   substrate is reused by any future text-changing card.
2. **Zero card-definition churn.** The registry lives entirely in the engine;
   card data is untouched.
3. **Self-enforcing.** The two-pronged enforcement converts "remember to wire
   the new consumer" from a discipline problem into a build/test failure.
4. **Read-time, consistent with the existing engine.** Tolaria already
   computes characteristics at read time (P/T layers, `getColors`,
   `colorOverride`). Substitution is one more read-time transform, not a new
   mutate-then-read pass.

## Consequences

- New optional `CardInstanceState.textChanges`; serialize key + round-trip
  test.
- New `applySubstitution` module plus the word-bearing-field registry.
- The named string parsers become substitution-aware at their single
  chokepoints.
- A guard test enumerating color/land-type tokens across all card defs.
- Magical Hack and Sleight of Mind move from commented stubs to active
  definitions.

## Out of scope

- **Spell → permanent continuity.** Both cards can target a spell on the
  stack; the effect should follow the permanent it becomes (CR 612.6). The
  engine creates a fresh instance on resolution, so a stack-targeted text
  change does not yet carry onto the resulting permanent. Documented
  limitation — the common case (targeting a permanent) is correct.
- Text changes other than basic land types and color words (CR 612 also
  covers creature-type and other word changes) — no Alpha card needs them.
- A full mutate-the-text model. There is no runtime text; the registry is the
  substitute and is sufficient for the structured-data engine.
