---
name: bot-audit
description: "Bot Audit by hand (ADR 0149): census, theme, seams, Minimal Pairs, real search, Audit Review, two doors."
argument-hint: '[<Audit Theme> | "<free question>"]'
disable-model-invocation: true
---

# /bot-audit — one theme, the pairs the Bot gets wrong, two doors

A **Bot Audit** (ADR 0149, GLOSSARY.md) is a hand-run session: an agent reads
the **Evaluation**'s seams for one **Audit Theme**, writes **Minimal Pairs** for
what it suspects the Brain cannot read, runs every pair through the real search
at its declared budget on several seeds, and hands the reviewer an **Audit
Review** holding only the pairs that came out wrong. Each reviewed pair leaves
by one of two doors, by its kind (ADR 0149 §3): a forced-loss pair becomes a
`stretch` **Test Position** with its cause classified (ADR 0070 §2); a
preference pair becomes a **Verdict** the reviewer attests (ADR 0124 §5, ADR
0128), read by the Weight Fit. A diagnosed cause is one issue; a pair with no
cause waits under the umbrella; nothing becomes a rule at the root.

**The reviewer's word is the only thing that files.** Steps 0–6 write nothing
outside the worktree and the chat: no registry entry, no Verdict, no issue, no
label. Step 7 runs on the words given at step 6, row by row, and the session
never applies `ready-for-agent` to anything it files — the loop drains the
queue, the owner fills it (`docs/findings/README.md`, ADR 0149 §6).

Disclosed material — open a file only when its step arrives:

- → `seams.md` — the seams each theme family crosses, and the concrete seam
  list of the five seed themes. Read it at step 2.
- → `doors.md` — the registry entry template, the issue template with its
  `## Test Positions` block, the umbrella's `## Undiagnosed pairs` block, and
  the hand-off of a preference pair to the reviewer's account. Read it at
  step 7.

Only the owner launches it (`disable-model-invocation`): a `/next-ticket` pass
on an audit issue claims, opens the worktree, and hands them the command.
Context hygiene is `/next-ticket`'s: `gh` for fields, noisy stdout to a file
under the session scratchpad, never poll.

Bot work follows `.claude/rules/bot-development.md`; a fix is NOT this
session's job (PRD issue #4920 § Out of Scope): the audit finds, the cause
issue fixes, `/bot-change` is the fixer's map.

## Scope

One theme per session, on the order of **4–8 red pairs** (ADR 0149 §6): the
reviewer's attention is the bottleneck, so three short sessions beat one long
one. At the eighth red pair stop writing and go to step 4 with what you have;
suspicions left over are listed at the end of the report as "not written", one
line each, never as pairs.

Not the Bot-play sweep (`oracle:report`) nor seed noise (`blade:robustness`):
three measurements, never one number (PRD issue #4920, user story 22).

## 0. Census

```bash
bun run blade:audit-census
```

prints one row per **Audit Theme** — pairs, red (`stretch`) and green (`must`)
members, issues named — from `BladeScenario.audit.theme` (ADR 0149 §5, the
closed list in `convex/gre/ai/blade/auditThemes.ts`). With no argument,
propose the least-covered theme: fewest pairs, ties broken toward the corpus
census's collection targets (`docs/research/verdict-corpus-coverage.md`:
non-empty Stack, blockers, attackers, targeting, mulligan). Say the proposal
and the row that made it in one line.

**Done when:** the census is printed and one theme is proposed or given.

## 1. Theme

- A theme argument: it must be a key of `AUDIT_THEMES`, verbatim. Not a key →
  stop; the list grows by one row in its own PR (ADR 0149 §5), never inside an
  audit.
- A free question ("does it blink to save from removal?"): map it onto one
  theme and **name the mapping** — the Decision Class the question is decided
  in (the `Move` kind that answers it, `CLASS_OF_MOVE_KIND` in
  `convex/gre/ai/verdicts/coverage.ts`) × the mechanic family it names. One
  line: `question → <class> × <family> → "<theme>"`. The five seed questions
  and their themes are tabulated in `seams.md` § Seed themes. A question no
  theme holds stops the session the same way an unknown key does.

**Done when:** one theme is named verbatim from the closed list, with the
mapping line if it came from a question.

## 2. Seams — list what the term does not read

Walk the seams the theme crosses — `seams.md` names them per theme family —
the way `/bot-change` Phase 0 reads a blunder, but from the code side: open
each seam, and for every term, valuer, generator or probe ask **"what does this
not read?"** Write each suspicion as one line:

```
<seam>:<symbol> does not read <factor> — so <move> scores the same with and without it
```

A suspicion names a FACTOR (a keyword, a step, a life total, a card on the
Stack, a tapped land), never a card: fix the class, never the card (ADR 0102).
Open the probes that already model the factor before suspecting it absent —
half of what looks blind is read one module over (`seams.md` § Probes).

**Done when:** every seam of the theme has been opened and the suspicions are
listed, each on one line naming its factor.

## 3. Minimal Pairs

