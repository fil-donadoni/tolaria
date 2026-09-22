---
name: new-card
description: Bring ONE card into the catalogue the grammar-first way (ADR 0137) — ask the Oracle compiler what it already does with the card, and let its compile state decide the work: `ready` owes only the artefact refresh and the Bot read-back, `quarantine` owes the engine a mechanic, an unparsed card whose gap pays for itself owes a Grammar Rule (`/grammar-rule`), and only a card whose every residual gap sits below `handTailFloor` is written by hand, under Guard C with a `hand-tail:` marker. Use when a user names one card, when a Target List needs one card covered, or when a hand-tail issue is picked off the queue.
argument-hint: "<card name>"
allowed-tools: Bash(curl:*) WebFetch(domain:api.scryfall.com) WebFetch(domain:scryfall.com) Bash(bun run cr:*) Bash(bun run oracle:*) Bash(bun run check:*) Bash(jq:*)
---

# /new-card — compile first, hand-write last

**The compiler is how a card enters the catalogue** (ADR 0137). A card is
hand-written only where the grammar does not reach it, and then under Guard C
with a marker naming its issue — hand-writing is the fallback, never the plan.

So this skill's first job is not to author anything. It is to ASK: what does
the compiler already do with this card, and what does that answer make owed?
The answer is a state in a committed artefact, not a judgement — §2 reads it,
§3–§6 are the four branches, and only §6 writes a `CardDefinition`.

