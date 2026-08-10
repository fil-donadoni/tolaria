# ADR 0098 — The Comprehensive Rules are vendored from the official Wizards document and sliced locally

**Status:** Accepted (2026-08-10)

## Context

ADR 0004 settled _which_ rules text wins (modern Oracle + current CR). It never
settled _where that text comes from_, and the answer drifted into three
different habits, all of them wrong in a different way:

1. **Third-party mirrors.** `/mtg-rules-check` named `yawgatog.com` as the
   fetch target, and the permission allowlists also carried
   `ancestral.vision` — a site whose own home page says it is current as of
   **7 October 2022**, i.e. roughly four years of rules changes behind. A
   mirror can be current (yawgatog happens to track the official document),
   but nothing in the workflow _checked_, so the freshness of a citation was a
   property nobody could see.

2. **Ad-hoc `curl` of a remembered CR URL.** The transcripts of past sessions
   show **12 distinct `MagicCompRules YYYYMMDD.txt` URLs** fetched into
   per-session scratchpads — including `20220908`, `20240517`, `20240607`,
   `20250207`, `20250606`, `20250725`, `20250919`, `20250926`, `20260213`,
   `20260227`, `20260619`. Each session guessed a filename from model memory,
   re-downloaded ~1 MB, and threw it away at session end. A session that
   guessed `20240517` was reading rules **two years stale** and had no way to
   know.

3. **Model memory.** A CR-citation sweep of the whole repo (23,281 citations,
   799 distinct rule ids) found **42 ids that do not exist** in the current
   document — and cross-checking them against the 2022 and 2025 revisions
   showed that 40 of the 42 never existed in _any_ of them. They are recalled,
   not read. (The two genuine renumberings are `701.16b` and `712.1a`, valid in
   2022, gone by 2025.)

The trigger for fixing this was a real rules change nobody had noticed: CR
605.1a now ends "**…and its cost and effect don't move any card to or from a
library**". An ability that would otherwise be a mana ability but draws, mills,
or tutors is no longer a mana ability — it uses the stack and can be responded
to. That clause is absent from any pre-2026 CR the sessions had been reading.

Cost mattered too. A CR lookup happens dozens of times per card. Fetching
`yawgatog.com/resources/magic-rules/` pulls a **2.1 MB** page through the
fetch-summarizer to return, on average, ~156 tokens of answer (measured over 21
such fetches in past transcripts) — and the summarizer's input is billed but
never appears in the transcript, so the waste is invisible to any
context-window accounting. The `#R605` anchor does not help: anchors are
client-side, the whole document is fetched either way.

## Decision

**The official Wizards Comprehensive Rules document is the single rules source,
vendored into the repo and read locally.**

- `data/cr/comprehensive-rules.txt` — the official `.txt`, verbatim.
- `data/cr/VERSION.json` — effective date, source URLs, sha256, vendored date.
- `scripts/cr.ts` (`bun run cr`) — slices it: `cr 605.1a` prints exactly that
  subrule, `cr 605` the whole section, `cr grep <regex>` the matching rule ids,
  `cr glossary <term>` a glossary entry. Offline, so it works in agents with no
  WebFetch permission.
- `bun run cr:check` / `bun run cr:sync` — the only online commands: scrape
  <https://magic.wizards.com/en/rules> for the newest published document,
  compare effective dates, download and re-stamp `VERSION.json`.

**Mirrors are removed, not demoted.** `yawgatog.com` and `ancestral.vision` are
gone from the skills' `allowed-tools` and from the permission allowlists;
`/mtg-rules-check` now instructs Bash-slicing the vendored file. Scryfall stays
— it is the Oracle-text source (ADR 0004), a different question.

**Never cite a rule number that has not been printed.** If `bun run cr <id>`
says the rule does not exist, the citation is wrong; find the real one with
`bun run cr grep`. `bun run cr:lint` sweeps the repo for citations that do not
resolve against the vendored document; since issue #2429 it is **part of
`check:guards`** (and therefore of `bun run check:pr`), with
`scripts/__tests__/cr-citations.test.ts` running the same scan inside the node
project so the guard survives the gate wiring being changed.

**What the linter cannot check.** It only asks whether an id RESOLVES. A
citation repointed to a plausible-but-wrong number passes it silently, and the
repo still contains such cases outside the #2429 sweep — see
`docs/findings/2429-resolvable-but-wrong-cr-citations.md`. It is also
line-based and requires the `CR ` prefix, so a bare id in a slash-list
(`CR 707.10b / 114.6`) or a citation wrapped across two comment lines is
invisible to it; #2429 fixed 167 such occurrences by hand.

## Consequences

- A CR lookup costs the tokens of the rule it returns (~120 for a subrule) and
  nothing else. No fetch-summarizer pass, no network, no per-session
  re-download.
- The rules revision in force is a **committed fact** (`VERSION.json`), not a
  per-session accident. Two agents in two worktrees read the same text.
- Updating the CR becomes an explicit, reviewable commit: `bun run cr:sync`,
  diff the document, re-verify the mechanics the diff touches. The staleness
  question moves from "did this agent happen to fetch a fresh copy" to "is the
  committed revision the published one", which `cr:check` answers in one call.
- Cost: ~976 KB of text in the repo, and a manual sync step Wizards' cadence
  (roughly per set release) makes necessary. Both are accepted; the alternative
  is what section 2 of the Context describes.
- `bun run cr:check` is **not** wired into `check:all` — the gate is offline by
  contract, and a network call there would make it flaky. It is run when rules
  work starts after a set release.

## Related

- ADR 0004 — modern Oracle text and current CR (the _what_; this ADR is the
  _where_)
- CR 605.1a (2026-08-07) — the mana-ability/library clause that surfaced this