Each suspicion becomes one **Minimal Pair** in `ScenarioSpec` (ADR 0148): an
anchor where the Bot's move is wrong, and a right-hand half that is **the
anchor's spec copied with only the Discriminant changed**, where the same
move is right. The **Discriminant** is the factor from step 2, named from the
closed list of kinds (`DISCRIMINANT_KINDS`, `convex/gre/ai/verdicts/types.ts`:
`card`, `step`, `life`, `mana`, `stack`, `sequence`, `other`) — exactly one
per pair; needing two is writing two pairs. A `sequence` Discriminant must
leave a trace on the board (ADR 0148): a move that leaves none yields two
identical feature vectors and the pair is refused.

An **Absolute Verdict** — wrong whatever else changes (Stone Rain on one's own
land) — is the declared single-entry exception: say so in the entry's
`classification` and write no half.

Write the pairs where the suite will run them: entries in the registry's
vocabulary (`doors.md` § Entry template), in an UNTRACKED scratch spec under
`convex/gre/ai/blade/__tests__/` (`audit-scratch.spec.ts`; the blade config
runs `__tests__/**/*.spec.ts`). It never enters a commit. Positions with a
pending decision are reached through real `setup` steps (ADR 0070 §4), never a
hand-seeded `pendingChoice`; a budget is declared BEFORE the position is tuned,
production-range (`DEFAULT_BUDGET`, 400 iterations — ADR 0070 §2); `seeds` is
three or more (ADR 0070 §3). Cards by name and seat, never by instance id.

**Done when:** every suspicion that survived writing is a pair (or a declared
Absolute Verdict) in the scratch spec, each naming its one Discriminant.

## 4. Real search — keep the red

Run every pair through `runBladeScenario` (`convex/gre/ai/blade/runner.ts`)
at its declared budget on its seeds:

```bash
L="$SCRATCHPAD/audit-run.log"; export AUDIT_OUT="$SCRATCHPAD/audit-rows.txt"; : >"$AUDIT_OUT"
bunx vitest run --config vitest.blade.config.ts convex/gre/ai/blade/__tests__/audit-scratch.spec.ts >"$L" 2>&1; echo "exit=$?"
grep -E '^(RED|TIE|GREEN) ' "$AUDIT_OUT"
```

One line per entry in `$AUDIT_OUT` (`doors.md` § The scratch spec), read as
`/bot-change` Phase 0 step 2 reads a reproduction:

| Seeds failing | Reading                                                            |
| ------------- | ------------------------------------------------------------------ |
| all           | **red** — a deterministic wrong preference. Keep it.               |
| some          | **tie** — rollout noise; report it as a tie, NEVER as a gap.       |
| none          | **green** — the Brain already answers it. Drop it; nothing to see. |

A pair is red only when its ANCHOR is red on every seed AND its half is green
on every seed: both red means the Discriminant is not what flips the move,
back to step 3. Nothing is filed on an argument from the code alone (ADR 0141
§7, ADR 0149 §2).

**Done when:** every pair has a verdict (red / tie / green) with its seed
count, and only the red ones go on.

## 5. Diagnose — four suspects, with measurements

For each red pair, rules first, then `/bot-change` Phase 0's order, each
suspect tested by its measurement, not by argument:

| Suspect                                           | Measurement                                                                                                                                                                              | Cause it names                                      |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **Rules** — the right move does not work          | play the expected move, drain the Stack (`doors.md` § Settled reading): does the board end where the CR says (`bun run cr <id>`)? If not, the Bot's pick is right in this engine         | an engine defect — the Engine door, never a stretch |
| **Enumeration** — the right move is never offered | `enumerateMoves(state, botId)` (`convex/gre/moves.ts`) on the built anchor position: is the expected move in the list? Is it legal at all?                                               | a Move never enumerated (a rules or enumerator gap) |
| **Evaluation** — the evaluator cannot see the gap | `evaluateBreakdown` (`convex/gre/evaluate.ts`) of the SETTLED position after the expected move vs the observed one (`doors.md` § Settled reading): near-equal or inverted = blind        | a missing Evaluation term, or a blind probe         |
| **Valuer sign** — no opinion on the announcement  | `OP_VALUERS` / `OP_BENEFICENCE` (`convex/gre/ai/opValuers.ts`) for the Ops in the card's script: an absent beneficence row reads `"neutral"`; a valuer at the `base + MV` floor is blind | a blind valuer, a missing `aiEffects` shadow        |

The position is the one the runner builds (`buildBladeLoadState`,
`runner.ts`); the scratch spec can print all three for a label. A pair whose
evidence fits none of the three is a search bound, not a knowledge gap: re-run
at a higher budget and record what ADR 0070 §2 asks (`passesAt`, or `sweptTo`
with the budget at which it still failed) — cause `branching`, `horizon` or
`hidden-information` (`doors.md` § Budget sweep); a blind term is `valuation`, no `passesAt`.
**A pair with no measurement behind its cause is "undiagnosed"** — say so;
it is not a worse row, it is an honest one.

**Done when:** every red pair carries a cause with the measurement that named
it, or the word `undiagnosed`.

## 6. Audit Review — print and STOP

One row per red pair, in this exact column order, then stop for the
reviewer's word per row:

