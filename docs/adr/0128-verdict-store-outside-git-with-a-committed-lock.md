# The Verdict corpus lives in a shared Verdict Store outside git; the repository keeps only the Verdict Lock

## Status

accepted (2026-09-14, "formato verdicts" grill session; extends ADR 0124,
retires the `data/verdicts/**` corpus of issue #3402)

## Context

ADR 0124 made Verdicts the training data for the evaluation's weights and
required (§3) that a fit be reproducible from a checkout: same verdicts, same
weights, to the bit. Issue #3402 met that requirement the simplest way — one
JSON file per verdict under `data/verdicts/`, pulled out of the `verdicts`
table by `bun run verdicts:pull`, with `weightFit.bot.test.ts` re-running the
fit and demanding the committed `DEFAULT_EVAL_WEIGHTS`.

That shape does not survive its own success. The corpus is 71 files averaging
5.7 KB today and the whole point is to reach thousands: a fit is only as good
as the number of positions it is constrained by. At 10,000 verdicts the
directory is ~60 MB of judgement data in a source repository, 10,000 paths in
`ls`, and a class of file that is not source at all — nobody reviews a
position by reading its JSON.

Two further facts made the shape untenable rather than merely ugly:

- **`verdicts:pull` only ever reached one deployment.** It runs
  `npx convex run` in `primaryCheckout()`, i.e. against whatever `.env.local`
  names — the dev deployment. Judgements given by testers against production
  sat in the production table with no path into the corpus at all.
- **Verdicts are about to arrive from more than one place.** Gameplay
  telemetry (judgements derived from a human player's own choices, parked for
  its own decision) would multiply the volume by an order of magnitude, from
  several deployments at once.

The repository's own precedents point both ways, deliberately: the Full
Catalogue is committed and content-addressed because a production build must
not depend on a Scryfall download, while the 24 MB oracle corpus is NOT
committed — the repo keeps `data/oracle-corpus.pin.json` and the lockfile
derived from it. Training data that grows without bound is the second case.

## Decision

1. **The Verdict Store is a single shared bucket** (Google Cloud Storage),
   written by every deployment and read by every machine. One object per
   Verdict. Being in the store is not being trusted: it holds everything ever
   submitted, validated or not.
2. **The Verdict Lock is committed, and it is what the fit reads.** A
   `data/verdicts.lock.json` naming exactly the verdict ids a fit ran over.
   ADR 0124 §3 survives intact — the lock plus the code re-derive the
   committed weights to the bit — but the bytes it names live outside the
   repository. A judgement the lock does not name is invisible to the fit
   however long it has sat in the store.
3. **Identity is the content.** An object is named `v1-<sha256>` over the
   canonicalised judgement: position, `setup`, `seat`, `candidates`, `answer`.
   Author, note, timestamps and `gameId` are NOT in the hash. The same
   judgement recorded on two deployments is one object; an altered object is a
   different name the lock does not carry, so verification is re-hashing and
   nothing else. The `v1-` prefix versions the CANONICALISATION, not the
   payload.
4. **Attestations are separate objects**, `attestations/<verdictId>/<author>`.
   A verdict with no attestation never enters the lock. Two testers agreeing
   are one verdict with two attestations — agreement is counted, never fitted
   twice. The author is `${deployment}:${userId}`, never an email: user ids
   are per-deployment, and the same person needs one identity across them.
5. **The `verdicts` table stays the intake and becomes an OUTBOX.**
   `verdicts.submit` keeps every check it has (tester gate, the scenario write
   path's own `scenarioSpecValidator`, candidate-index bounds, card-name
   resolution) — a bucket accepts any bytes, so validation must precede the
   upload, and a Node action performs it. After a confirmed, re-read upload
   the row is SLIMMED to `verdictHash`, `positionKey`, author, `createdAt`,
   `note`, `gameId`, `storedAt`. Never before: until then the row is the only
   copy of the judgement.
6. **Conflicts are quarantined, never resolved mechanically.** The position
   key — the same hash MINUS `answer` — identifies two judgements about one
   decision. Different answers under one position key mean neither enters the
   lock until a human resolves it in an admin surface that rebuilds the board.
   Averaging them would write into the weights a preference no player holds,
   and silently. The count of conflicting positions is a metric, per corpus
   and per tester, alongside the pairs the fit cannot satisfy.
7. **Promotion is automatic, review is of the DELTA.** `verdicts:validate`
   checks only mechanical things (name matches content, parses, position
   rebuilds, indexes in range); everything integral and unconflicted enters at
   the next refit. What a human reviews is the fit report in the PR — new
   pairs, unsatisfied pairs, per-weight movement, the blade `must` result —
   because per-row review does not scale to thousands and a review that does
   not scale is skipped. Widening the lock and moving `DEFAULT_EVAL_WEIGHTS`
   are ONE change: split across two merges, the guard is red in between.
8. **Schema change is an upcast at read.** The payload carries its
   `schemaVersion` and the reader applies a chain of pure functions; the object
   is never rewritten and its id never moves. A rewrite is reserved for a
   change that cannot be derived from the old bytes. This keeps a format change
   out of the lock, so it never masquerades as a corpus change, and the
   existing guard verifies it for free: an upcast that alters meaning shifts
   the pairs, the weights stop reproducing, the suite goes red.
9. **Two renderings, like the catalogue's.** The per-verdict objects are the
   WRITE form — immutable, idempotent, deduplicating, writable from several
   deployments without coordination. A pack, `packs/<lockSha>.jsonl.gz`
   written at promotion, is the READ form: one GET instead of thousands. The
   pack is derived and unbelieved — it is unpacked, each verdict re-hashed and
   checked against the lock.
10. **The gate keeps the guard and fetches on a miss.** `weightFit.bot.test.ts`
    stays in `test:bot`; on a cold machine cache
    (`~/.cache/tolaria/verdicts/`, outside every worktree, so `land` removing
    one does not re-buy the download) it fetches the pack once per lock and
    verifies its hash. That is a pinned, content-addressed fetch: the outcome
    is decided by the committed lock, not by the network, which is the
    property "offline by contract" exists to protect. `verdicts:sync` warms it
    explicitly; `worktree:init` is untouched — a bootstrap must not buy an
    artefact the session may never use.
11. **Explicit and implicit sources are distinguished from the start.** The
    quarantine of §6 applies to judgements a person GAVE. A judgement inferred
    from play (telemetry) is "the move chosen", not "the move that is right":
    two good moves in one position are normal, so those need aggregation and a
    reduced trust weight, not quarantine. The distinction is recorded now so
    the corpus need not be re-sorted later.
12. **The in-play quiz may reveal the deciding seat's hand**, behind a toggle
    that states what it costs: the match becomes a debugging session, not a
    game. A judgement about a land drop is worthless without the hand it
    enables. The tester's own hand is the residual hazard — it is information
    the Bot did not have, and a judgement resting on it teaches the evaluation
    a preference it can never justify (ADR 0124: hidden information is outside
    what a fit can do).

## Consequences

- `data/verdicts/**`, `bun run verdicts:pull`, `scripts/lib/verdicts-file.ts`
  and the directory arm of `fileSource.ts` are removed. The blade registry
  stays exactly as it is: those verdicts are code, derived from scenario
  `moves` expectations.
- The migration proves itself: load all 71 files (the hand-authored one
  attested to its author), write the first lock, re-run the fit. Weights
  identical to the bit means nothing was lost.
- The repository stops growing with the corpus. It grows with the LOCK —
  ~70 bytes per verdict, append-only, ~700 KB at 10,000.
- Two credentials, never one: write lives only in deployment env vars, read
  only on development machines. The bucket is private — verdict objects are
  anonymous, but attestations name users.
- A surface is owed that rebuilds a position from its spec and shows the
  deciding hand and the candidates. It serves three purposes — resolving
  conflicts, re-judging quarantine, judging cold — which is why it is one
  surface and not three.
- Per-tester quality becomes measurable for the first time: how many of a
  person's judgements were contradicted, quarantined, or left unsatisfied by
  the fit. The last of those does not simply mean "judged badly" — it is also
  how a missing term in the evaluation announces itself (ADR 0124 §3).
- What is NOT decided here: gameplay telemetry as a Verdict source (§11 only
  reserves its shape), and the promotion command's own workflow.
