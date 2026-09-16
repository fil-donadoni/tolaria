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
   deployments without coordination. A pack, `packs/<packHash>.jsonl.gz` (the sha256 of its
   uncompressed JSONL, which the lock carries as `packHash` — issue #3581),
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
  only on development machines. (Amended by issue #3745: a third, the forward
  token, lets a deployment without the write key reach the store through the
  one that holds it — see § Amendment.) The bucket is private — verdict objects are
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

## Amendment (issue #3745, 2026-09-16): a third credential, the forward token

"Two credentials, never one" left a local backend with no way out. Judgements
are given on local backends (the owner) and on production (other testers);
both are equivalent sources. A local backend never holds the write key, so its
drain answered `skipped` and its rows stayed fat forever, and the only door out
was `verdicts:pull`, which issue #3584 retires. The owner wants the two sources
to converge in the store with no command to remember.

**Decision.** There are three credentials now. The third is a **forward
token**:

- **It is bound to ONE deployment name.** The deployment holding the write key
  keeps a list of accepted tokens, `VERDICT_STORE_FORWARD_TOKENS`: each entry
  is a deployment name and the sha256 of its token. It never keeps the token
  itself.
- **It can do one thing.** It can ask that deployment, over its
  `POST /verdicts/forward` route, to store a judgement or a resolution whose
  author is `<that deployment>:<userId>`, and whose `deployment` and
  `deploymentKind` both name that deployment.
- **It cannot** name an object (every name is derived from the content, and
  nothing is overwritten), attest as anyone on another deployment, or skip
  validation. The writer re-runs `verdicts.submit`'s checks on a judgement
  (`verdicts:forwardAdmissible`, with `submit`'s own validators) and `record`'s
  checks on a resolution.
- **It is revoked on the writer** by removing its entry. Nothing on the local
  side needs to change.

The writer uploads through the same `storeOutboxRow` / `storeResolutionRow`
its own drain uses, reads both back, and only then answers with the id.
**Origin is preserved, never rewritten to the writer.** The attestation keeps
the originating deployment, `deploymentKind: local`, `gameId`, `seq`,
`createdAt`, `botPickIndex` and the note.

A local drain holding `VERDICT_STORE_FORWARD_TOKEN` and
`VERDICT_STORE_FORWARD_URL` (and no write key) forwards every fat row. That
includes legacy unstamped rows, which are attributed `local-<port>:<authorId>`
exactly as a direct drain attributes them. It forwards the resolution outbox
the same way. A row slims only when the writer confirms the read-back of the
very verdict, position and author the row promised. A refusal or an outage
leaves the row fat, with the reason in the drain report, and the hourly cron
retries it. A re-send is harmless: object names are content-addressed and
uploads use `ifGenerationMatch=0`.

**Why not the write key.** The write key can create any object under any name
in the bucket. A leaked forward token can do much less: it can add judgements
that pass validation, attributed to its own deployment, where they are
filterable as `local` and never enter the lock without a promotion. Its reach
stays inside what a tester on that deployment could already do. It also never
puts a cloud credential on a development machine. Rejected alternatives are a
machine script holding the production deploy key (it only works while that
machine is on, and it puts the production key on it) and a write key on a
local backend (§ Consequences still forbids it).

**Consequence.** The drain picks its way by credential. The write key uploads
directly. Otherwise a forward token with the writer's URL forwards. With
neither it still answers `skipped`, naming what is missing.