```
| # | label | Discriminant | expected move | observed move (seeds n/m) | kind | cause | proposed issue |
```

- **label** — the anchor's label; the half's label on the next line of the
  cell.
- **Discriminant** — `<kind>: <detail>`.
- **observed move (seeds n/m)** — the Bot's pick, with the seeds it took it on
  over the seeds run.
- **kind** — `forced` (in the anchor the wrong move loses something the rules force — a creature, the game — AND in the half the expected move is the only one that does not, ADR 0070 §1: both entries will sit in the registry) or `preference` (better, not forced, on either side). Written as the agent's proposal; the reviewer's word decides.
- **cause** — the suspect and its measurement in six words, or `undiagnosed`.
- **proposed issue** — `new: <cause>`, `new engine: <defect>` (a Rules row),
  `existing: issue #N`, or `—`. One issue per CAUSE: rows sharing it share the cell.

Ties and dropped suspicions follow the table, one line each, outside it.

The reviewer answers one word per row: `ok` (the kind stands), `forced` /
`preference` (reclassified: the pair changes door), `reject` (lands nowhere).
On a forced-loss row `ok` is the human decision Admission needs, given early
(GLOSSARY.md Audit Review); on a preference row it is the **Attestation** the
Verdict will carry. **Nothing below runs before every row has its word.**
No word (the owner left, the session is unattended) → the table is the whole
output: end the turn with it, file nothing.

**Done when:** the table is printed and every row has the reviewer's word —
or the session has ended on the table.

## 7. Two doors — on the words only

Every action here is named by a row's word; a row with `reject` gets none.
`doors.md` holds the templates. `Target files` on every issue filed, one path
per line (the planner's blast radius); card names in issue bodies are Scryfall
links — `docs/agents/issue-tracker.md` § Card names are Scryfall links,
`bun run card:link "<Card Name>"`.

**Forced door** (`forced` + `ok`, or reclassified `forced`): the pair enters
`convex/gre/ai/blade/scenarios.ts` — anchor as a `stretch` entry carrying
`audit: { theme }`, `beyondBudget.cause` from step 5 and `issue #N` in
`beyondBudget.note`; half as its `pairOf` entry, `must` (green on every seed at budget). **Both are shown to bite** (ADR 0070 §1, `doors.md` § Forced door; say so in the PR); `auditEntryProblems` reds a bare one. The issue is
filed FIRST so the note can name it. It is red in-tree, report-only
(`test:blade:stretch`); the fix PR promotes it to `must` and removes
`beyondBudget` in one diff. All forced pairs of the session land in **one PR**
(branch, PR body with the review table and the words, `bun run land:ready`).

**Preference door** (`preference` + `ok`, or reclassified `preference`): the
pair becomes a Verdict written by the agent and **attested by the reviewer
under their own account** — never by the agent, never by CLI as admin
(Attestation is a person, ADR 0128; `verdicts.submit` is tester-gated).
`doors.md` § Preference hand-off says what to hand them. Then, in the same
session: `bun run verdicts:promote`, `bun run fit:weights`, read the
promotion's unsatisfied-pair report; commit the promotion's diff in the
session's PR (`doors.md` § Preference door). **An issue for a preference
exists only when that report names the pair's Discriminant as one no term
reads**, or when the reviewer's word asks for one — never from the code walk
(ADR 0149 §3, ADR 0148). Satisfied = not a gap = no ticket.

**Engine door** (a Rules row the reviewer keeps): one engine issue per defect,
outside the umbrella, band by the reviewer's word; the pair rides in it as
its reproducer and enters no registry (`doors.md` § Engine door).

**Issues** — one per diagnosed CAUSE, never per pair (ADR 0102, ADR 0146):
`gh issue create` with `--label bug --label area:game-bot`, `--parent 4920`
(the umbrella; read the edge back with `gh issue view <new> --json parent`),
no `## Band` (the umbrella lends P1), `model:*` by exception only — the stamp
rule is `docs/agents/triage-labels.md` § Every new issue is stamped at filing.
Body: the cause in the words of its suspect and measurement, a
`## Test Positions` block naming every entry label it owes, and the mechanical
acceptance: those entries pass as `must` at their declared budget and
`blade:robustness` classifies them `robust`. **No `ready-for-agent`**: the
owner labels what the queue takes.

**Undiagnosed** (`ok` on an `undiagnosed` row): the entry lands `stretch` with the cause the budget sweep measured, `cause undiagnosed` and `issue #4920` in its note, and the pair is appended to the umbrella's `## Undiagnosed pairs` block — never a ticket (`doors.md` § Undiagnosed pairs).

**Done when:** every row's word has had its action; the session's PR — forced pairs, the promotion's diff, or both — is handed off; preference Verdicts are attested, promoted and fitted; every cause issue is parented and read back, every engine issue banded; the undiagnosed block is appended.

## 8. Report

Six lines: theme; pairs written / red / ties; the review's words by count;
PR (handed off, or `none`); issues filed (`issue #N` each, qualified);
undiagnosed appended. Then STOP — one theme per invocation.
