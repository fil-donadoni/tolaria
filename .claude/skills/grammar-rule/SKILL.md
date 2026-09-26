---
name: grammar-rule
description: Close ONE Grammar Cluster — the gaps one rule family closes (a single gap is a cluster of one) — read each gap's refused lines and counts, write the Grammar Rule in the right slot or shared sub-grammar, one golden fixture per accepted form with proof of failure, `/new-op` inside the same ticket when the rule needs an Op, recompile, read back the `ready` delta per set and corpus, graduate the hand-written cards that now round-trip out of Guard C's baseline, regenerate the catalogue artefacts, and write the PR body. Use when an issue names a Grammar Gap or a cluster of them (`Grammar Gap: <key>`, a `[Grammar]` cluster ticket's `## Grammar Gaps`, an `oracle:report` rank, a `compiler-gap:` marker's fragment), when `/new-set` v2 cuts a grammar ticket, or when `/new-op` Branch A needs its emitting rule.
argument-hint: "<gap key | cluster issue #N>"
---

# /grammar-rule — one Grammar Cluster → rules + golden fixtures → ready delta

The unit of card work is the **Grammar Rule**, not the card (ADR 0137): one
clause form accepted by a slot or a shared sub-grammar, delivered with its
golden fixtures, measured by how many corpus cards it turns `ready`. This skill
is the sequence one such rule owes. It runs inside `/next-issue` (claim,
worktree, review, `land` are that skill's); everything below is §3 of it.

**The ticket is a Grammar Cluster** (`/new-set` Phase 3): the gaps one rule
family closes, listed under the issue's `## Grammar Gaps`. Steps 1–4 run per
member gap — read it, sort its forms, place its rule, fixture every accepted
form; steps 5–10 run ONCE for the whole cluster — one recompile, one delta, one
graduation, one PR. That is the point of the cluster: the fixed cost is paid
once, the evidence is still paid per form. A member gap that turns out out of
reach (step 3) is refused and named in the PR with why — it does not hold the
rest back, and its claim moves to a new issue (or the long-tail cluster of its
slot) before `land`, so it is never left `unclaimed`. **Do not widen a cluster
mid-ticket** to a gap that is not in its list without saying so in the PR and
adding its claim row — the claim, not the diff, is what `check:targets` reads.

## The three anti-Forge guards — read before writing a line

A grammar that grows by hand, per card, ever fatter, is Forge. ADR 0137 names
the three things that keep it from becoming one, and a rule that breaks any of
them is not a rule this skill ships:

1. **No structural construct.** The Effect Script's structure is frozen at
   ADR 0045's four constructs (`bind`, `ref`, `if`, `forEach`). A Grammar Rule
   may lower to Ops; it never adds a construct. A form that needs one is out
   of reach — stop and say so in the issue.
2. **No Op named for a line.** An Op is named and shaped for the MECHANIC,
   never for the Oracle line that asked for it (issue #1917,
   `.claude/rules/gre-development.md` § Primitive reuse). Decompose into
   existing Ops first; a new Op goes through `/new-op` (step 3).
3. **No leniency.** The parser stays fail-closed (ADR 0105 § 2): a rule
   accepts exactly the forms it has a fixture for and refuses their
   neighbours. Coverage is earned by rules — never by skipping a word,
   swallowing a reminder it did not read, or widening a `pattern` to "make the
   line consume".

## 0. Setup — the corpus cache

`data/oracle-corpus.json.gz` is gitignored, so a fresh worktree has none and
`oracle:compile` throws `oracle corpus cache missing`. Copy the primary
checkout's — `oracle:compile --check` then diffs the lockfile the cache
regenerates against the committed one, and `check:oracle` (step 6) compares the
cache's sha256 against the committed pin (`data/oracle-corpus.pin.json`):

```bash
cp "$(git worktree list | head -1 | cut -d' ' -f1)/data/oracle-corpus.json.gz" data/
bun run oracle:compile --check >"$SCRATCHPAD/compile-check.log" 2>&1; echo "exit=$?"; tail -1 "$SCRATCHPAD/compile-check.log"
```

`lockfile is current` is the baseline every later delta is measured against.
(No primary copy either → `bun run oracle:corpus` fetches it.)

## 1. Read the gap

The gap key is `slot › sub-grammar path › span shape` (`scripts/lib/grammar-gaps.ts`
header — mana amounts fold to `{…}`, numbers to `N`). Print the gap card by card:

```bash
L="$SCRATCHPAD/gap.log"
bun run oracle:report --gap "<key or a unique substring>" [--set <code> | --pool <format>] >"$L" 2>&1; echo "exit=$?"; head -5 "$L"
```

The header carries the counts — `compile` (cards for which this is the ONLY
gap: the rule alone graduates them) and `refuse` — for the Target and the
corpus. An ambiguous substring exits 1 and lists the candidate keys; pick one,
never the first. Then read the lines themselves (`grep -c`, `sed -n`, not
`cat` on a 400-line log) and **sort them into forms**: the distinct clause
shapes the lines actually print. For each form decide, and write down for the
PR:

- **accepted** — the rule will read it (it will get a fixture in step 4);
- **refused** — a neighbour the rule must NOT read (a construct outside the
  four, an engine surface that does not exist, a cost the payment path cannot
  pay). It gets a refusal test, and stays in the backlog under its own key.

A form with one corpus card is still a form; a form nobody prints is not one —
never accept a shape "for completeness".

## 2. Place the rule

The key's path says where the compiler got furthest; that is where the rule
goes, unless the same clause form reaches other slots — then it belongs in a
shared sub-grammar and every slot that routes there inherits it.

| Layer       | Where                                                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Slot        | `convex/oracle/grammar/slots/` (`keywordLine`, `spell`, `triggered`, `activated`, `staticSlot`, `manaAbility`)                |
| Sub-grammar | `convex/oracle/grammar/shared/` (`effectClause`, `condition`, `targetFilter`, `triggerHead`, `cost`, `quantity`, …)           |
| IR          | `convex/oracle/grammar/ir.ts`                                                                                                 |
| Lowering    | `convex/oracle/lower*.ts` (IR → Compiled Definition)                                                                          |
| Combinators | `convex/oracle/rule.ts` — `rule`, `oneOf`, `pattern`, `literal`, `atom`, `listOf`, `pair`, `map`; fail-closed by construction |

Give the rule a `rule("<label>", …)` label naming the MECHANIC (the label is
what a fixture's `rule` field and a failure trace cite). Every mechanic the
rule reads cites its CR section in a comment — printed with `bun run cr <id>`,
never recalled, then `bun run cr:ledger confirm <file>:<line>` (one per call).

## 3. Ops and keywords the rule lowers to

Every Op and keyword the lowering emits must be `implemented` in
`convex/cards/mechanicsRegistry.ts`, or the card lands in `quarantine`, not
`ready` (ADR 0105 § 3). Three cases:

- **Already implemented** — nothing to do; this is most gaps (ADR 0137:
  keyword parameters, trigger heads, effect clauses on existing Ops).
- **Missing Op** — run `/new-op` INSIDE this ticket. This rule is its Branch A
  site 8 (the emitting rule), so the Op and the rule land in ONE PR; the Op
  never lands alone and never enters `data/grammar-gaps.json`.
- **Needs a construct, or an engine surface with no JSON shape** — out of
  reach. The form is refused (step 1), and if it is the whole gap, stop: say
  so on the issue and hand it back.

## 4. Golden fixtures — one per accepted form, each proven to fail

A fixture is a REAL corpus card's Oracle row (copy it from the gap log — never
an invented line) and the WHOLE Compiled Definition the rule must produce for
it, compared with `sortKeys` equality. It lives in one of two places, and the
form decides which:

- **Every accepted form**: a golden test in the rule's own test file,
  `convex/oracle/__tests__/<rule>.test.ts` — `compileCard(oracleCard({…}))`
  equal to the full expected definition. Beside it, one refusal test per
  refused neighbour form (`state: "unparsed"`), so fail-closed is pinned, not
  assumed. `kickerLine.test.ts` is the worked example (goldens, gold over the
  catalogue, refusals, lowering invariants).
- **Additionally, a form whose Compiled Definition the smoke generator cannot
  scenario-ize** (a card-dependent skip, ADR 0105 § 7.1): a `GOLDEN_FIXTURES`
  row in `convex/oracle/grammar/fixtures.ts`, `rule` = the rule's label. That
  row is what clears the form's quarantine for every corpus card that prints
  it. The registry REFUSES a fixture exhibiting no card-dependent form
  (`goldenFixtures.test.ts`: "it clears nothing") — so a form that reaches
  `ready` without one gets the test golden only. Say which in the PR.

**Proof of failure, per fixture.** Commit first (`/next-issue` § 3: a revert on
uncommitted work discards the implementation). Then break the rule — drop the
alternative that reads the form, or the lowering branch — watch that form's
golden go red, revert. **Assert the break applied** (`grep -c` the broken text
≥ 1) before believing either colour. List every break in the PR.

## 5. Gold precision over the hand-written catalogue

Every hand-written card is compiled from its own Oracle text and compared
(`convex/oracle/__tests__/gold.test.ts`, ADR 0105 § 4): of the cards the
compiler accepts, 100 % must match. A new rule that reads a hand-written card
differently reds it. Adjudicate — do not relax:

- the hand-written side is wrong (the corpus agrees with the compiler) → fix
  the card in this PR, or file it (`bug` + `area:cards`, the filing stamp of
  `docs/agents/triage-labels.md` § Every new issue is stamped at filing, with
  its `## Band` line — it has no umbrella) and keep the rule refusing that form;
- the rule is wrong → fix the rule;
- genuinely two encodings of one behaviour → a `KNOWN_DIVERGENCES` row with its
  argument written out in full, as every existing row has.

## 6. Recompile, regenerate the artefacts, read the census back

```bash
bun run oracle:compile >"$SCRATCHPAD/compile.log" 2>&1; echo "exit=$?"      # the lockfile
bun run oracle:index   >"$SCRATCHPAD/index.log"   2>&1; echo "exit=$?"      # card-index rows for newly ready cards (Scryfall; retry on 503)
bun run catalogue:pack >"$SCRATCHPAD/pack.log"    2>&1; echo "exit=$?"      # data/catalogue/* + oracle-compiled-pool.json
bun run check:oracle && bun run catalogue:check && bun run check:index && bun run check:gaps && bun run cr:lint
```

Never hand-edit a generated file (`oracle-compiled.json`, `card-index.json`,
`oracle-compiled-pool.json`, `data/catalogue/*`) — regenerate. If the rule
makes an allowlisted Op emitted for the first time, `check:gaps` reds on its
now-stale `data/grammar-gaps.json` row: delete the row (the allowlist only
shrinks) and close the gap's issue with the PR.

## 7. The `ready` delta

```bash
bun run oracle:report --delta >"$SCRATCHPAD/delta.log" 2>&1; echo "exit=$?"; cat "$SCRATCHPAD/delta.log"
```

Per set and corpus, `before / after / delta / lost` against `origin/<base>`.
**`lost` must be 0**: a card leaving `ready` is a regression the rule caused,
and `check:oracle` refuses it unless `data/oracle-state-regressions.json`
acknowledges it with a human-written reason. Fix the rule rather than writing
that entry. A `delta` far below the gap's `compile` count means the graduates
stopped in `quarantine` — read their `reason.kind` in the lockfile
(`planned-op`, `planned-mechanic`, `ungrantable-keyword`,
`validate-effect-script`, `smoke-scenario`, `wire-projection`, `not-json`)
before calling the rule done. A `smoke-scenario` skip that a golden fixture
should have cleared means the fixture's form and the card's are not the same
form (step 4).

## 8. Graduate the baseline

Hand-written cards that now round-trip must LEAVE Guard C's baseline:

```bash
L="$SCRATCHPAD/roundtrip.log"
bunx vitest run convex/cards/__tests__/compilerRoundTrip.test.ts >"$L" 2>&1; echo "exit=$?"; grep -E 'round-trips now|stale|Tests ' "$L"
```

A red here listing `round-trips now` is the graduation list. Delete each row
from `convex/cards/__tests__/compilerRoundTrip.baseline.ts` (arrays stay
sorted), lower `BASELINE_CEILING` in `compilerRoundTrip.test.ts` by EXACTLY
that many, and delete any `compiler-gap:` marker the guard reports stale. The
baseline edit is a pure deletion — anything else needs a reason in the PR
(the file's own SHRINK-ONLY header). `bun run oracle:triage` prints the class
counts after.

**Every graduate with an open Hand Tail claim closes it.** For each card the
rule makes `ready`, look up its `claims` row of kind `hand-tail` in the Grammar
Gap allowlist (`data/grammar-gaps.json`, key = the card's lockfile name); if the
issue is open, the PR body (§10) carries `Closes #<claim>` as a bare ref beside
removing the card's `hand-tail:` marker. The `check:gaps` guard (issue #4514)
catches a marker that misses its claim, and the `gaps:sync` closer (issue #4516)
closes a claim a landing settled — nets for a miss, so never hand-close.

## 9. Targeted runs, then `gaps:sync` — from the primary checkout only

```bash
L="$SCRATCHPAD/oracle-tests.log"
bunx vitest run convex/oracle convex/cards/__tests__ scripts/__tests__/grammar-gaps.test.ts >"$L" 2>&1; echo "exit=$?"; grep -E 'Test Files|Tests |FAIL' "$L"
```

**Bot reachability is still a WALK, not a computation.** ADR 0137 says it is
computed, but the Bot-play sweep that would record `botReach` is issue #3830,
open — nothing in `convex/` writes that field today, and `bot-unreachable` is
not a `QuarantineReason` yet. So a graduated card owes the manual three-seam
walk of `.claude/rules/gre-development.md` § Bot reachability over the Ops the
rule emits: `enumerateMoves` (reachable?), the choice surface (can it answer?),
`OP_VALUERS` + `OP_BENEFICENCE` (does it want to?). Replace this step with the
sweep's read-back the day #3830 lands.

**The gaps `land` files inherit this ticket's band, automatically.** `land`
reads the band of the issue the branch names (its parent umbrella's board
`Priority` when the umbrella carries one, else its own — `queue:plan`'s rule,
issue #4371) and runs `gaps:sync --band <band>`; a
Grammar Rule under a P0 umbrella therefore files the Grammar, Bot and
mechanic gaps it creates under the family's **P0** umbrella, not the P1 its
Target computes (issue #4158). Nothing to pass or fix by hand after `land`;
when the band could not be read `land` prints `gaps:sync gets no --band (…)`
and the gaps file by their computed band — say so in the §6 report, and move
them by hand. Run by hand from a P0 session (primary checkout only), pass
`--band P0` yourself.

**Never run `bun run gaps:sync` from the worktree.** It commits the allowlist
and pushes `HEAD:<base>` from its cwd — from a feature branch that pushes the
branch onto the base. `land` runs it post-merge from the primary checkout;
quote its `gaps:sync:` line from `land`'s log in the §6 report. (Until
issue #3869 it files the Op-census rows only; a fragment gap closed by this
rule is closed by the PR's own `Closes #N`.)

## 10. The PR body

Review and `land` are `/next-issue` §4–§5. The body:

````markdown
Closes #<cluster issue>
Closes #<hand-tail claim> <!-- one line per graduate with an open claim (§8) -->

## Grammar Gaps

| Key     | Target c/r | Corpus c/r | Outcome                       |
| ------- | ---------- | ---------- | ----------------------------- |
| `<key>` | <c>/<r>    | <c>/<r>    | closed / refused — why (→ #N) |

## Rules

<slot or sub-grammar> · label `<label>` · Ops emitted: <list> (new Op: none | `/new-op` <op>) · CR <ids> — one line per rule.
Refused neighbours (fail-closed, pinned by refusal tests): <form — why>, …

## Fixtures

| Form   | Card               | Where                                       | Proof of failure        |
| ------ | ------------------ | ------------------------------------------- | ----------------------- |
| <form> | <real corpus card> | `<rule>.test.ts` golden / `GOLDEN_FIXTURES` | <what was broken → red> |

## ready delta

```
<oracle:report --delta output, verbatim>
```

Graduated to `ready`: <names>. Quarantined instead: <names — reason>.

## Census read-back

`check:oracle` · `catalogue:check` · `check:index` · `check:gaps` · `cr:lint` — <each: green / what it said>.
Artefacts regenerated: `oracle-compiled.json`, `card-index.json` (+N compiled rows), `oracle-compiled-pool.json`, `data/catalogue/*`.
Guard C: <names> round-trip → baseline rows removed, `BASELINE_CEILING` <old> → <new>.
Gold: <no new divergence | adjudication>.

## Bot reachability

<seam walk over the graduates' Ops — `enumerateMoves`, the choice surface, `OP_VALUERS` + `OP_BENEFICENCE`>.

## Preset scenario

```json
{ "label": "<rule> — <graduated card>", "spec": { "cards": [ … ] } }
```
````

A graduated card is a new card in the catalogue, so the scenario is owed
(ADR 0044) — pick a graduate that shows the form. `land` refuses a
`convex/gre/**` or `convex/cards/sets/**` diff without the section; say
"none owed" only when no card graduated.

## Dry run — the rule already shipped

Before trusting this skill on a new gap, run steps 0, 4 and 6 against a rule
already on the base branch — `kicker` (issue #3826): its `GOLDEN_FIXTURES` row
(Dismantling Blow) and `kickerLine.test.ts` goldens stay green, and
`oracle:compile --check` reports `lockfile is current`, i.e. recompiling
reproduces every fixture and every lockfile row unchanged. Recorded in the
PR that shipped this skill (issue #3834).
