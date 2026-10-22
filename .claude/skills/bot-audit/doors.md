# /bot-audit — templates for the two doors

Reached from `SKILL.md` step 3 (the scratch spec and the entry shape) and
step 7 (everything else). Nothing here runs before the reviewer's word on
the row it serves.

## Entry template — a Minimal Pair in the registry's vocabulary

Two entries of `RegistryBladeScenario` (`convex/gre/ai/blade/types.ts`): the
anchor carries `classification`, the half carries `pairOf` and never its own
`classification` (ADR 0148, issue #4797). Cards by NAME and seat; the half's
`spec` is the anchor's copied with ONLY the Discriminant changed.

```ts
{
    label: "audit: <theme-slug>: <what the Bot gets wrong, in a clause>",
    classification: {
        kind: "conditional",
        discriminant: { kind: "<card|step|life|mana|stack|sequence|other>", detail: "<the one factor>" },
    },
    spec: {
        cards: [
            { name: "<Card>", owner: "me", zone: "hand" },
            { name: "<Card>", owner: "opp", zone: "battlefield", summoningSick: false },
        ],
        phase: "PRECOMBAT_MAIN",
        turn: 4,
        landCount: 3,
        libraryCount: 20,
    },
    // Positions with a pending decision are reached through real setup steps
    // (ADR 0070 §4), never a hand-seeded pendingChoice.
    bot: "me",
    budget: { iterations: 400 }, // declared BEFORE tuning, production range (ADR 0070 §2)
    seeds: [0xb1ade, 1, 2], // K ≥ 3 (ADR 0070 §3)
    tier: "stretch",
    beyondBudget: {
        cause: "valuation", // or branching | horizon | hidden-information, with passesAt / sweptTo
        note: "audit <theme>: <seam>:<symbol> does not read <factor>; issue #N",
    },
    audit: { theme: "<theme key, verbatim>" },
    expect: { forbidden: [{ kind: "<move kind>", card: "<Card>" }] },
    note: "<why this position; the expected move; the measurement that named the cause>",
},
{
    label: "audit: <theme-slug>: <the same move, right once <factor> changes>",
    pairOf: {
        anchor: "audit: <theme-slug>: <the anchor's label, verbatim>",
        discriminant: { kind: "<same kind>", detail: "<same detail>" },
    },
    spec: { /* the anchor's spec with only the Discriminant changed */ },
    bot: "me",
    budget: { iterations: 400 },
    seeds: [0xb1ade, 1, 2],
    tier: "must", // green at budget: the Bot already plays this half right
    audit: { theme: "<theme key, verbatim>" },
    expect: { moves: [{ kind: "<move kind>", card: "<Card>" }] },
    note: "Right-hand half of the audit pair; see the anchor.",
},
```

What the guards hold an entry to:

- `auditEntryProblems` (`convex/gre/ai/blade/auditThemes.ts`): the theme is a
  key of `AUDIT_THEMES`; a `stretch` audit entry carries `beyondBudget.cause`
  and `issue #N` in `beyondBudget.note`. The registry-integrity suite (shard
  0 of `test:blade`) runs it over every entry.
- `BeyondBudget` (`convex/gre/ai/blade/types.ts`): `valuation` carries no
  `passesAt`; `branching` / `hidden-information` carry the `passesAt` that
  clears them; `horizon` carries `passesAt` or, behind a loop, `sweptTo`.
- `pairDiff.ts` (`convex/gre/ai/verdicts/`): the two specs differ by the
  Discriminant only, or the half is dropped from the corpus with a `pair` gap.
- An undiagnosed forced pair still owes a `cause` (`BeyondBudget.cause` is required, and `auditEntryProblems` rejects an audit `stretch` entry without one). The cause is the budget SWEEP's reading, never a default: passes above budget → `branching` / `horizon` with `passesAt`; never passes up to the sweep → `valuation` (ADR 0070 §2: a position with no passing budget), the sweep recorded in the note. The note says `cause undiagnosed` — no term named — and names the umbrella, `issue #4920`.

## The scratch spec — step 3 and step 4, never committed

`convex/gre/ai/blade/__tests__/audit-scratch.spec.ts`, untracked (`git
status` must not list it when the PR opens; delete it at step 7). The blade
config includes `__tests__/**/*.spec.ts`, so it runs under
`vitest.blade.config.ts` with the real `runBladeScenario`:

```ts
import { appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runBladeScenario, type RegistryBladeScenario } from "..";

const OUT = process.env.AUDIT_OUT!; // one row per entry; the run log hides passing output
const PAIRS: RegistryBladeScenario[] = [
    /* the entries of § Entry template, both halves, tier as they will land */
];

describe("audit scratch — writes rows, asserts only that it wrote them", () => {
    for (const entry of PAIRS) {
        it(entry.label, () => {
            const r = runBladeScenario(entry);
            const failing = r.seeds.filter((s) => !s.ok).length;
            const verdict =
                failing === r.seeds.length ? "RED" : failing === 0 ? "GREEN" : "TIE";
            const row =
                `${verdict} ${failing}/${r.seeds.length} "${entry.label}" ` +
                r.seeds
                    .map((s) => `[${s.seed}: ${s.moveDescription} ${s.mechanism ?? "-"}]`)
                    .join(" ");
            appendFileSync(OUT, row + "
");
            // `vitest.blade.config.ts` sets `requireAssertions`: a test with no
            // `expect` fails, and only a FAILING test's console reaches the log.
            expect(row).toContain(entry.label);
        });
    }
});
```

A diagnosis measurement (step 5) is three more lines in the same file on the
built anchor state: `enumerateMoves(state, botId)` lists the offer,
`evaluateBreakdown(applyMoveForSearch(state, move), botId).total` for the
expected and the observed move reads the gap, `OP_BENEFICENCE[op]` /
`OP_VALUERS[op]` read the sign. The state is the one the runner builds
(`buildBladeBaseState` + `buildBladeLoadState`, `convex/gre/ai/blade/`).

## Forced door — the registry PR

1. File the cause issue first (§ Issue template) so the note can name it.
2. Append both entries to `BLADE_SCENARIOS` (`convex/gre/ai/blade/scenarios.ts`)
   with the issue number in the anchor's `beyondBudget.note`.
3. Run what the diff reaches: `bunx vitest run --project bot-node convex/gre/ai/blade/__tests__/registry.bot.test.ts` (`auditEntryProblems` and the pair guards), `bun run test:blade` (the `must` tier — the half sits in whichever shard `bladeShardOf` assigns it) and `bun run test:blade:stretch` (the anchor's report line). **Bite** (ADR 0070 §1): run the half once with `moves` and `forbidden` swapped and see it red; then commit the real one. Delete the scratch spec.
4. One PR for all forced pairs of the session: the Audit Review table and the
   words in its body, `## Preset scenario` as `/next-ticket` § 5 asks
   (the anchor's spec is one), then `bun run land:ready <PR#>`.

The fix PR, later, promotes the anchor to `must` and removes `beyondBudget` in
the same diff; `test:blade:stretch` prints the promotion hint when the fix
has landed for another reason.

## Preference door — the reviewer's own hand

Attestation is a person (ADR 0128): the agent WRITES the judgement, the
reviewer SUBMITS it under their login through the quiz's door,
`verdicts.submit` (tester-gated, `convex/verdicts.ts`). Never the agent's
session, never `npx convex run` as admin.

Hand the reviewer, per preference row:

1. The anchor's `spec` (and `setup`), loaded as a Debug scenario on `/admin/scenarios` → "Test" (a fresh vs-AI game with the Bot on the seat under test); the Debug panel's verdict quiz asks "which move here?" on the Bot's decision. The reviewer names the expected move, says the wrong is `conditional`, and types the Discriminant (kind + detail) from the review row — the wrong-move form carries both, and shows the DERIVED right-hand half (the spec with only the Discriminant changed, prefilled from the kind) to confirm, touch up, or defer.
2. A half the reviewer deferred is written later through the Debug panel's missing-half writer on the stored anchor. Either way the half is the reviewer's own verdict too.
3. The `note` of each: `bot-audit <date> <theme>: <row label>` — the session
   note is the provenance; author alias and email never appear (ADR 0149
   § Consequences).

Then, in the same session, from the audit's branch on a checkout with the reader key:

```bash
bun run verdicts:promote >"$SCRATCHPAD/promote.log" 2>&1; echo "exit=$?"
bun run fit:weights >"$SCRATCHPAD/fit.log" 2>&1; echo "exit=$?"
grep -nE 'unsatisfied|NEITHER|not-fitted' "$SCRATCHPAD/promote.log" "$SCRATCHPAD/fit.log"
```

Read the Minimal Pair outcome of each submitted pair
(`minimalPairFitOutcomes`, `convex/gre/ai/verdicts/fit.ts`): `satisfied` on
both halves → the existing terms already read the Discriminant → no issue.
One half `unsatisfied` → the fit settled on "always" or "never" and the
report names the Discriminant no term reads → ONE issue per such Discriminant
(§ Issue template, kind `preference`). `not-fitted` (a timing pair, a rebuild
error) → the fit said nothing: the search checks it instead (`formatTimingSection`), and it is not an issue from this door.

`verdicts:promote` rewrites the Verdict Lock and `convex/gre/ai/evalWeights.ts` together, and runs the blade `must` tier on the rewritten weights: commit that diff as its own commit on the audit's branch (`docs/guides/verdict-store.md` § Promote the corpus — both in one PR). It rides in the session's PR, which exists even when no forced pair does.

## Issue template — one per diagnosed CAUSE

Rows sharing a cause share one issue. Stamp per `docs/agents/triage-labels.md`
§ Every new issue is stamped at filing; the parent lends the band, so no
`## Band`. Card names in the body are Scryfall links (`bun run card:link
"<Card Name>"`); labels in a fenced spec stay bare.

```bash
gh issue create \
  --title "Bot: <cause in the words of its suspect> (<theme>)" \
  --label bug --label area:game-bot \
  --body-file "$SCRATCHPAD/issue-<n>.md"
gh issue edit <new> --parent 4920
gh issue view <new> --json parent --jq .parent.number   # read back; retry on mismatch
```

Body:

```markdown
## Parent

PRD issue #4920 — Bot Audit (ADR 0149). Theme `<theme>`, audit of <date>.

## Cause

<Suspect> — <the measurement>: `<seam>:<symbol>` does not read <factor>, so
<expected move> and <observed move> score <Δ> apart at <budget> iterations
(seeds n/m). Kind: forced | preference (<the reviewer's word>).

## Test Positions

- "audit: <theme-slug>: <anchor label>" (`stretch`, cause `<cause>`)
- "audit: <theme-slug>: <half label>" (`must`)

<!-- a preference issue lists the pair's Verdict notes instead:
     `bot-audit <date> <theme>: <row label>` — its reproducer is the Verdict -->

## Acceptance

- [ ] Every entry above passes as `must` at its declared budget on every
      declared seed, `beyondBudget` removed in the fix PR.
- [ ] `bun run blade:robustness` classifies each `robust`.
- [ ] The fix names the CLASS (no card name in an identifier, ADR 0102) and
      the `/bot-change` seam row it touched.

## Target files

- convex/gre/evaluate.ts
- convex/gre/ai/<module>.ts
- convex/gre/ai/blade/scenarios.ts
```

`model:*` only by exception (`docs/agents/triage-labels.md` § Model-routing
labels). The owner applies `ready-for-agent`; the audit never does.

## Undiagnosed pairs — the umbrella's block

An `undiagnosed` row the reviewer keeps lands `stretch` with
`note: cause undiagnosed` and `issue #4920` in its `beyondBudget.note`, and
is appended under the umbrella's `## Undiagnosed pairs` heading (create the
heading at the body's end the first time):

```bash
gh issue view 4920 --json body --jq .body >"$SCRATCHPAD/umbrella.md"
printf '\n- "%s" — `%s` — observed %s (seeds %s) — audit %s\n' \
  "<anchor label>" "<theme>" "<observed move>" "n/m" "<date>" >>"$SCRATCHPAD/umbrella.md"
gh issue edit 4920 --body-file "$SCRATCHPAD/umbrella.md"
```

Never a ticket: the queue holds causes, not questions nobody can yet answer.