It runs inside `/next-issue` (claim, worktree, review, `land` are that skill's);
everything below is §3 of it.

## The three anti-Forge guards (ADR 0137) still apply here

A catalogue that grows card by card, each with its own hand-written script, is
Forge. Nothing in this skill may:

1. **Add a structural construct.** The Effect Script's structure is frozen at
   ADR 0045's four (`bind`, `ref`, `if`, `forEach`).
2. **Name an Op after a card.** An Op is named and shaped for the MECHANIC
   (issue #1917). A missing Op is `/new-op`, never a `resolve()` that routes
   around it.
3. **Buy coverage with leniency.** The parser is fail-closed (ADR 0105 § 2).
   A card that will not compile is a card the grammar has not earned — it is
   never made to compile by widening a rule.

## 1. The card — Oracle text and identity

Scryfall blocks WebFetch (HTTP 403); use curl with a User-Agent:

```sh
curl -s -A "Mozilla/5.0" "https://api.scryfall.com/cards/named?exact={card+name}"
```

`exact=` over `fuzzy=`. Keep `name`, `oracle_id`, `oracle_text`, `mana_cost`,
`type_line`, `power`, `toughness`, `loyalty`.

- **`oracle_id`** is the join key for everything in §2 — the compiler works on
  oracle cards, not printings (CR text is a property of the oracle card).
- **A print `id`** is needed ONLY on the hand-written branch (§6). It is the
  card's `identifiers.scryfallId` from `data/json/<SET>.json`, the EARLIEST
  paper printing (ADR 0041) — never a fresh UUID, which silently breaks the
  art and reds `check:index`:
    ```sh
    jq -r '.data.cards[] | select(.name=="<Card Name>") | .identifiers.scryfallId' data/json/<SET>.json
    ```
    On the compiled branches the id is resolved for you by `oracle:index`
    (ADR 0108) — do not pick one by hand.

## 2. Ask the lockfile — the branch point

`data/oracle-compiled.json` is the committed compile of the pinned corpus. It
answers offline, in a quarter of a second, and it is the same artefact
`oracle:report`, `check:targets` and `catalogue:pack` read — so this reading and
the gates cannot disagree:

```bash
jq -r --arg n "<Card Name>" '. as $l | $l.cards[] | select(.name==$n)
  | "state=\(.state)  ops=\(.opsUsed // [])  quarantine=\(.quarantineReasons // [])",
    ((.gaps // [])[] as $i | $l.fragments[$i]
      | "  fragment: \(.text)\n    reason: \(.reason)  attribution: \(.attribution // "—")  fragment-cards: \(.cards)")' \
  data/oracle-compiled.json
```

Nothing printed → the card is not in the pinned corpus (§2b). Otherwise the
`state` picks the branch, and **the branch is the whole decision — never write
a definition because the card "looks simple"**:

| `state`                                  | What the card needs               | §   |
| ---------------------------------------- | --------------------------------- | --- |
| `ready`                                  | nothing authored — artefacts only | §3  |
| `quarantine`                             | the engine owes a mechanic        | §4  |
| `unparsed`, any gap's leverage ≥ floor   | a Grammar Rule                    | §5  |
| `unparsed`, every gap's leverage < floor | the hand tail — write it          | §6  |

### 2a. The floor comparison runs on the GAP, never on the fragment

`fragments[].cards` above is **not** the number the floor is compared against,
and using it is the one way to land in §6 a card that belongs in §5. It counts
the cards printing that fragment's EXACT literal text; the floor is compared
against a gap's **leverage** — the cards carrying the GAP, whose key folds
mana amounts to `{…}` and numbers to `N` and counts each card once across all
its lines (`gapIndex` in `scripts/lib/targets.ts`, the same measure
`coverageVerdict`, `check:targets` and `buildHandTailFilings` use;
`scripts/lib/gap-kinds.ts`'s header states it outright). 11,436 fragments in
today's lockfile sit below the floor on `.cards` while their gap is at or above
it — Greta, Sweettooth Scourge prints two fragments of one card each, and their
gap `activated › activation cost › object descriptor › Food` refuses 19.

So take the attribution from the jq, build the key (`slot › path › span`,
folded), and read the leverage off the report — its header is the authority:

```bash
L="$SCRATCHPAD/gap.log"
bun run oracle:report --gap "<key or a unique substring of the span>" >"$L" 2>&1; echo "exit=$?"; head -5 "$L"
```

`corpus: <C> compile / <R> refuse` — **`R` is the leverage**, the figure the
floor is compared against (`C` is the subset this gap is the card's ONLY gap
for, i.e. the cards the rule alone graduates). An ambiguous substring exits 1
and lists the candidates; pick one, never the first.

`handTailFloor` is `data/targets.json`'s (3 today). A rule that pays for fewer
than the floor is a per-card script in grammar's clothing (wayfinder issue
#3848), which is why the floor, not the card's urgency, decides §5 vs §6.

Read the card's coverage state back the same way the gate does, when the card
belongs to a registered Target:

```bash
bun run oracle:report --targets >"$SCRATCHPAD/targets.log" 2>&1; echo "exit=$?"
awk -v c="<Card Name>" '/^[a-z0-9-]+ +\(/{t=$1} /^ {2}[a-z-]+ +[0-9]+:/{if (index($0,c)>0){split($0,f,":"); print t"  "f[1]}}' "$SCRATCHPAD/targets.log"
```

(Extract, never `grep` the log for the name: a state line lists every card in
that state — one of them is 28k names long, and it lands in the transcript
whole.)

States are `ready` / `quarantine` / `gap-pending` / `hand-tail` / `unclaimed`
(`scripts/lib/targets.ts` § `coverageVerdict`). `check:targets` reds on two of
them: **`unclaimed`** — no issue stands behind the card's state, and closing
that is part of whichever branch you take — and a **migrable `hand-tail:`
marker**, one on a card whose row is now `ready` (retire the twin, ADR 0114) or
whose gap has climbed back to the floor (flip it to `compiler-gap:`).

### 2b. Not in the corpus

The corpus is pinned (`data/oracle-corpus.pin.json`), so a card printed after
the pin is absent. Refresh it, recompile, and re-ask §2:

```bash
bun run oracle:corpus  >"$SCRATCHPAD/corpus.log"  2>&1; echo "exit=$?"
bun run oracle:compile >"$SCRATCHPAD/compile.log" 2>&1; echo "exit=$?"
```

A corpus bump moves every state in the lockfile, so it is its own PR, on its
own issue — never a side effect of one card. If the card is absent and the pin
is current, the name is wrong: check it against the Scryfall response of §1.

## 3. `ready` — nothing to author

The compiler already produces this card's definition; a hand-written twin
would be a second authority over one card (ADR 0114). **Do not write one.**
What is owed is that the definition reaches the two renderings of the
catalogue, and that the Bot can play it.

```bash
bun run check:index && bun run catalogue:check
```

Both green → the card is already served, and the issue closes with a read-back,
no diff. `catalogue:check` reds with `compiled ready row(s) have no card-index
id/rarity` → the row never joined an id; regenerate, never hand-edit:

```bash
bun run oracle:index   >"$SCRATCHPAD/index.log" 2>&1; echo "exit=$?"   # Scryfall; retry on 503
bun run catalogue:pack >"$SCRATCHPAD/pack.log"  2>&1; echo "exit=$?"
bun run check:oracle && bun run catalogue:check && bun run check:index
```

**Bot read-back.** ADR 0137 says reachability is computed, but the Bot-play
sweep is issue #3830, open — nothing writes `botReach` today. So walk the three
seams by hand over the card's `opsUsed` from §2
(`.claude/rules/gre-development.md` § Bot reachability): `enumerateMoves`
(reachable?), the choice surface (can it answer?), `OP_VALUERS` +
`OP_BENEFICENCE` (does it want to? — the sign fails open to neutral). Declare
the outcome in the PR.

The diff here is `data/**` artefacts only: no `convex/cards/sets/**`, no
`convex/gre/**`, so **no preset scenario is owed** — say "none owed" under the
heading, which is what `land` reads.

**Already hand-written AND `ready`?** That is a `migration` gap, not this
skill: the hand-written twin is retired under ADR 0114 through the issue
`gaps:sync` files (`Migration:` prefix). Say so and stop.

## 4. `quarantine` — the compiler read it, the engine owes something

The card parsed; a `QuarantineReason` withholds it (`planned-op`,
`planned-mechanic`, `ungrantable-keyword`, `validate-effect-script`,
`smoke-scenario`, `wire-projection`, `not-json`). The work is that class, for
every card carrying it — never this one card:

- `planned-op` → `/new-op`, which ends at the rule that emits it.
- `planned-mechanic` / `ungrantable-keyword` → the mechanic, implemented WHOLE
  (`.claude/rules/gre-development.md`), on its `Quarantine (mechanic):` issue.
- `smoke-scenario` → a card-dependent form owed a `GOLDEN_FIXTURES` row
  (ADR 0105 § 7.1), on its `Quarantine (scenario):` issue.
- `validate-effect-script` / `wire-projection` / `not-json` → the compiled
  definition is well-formed to the grammar and wrong to the ENGINE: it fails
  validation, does not survive `projectPublicState`, or is not plain JSON.
  `quarantineClass` buckets all three under the same `scenario` claim kind, so
  they share the `Quarantine (scenario):` issue shape — but the fix is in the
  lowering or the engine surface, not in a fixture.

Find the issue that already stands behind the class before opening anything —
`gaps:sync` files these idempotently and writes the number back:

```bash
jq -r --arg k "<reason text>" '.claims[] | select(.key|contains($k))' data/grammar-gaps.json
```

**Hand-writing around a quarantine is not an exit.** A definition built on a
`planned` keyword reds Guard A, and one built on a missing Op cannot be written
at all — that is the point of the state.

## 5. `unparsed`, gap at or above the floor — the work is the RULE

This is the case ADR 0137 exists for: the card is one of N the same rule
unlocks, and writing it by hand buys one card and leaves the other N-1.

1. **Attribute the fragment** — §2 printed it, §2a turned it into a gap key
   and read its leverage off `oracle:report --gap`.
2. **Find or lodge the gap issue.** `data/grammar-gaps.json` holds the filed
   claims (`ops` rows for the Op census, `claims` rows for the other kinds).
   Nothing there → run `bun run gaps:sync --dry-run` and read the computed
   plan. `--dry-run` writes nothing, but run it **from the primary checkout**
   anyway, never a worktree: drop the flag by accident there and it commits the
   allowlist and pushes `HEAD` onto the base branch from its cwd. Still nothing
   → open the issue by hand, titled
   `Grammar Gap: <key>`, labelled `ready-for-agent` + `area:mechanics`,
   parented on the Grammar Rules umbrella of its band
   (`docs/agents/issue-tracker.md` § Umbrellas partition by band). Give it a `## Target files` section — the queue planner runs an
   issue without one SOLO. Every card name in its body is a Scryfall link
   from `bun run card:link "<Card Name>"` (`docs/agents/issue-tracker.md` § Card names are Scryfall links).
3. **Hand the card to `/grammar-rule`** on that issue. The card graduates as
   one of the rule's `ready` delta, and the rule is what the PR is measured by.

**`compiler-gap:` is not a shortcut past this.** The marker means "the grammar
still owes this rule", and it is legitimate only for a card a Target needs
BEFORE its scheduled rule lands — an exception argued in the PR, not a default.
Its shape is strict (`scripts/lib/compiler-gap-markers.ts`), it sits in the
comment paragraph directly above the card's `export const … : CardDefinition`
anchor, and it names the OPEN gap issue:

```ts
// compiler-gap: <the exact Oracle fragment> (#<grammar gap issue>)
```

`check:targets` keeps it honest in both directions: the marker goes stale when
the card compiles, and a `hand-tail:` marker whose gap climbs back to the floor
must be flipped to this one.

## 6. Every residual gap below the floor — the hand tail

The grammar will never pay for this card, so it is hand-written for good. A
protocol (`resolve()`) card is hand tail by construction.

### 6a. The marker and its issue

`gaps:sync` files a hand-tail issue only for a card of an `enforced` Target
(`data/targets.json`, issue #4219) — for an `enforced` Target's card the issue
exists already, find it under `Hand Tail: <Card Name>`. Any other card's filing
is COMPUTED and reported without filing: read the plan from the primary
checkout, then open the issue yourself with the same shape —
`Hand Tail: <Card Name>`, labels `ready-for-agent` + `area:cards` + `hand-tail`,
body naming the fragment, each residual gap's leverage and the floor. The
title keeps the bare name; in the body the card is the link
`bun run card:link "<Card Name>"` prints (`docs/agents/issue-tracker.md` § Card names are Scryfall links):

```bash
bun run gaps:sync --dry-run >"$SCRATCHPAD/gaps.log" 2>&1; echo "exit=$?"; grep -n "hand-tail" "$SCRATCHPAD/gaps.log"
```

The marker goes in the comment paragraph directly above the anchor and names
that issue, which the card's own PR closes:

```ts
// hand-tail: <the exact Oracle fragment> (#<hand-tail issue>)
```

A well-formed marker is also what keeps the filing idempotent the day its
Target is enforced — a marked card is settled and is never filed again.
**`compiler-gap:` here would claim a debt the grammar does not have**, which
below the floor is false, and `check:targets` reds on it.

### 6b. Write the definition

Types from `convex/cards/types.ts`. Everything below is the pre-existing card
discipline, unchanged:

- **Effect Script by default** (ADR 0045): `effects: EffectOp[]` at the site
  the ability resolves from (`CardDefinition.effects`,
  `ActivatedAbility.effects`, the triggered ability's `effects`), mutually
  exclusive with `resolve()` / `resolveSteps` / `effect` on that site.
- **The Mechanics Registry is the name authority**
  (`convex/cards/mechanicsRegistry.ts`): every `staticAbilities[]` string
  resolves to a row with `status: "implemented"` (or its `bindingPattern` for
  a parametrized keyword), every Op is a row in `EFFECT_OP_REGISTRY`. A
  `planned` or absent one is stop-and-open-an-issue (`/new-op`), never an
  invented name and never a `resolve()` routing around it.
- **`resolve()` needs `// protocol card: <why>`** on the ability and the same
  justification in the PR. A missing Op is not a justification.
- **Mana cost**: `{3}{W}{W}` → `{ X: 3, W: 2 }`; `{C}` → `C`.
- **CR**: print the rule, never recall it — `bun run cr <id>` — and every `CR`
  line owes `bun run cr:ledger confirm <file>:<line>`, one per call.
- **One Oracle line = ONE `TriggeredAbility`** with `event: GameEventType[]`
  (CR 603.2).
- **Token / emblem art is setup, not polish**: a shared spec from
  `convex/cards/sharedTokens.ts`, else `node scripts/fetch-token-prints.mjs`,
  else an explicit `imagePrintId`; an emblem's goes on its `EmblemDefinition`.
  `tokenPrintLookup.test.ts` / `emblemArt.test.ts` red without it.
- **Uncomment every matching reprint stub** — `grep -rn "definitionId:
\"<NEW_CARD_ID>\"" convex/cards/sets/`, uncomment the whole `CardPrint` block,
  drop the trailing ` (stub)`.
- **Frontend wiring walk** (mandatory, `.claude/rules/gre-development.md`): a
  new activation-cost shape goes into
  `src/lib/__tests__/activation-affordability.catalogue.test.ts`'s `Shape`
  union AND is gated in `getStackAbilities`; a new instance field or
  `TargetRequirement.type` is proven through `projectPublicState` /
  `buildTriggerStateView`, never a hand-built view.
- **Bot reachability walk**, as in §3.

### 6c. Artefacts and gates

```bash
bun scripts/backfill-card-index.ts   # incremental; --prune only for pollution
bun run catalogue:pack
bun run check:index && bun run catalogue:check && bun run check:oracle && bun run cr:lint
bunx vitest run convex/cards/__tests__/compilerRoundTrip.test.ts convex/cards/__tests__/effectScripts.test.ts
```

Never reset `data/card-index.json` to `[]` — it destroys the ~1400
`source: "compiled"` rows this script cannot rebuild. Never hand-edit a
generated file; regenerate it.

Guard C reds without the §6a marker, and the baseline is **closed to new
entries** — a new card is never parked in
`convex/cards/__tests__/compilerRoundTrip.baseline.ts`.

A `convex/cards/sets/**` diff owes a **`## Preset scenario`** ```json fence
(ADR 0044) — `land` refuses the merge without one and seeds it post-merge.

## 7. The PR body

````markdown
Closes #<issue>

## Compile state

`<Card>` — lockfile `<state>`, gaps: `<fragment>` (attribution `<slot › path › span>`, corpus <N>, floor <F>).
Branch taken: <§3 ready | §4 quarantine | §5 grammar rule | §6 hand tail> — <why that branch and no other>.

## What changed

<artefacts regenerated | the rule's ticket | the hand-written definition + its `hand-tail:` marker>

## Census read-back

`check:index` · `catalogue:check` · `check:oracle` · `cr:lint` — <each: green / what it said>.
Coverage state (`oracle:report --targets`): <before> → <after>.

## Bot reachability

<three-seam walk over the card's Ops — `enumerateMoves`, the choice surface, `OP_VALUERS` + `OP_BENEFICENCE`>.

## Preset scenario

```json
{ "label": "<card> — <what it shows>", "spec": { "cards": [ … ] } }
```
````

"none owed" in that last section for an artefact-only diff (§3) — it is what
`land` reads, and the reason must be there, not implied.

## Checklist

- [ ] §2 run, its output quoted in the PR — the branch is the lockfile's, not a judgement
- [ ] `ready` → no `CardDefinition` written; artefacts green; migration named if a twin exists
- [ ] `quarantine` → the class's issue found or filed; no card hand-written around it
- [ ] Gap ≥ floor → `/grammar-rule` on the gap issue; a `compiler-gap:` card, if any, argued in the PR
- [ ] Gap < floor → `hand-tail: <fragment> (#issue)` above the anchor, issue opened with the `gaps:sync` shape
- [ ] Hand-written: id = earliest paper printing; registry consulted; `resolve()` justified; reprints uncommented; token/emblem art wired
- [ ] Frontend wiring and Bot seams walked, both declared in the PR
- [ ] `check:index` · `catalogue:check` · `check:oracle` · `cr:lint` green; no generated file hand-edited
- [ ] Any issue this skill opens carries `## Target files` and its native parent/blocked-by edge (a body line alone is not the sort key) — read back with `bun run queue:lint <issue>`, which reports both the missing edge and the missing body line (issue #3794)
