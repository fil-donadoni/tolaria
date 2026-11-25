# The Bot's search stays on the client: the server is not a faster device

## Status

accepted (2026-11-16, owner ruling on issue #9529, PRD issue #9525). Amends
ADR 0000: the decision it took (the Brain runs on the player's
device) stands; the reason it gave for rejecting a server Brain (cost, never
measured) is replaced by a measured one (speed). Amended 2026-11-25
(Amendment I, PRD issue #10240): the game-end Verdict judge moves back to the
client.

## Context

ADR 0000 put the Brain in a Web Worker on the player's device and rejected a
"Brain in a Convex action" because it "adds per-move server compute". That
cost was never measured, and neither was what the client search delivers off
the development machine. PRD issue #9525 measured three things to decide it
again:

- **The field** — every vs-Bot game reports its searches (issue #9526).
- **The lab** — a bench in three browser engines and a profile of one
  iteration (issue #9527, `docs/research/brain-search-off-the-dev-machine.md`).
- **A server pilot** — the game-end judge moved to a Convex action, at no
  gameplay risk, as the instrument for a server search (issue #9528).

Every number this record relies on is in
`docs/research/brain-search-in-the-field.md` (dated 2026-11-16) or in the lab
note; the sections cited below are that field note's. In short:

- **The clock decides almost every search** (§ 1). At `expert` the Bot
  completes about a quarter of its iterations in Chromium, a sixth in WebKit, a
  twentieth in Gecko, on 5–8-core desktops. In the field the presets differ by
  their time caps only.
- **The server is not faster** (§ 2). In the same games the default-runtime
  judge spent 2.6–11 times Chromium's time per iteration and about the same
  as Gecko's and WebKit's; 40 of its 100 searches hit its 30 s backstop.
- **Cost is small in every option but one** (§ 3); concurrency, not compute,
  is what would first force a plan change.
- **Where the time goes** (lab § 5): applying moves through the real engine is
  a third to a half of a search, state-based actions alone a fifth to a
  quarter, cloning plus garbage collection 15–29%; no function outside those
  passes a few percent.
- **A phone cannot be told from a desktop** (§ 4): one of the two WebKit
  games was an iPhone, and its report says `mobile: false`.

## Decision

### Client — kept

The Brain keeps searching on the player's device, under the time cap. The
mitigation the profile supports is engine work in place:
`checkStateBasedActions` (a fifth to a quarter of every search) and allocation
(cloning plus collection). Its ceiling is well short of an order of
magnitude, and the field gap is four to twenty times; the work is worth doing
because every option, server included, runs the same engine code, so a faster
engine is the one gain no placement can buy.

**Verdict: keep the Bot on the client; spend the effort on the engine's hot
path and on knowing what the shallower field Bot loses.**

### Hybrid — rejected

A hybrid hands a slow device's search to the server. The measured server is
itself a slow device: at the same 3.3 s it completes an estimated 42–220
iterations (§ 3, derived), below desktop Chromium's 313 and around WebKit's 200. The threshold that would define "slow" is a client slower than the
server's own worst reading, about 80 ms per iteration; in the field only
late-game Gecko reports cross it, and on the server's slow morning (§ 2) the
server crossed it too. It would add a round trip, a second code path, and a
Bot whose strength depends on the server's load.

**Verdict: rejected — there is no faster machine to hand the slow device's
search to.**

### Server — rejected

Every consult a server action. At the client's time cap it is no deeper than
the client and 0.2–1.0 s slower per move. At the full 1320 iterations it is as
deep as the blade suite assumes, at 20–103 s per Bot move — not a game anyone
plays — and it is the one option whose concurrency forces a plan change at a
hundred times today's volume (§ 3). Its cost, $5–262 a month at that volume
depending on depth, is not what rejects it.

**Verdict: rejected — on speed, not on cost.**

### Engine rewrite (Rust / WebAssembly) — not now

The profile names no small piece to port: every bucket is engine code
(resolution, state-based actions, triggers, layers, enumeration, evaluation),
so a faster language helps only by porting the rules engine itself. It would
remove most of the allocation share and run the rest faster by a factor this
project has not measured. It would also cost the card pipeline its single
authority: cards are data run by the TypeScript interpreter and compiled by a
grammar that emits TypeScript definitions, and protocol cards carry
`resolve()` closures — a second engine is the "two rule engines that diverge"
ADR 0000 rejected, and a replacement re-implements every Op and closure. The
field gap (four to twenty times) is larger than any rewrite's plausible gain,
so a rewrite alone would not close it.

**Verdict: no rewrite. Reopened only if in-place engine work is exhausted and
the field ratio is still below a third.**

### Reopening this record

Reopen it when a server search is measured at a third or less of desktop
Chromium's time per iteration on the same games (a Node-runtime action is the
untried candidate, field note § 4), or when phone reports show a device class
the client cannot serve at all.

**Tested 2026-11-20 (issue #10030): not reopened.** In production a
Node-runtime action searched at 54 ms or more per iteration where Chromium, in
the same games, spent 17–23 ms: three to four times slower, not a third. The
owner ruled the judge a budget the default runtime finishes (200 iterations)
and the Node variant removed (`docs/research/judge-runtime-verdict.md`).

## Consequences

- **The judge stays on the server** (superseded by Amendment I). Issue #9528's move stands on its own
  ground — it took the second Worker off the player's device — but its 40%
  backstop rate means a review loses two decisions in five. That is the
  judge's problem, and the follow-up owns it.
- **The blade suite proves a Bot the field does not run.** `must` entries are
  searched at iteration budgets the field never completes; which of those
  decisions the field Bot gets wrong is unknown.
- **Difficulty presets are time presets in the field.** Their iteration
  budgets bind only in the opening.
- **The follow-up PRD** this record implies, "the Bot's depth in the field":
    1. Run the blade at field-calibrated budgets (the field's iterations per
       search for each engine family) and name the decisions lost.
    2. Engine hot path: state-based actions and allocation, each change
       measured by the field ratio, not by the lab.
    3. Presets re-derived from the field: whether `expert` should think longer
       (its cap is 3300 ms against a 5000 ms consult timeout), and what
       separates the presets when the clock binds.
    4. Telemetry: one report per game across driver remounts; a mobile flag
       that is true on an iPhone and an iPad; a report that survives a mobile
       tab going to the background.
    5. The judge: a Node-runtime measurement of the same searches (also the
       reopening test above), or a judge budget the default runtime finishes.
- **ADR 0000's cost argument is retired.** Its "zero extra cost" consequence
  still describes the Bot; it no longer decides where the Bot runs.

## Amendment I — the Verdict judge moves back to the client (2026-11-25, PRD issue #10240, issue #10241)

Decision: the game-end Verdict judge searches on the tester's own device, on
Workers of its own. The decisions above on the Bot's search stand unchanged.

**Why.** The server kept losing on the number this record is about. In a
production game (`jh74hw4er2535xmcx564v0scr18jg423`, Node runtime) it searched
at about 62 ms per iteration — 24,966 ms per consult at p50 — and the field
note measured 15–78 ms in the default runtime, against 1.4–13.6 ms for the
same engine in desktop Chromium
(`docs/research/brain-search-in-the-field.md` § 2). One consult after the
other, that is about two minutes after the last move; with the tab suspended
one round trip took 28.5 minutes. No tester waits for that, so the review was
unreachable.

**What the move may not bring back.** Two faults of the judge's earlier life
on the client. First it shared the Bot's Worker, which serves one request at a
time and never cancels one, so a slow device's judge searches stood in front of
the next game's Bot (issue #9514). Then, on a Worker of its own, it went on
grinding on that device after the game was left, beside the next game's Bot,
which is why issue #9528 moved it to the server. So:

- **Its own Workers** (`src/lib/ai/judge-brain.ts`): never the Bot's queue,
  its respawn budget, its decision ring or its in-thread fallback. Primed with
  the judged seats' Definition Manifests, as the Bot's Worker is with its own.
- **Concurrent, one search per Worker**: all sampled decisions are asked at
  once and run on the device's cores but one, four at most, two on a phone or
  tablet. What does not fit waits on the page, not in a Worker.
- **Reproducible**: the fixed iteration budget and seed, no clock in the
  search, and no smaller-budget fallback, so the same position has the same
  answer on every device and the answer the server gave. The per-consult
  timeout (2 s per iteration, above Gecko's p90 field reading, 1,658 ms) only
  gives up a Worker that is wedged; a suspended tab re-arms it.
- **A failure costs the review only**, counted per outcome in the proposal
  counts. A list whose every decision went unanswered is not kept, so a
  reload asks again.
- **Leaving the game stops the Workers at once**: the next game's Bot has the
  device to itself.

**The Bot's busy signal.** The Bot's Brain channel says when a consult is in
flight (`isBrainBusy`, `onBrainBusyChange`), for a judge that works during the
game (issue #10242). The server judge, left with no caller, is removed
(issue #10243): its action and guard are gone, and its two counter tables are
emptied in every deployment before the schema drops them.

**Accepted.** A slow device's review is slow: at Gecko's field rates a search
takes a minute or more. Judging during play is the answer to that (issue
#10242), not a smaller budget.
