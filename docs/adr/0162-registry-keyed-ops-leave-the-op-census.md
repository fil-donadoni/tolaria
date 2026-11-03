# A registry-keyed Op leaves the derived Op census by declaration, never by an allowlist row (amends ADR 0105 § 7.3)

## Status

accepted (2026-11-03, owner decision on issue #7549; amends
[ADR 0105][adr-0105] § 7.3).

## Context

ADR 0105 § 7.3 demands that every `implemented` Op of the Mechanics Registry
be emitted by at least one Compiled Definition, or carry a row in the
shrink-only Grammar Gap allowlist (`data/grammar-gaps.json`) whose issue lands
the emitting Grammar Rule. The only other exit it names is retiring the Op.

`emblem` fits neither. Its argument is a KEY into `convex/cards/emblems.ts`,
whose entries carry closures (`applies` / `matches` / `resolve`) that a
JSON-pure Op body cannot hold (`validateEffectScript`'s purity check). A
Grammar Rule lowering
"You get an emblem with "…"" could only:

1. mint a registry key per emblem body — a per-card registry, which ADR 0137's
   anti-Forge guards and the naming rule (issue #1917) forbid; or
2. carry the emblem body as data inside the Op — a recursive ability grammar
   and an `EmblemInstance` redesign, a new structural construct outside the
   four [ADR 0045][adr-0045] freezes.

Retiring the Op is wrong too: it is the live, correct execution path for every
hand-written planeswalker that makes an emblem.

## Decision

1. **An `EffectOpRow` may declare `notGrammarEmittable: <reason>`** — only for
   an Op whose argument is a key into a closure-backed registry. The reason
   cites the ADR that decided it (`check:gaps` reds a reason with no
   `ADR NNNN`).
2. **The census owes such an Op no Grammar Gap row.** `check:gaps` splits the
   registry with `censusedOps`: a declared Op is reported as "not
   grammar-emittable", and an allowlist row kept for it reds as `unknown-op`.
3. **The declaration is falsifiable.** The day a Compiled Definition emits a
   declared Op, `check:gaps` reds `exempt-emitted`: drop the declaration.
4. **`emblem` is the first, and today only, declared Op.** Its cards stay hand
   tail; the emblem registry is hand-tail infrastructure. Its ~93 refused
   Oracle lines are attributed to their own slots (mostly loyalty lines), as
   the compiler already does.

Choosing option 2 above later ("emblem body as data") is a new ADR that removes
the declaration and reopens the gap.

## Consequences

- The allowlist stays shrink-only and is not a parking lot: the exemption is a
  reviewed registry field citing a decision record, not a row anyone can add.
- Issue #7549 closes with the `(op) › emblem` row removed.

[adr-0045]: 0045-effect-script-hybrid-dsl-frozen-grammar.md
[adr-0105]: 0105-oracle-compiler-fail-closed.md
[adr-0137]: 0137-grammar-first-authoring.md
