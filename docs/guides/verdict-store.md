# The Verdict Store

How to provision the bucket the Verdict corpus lives in, and how a deployment
and a development machine each get their credential. The decision record is
ADR 0128; the code is `convex/verdictStore.ts` (the port and its decisions),
`convex/verdictStoreGcs.ts` (the read transport),
`convex/verdictStoreGcsWriter.ts` (the write transport, deployments only),
`scripts/lib/verdict-store.ts` (the machine reader) and
`scripts/lib/verdict-pack-cache.ts` (the [pack](#g-pack) and the
[machine cache](#g-machine-cache)).

## What exists

| Thing                       | Name                                                     | Lives in                                                                                                                                                                                                                                       |
| --------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Bucket](#g-bucket)         | `tolaria-verdict-store`                                  | the owner's GCP project, `us-central1`                                                                                                                                                                                                         |
| [Writer account](#g-writer) | `verdict-store-writer@<project>.iam.gserviceaccount.com` | its [key](#g-key) in the `VERDICT_STORE_WRITE_KEY` env var of each CLOUD Convex deployment — never a local backend, nowhere else                                                                                                               |
| [Reader account](#g-reader) | `verdict-store-reader@<project>.iam.gserviceaccount.com` | its [key](#g-key) in `~/.config/tolaria/verdict-store-reader.json` on each development machine (`VERDICT_STORE_READ_KEY_FILE` overrides the path); optionally a separate one in a local backend's `VERDICT_STORE_READ_KEY` env var, for review |

The [bucket](#g-bucket) name is a constant (`VERDICT_STORE_BUCKET` in
`convex/verdictStoreCredentials.ts`), not an env var: it is not a secret, and a
constant cannot drift between deployments. If the name is taken when you
create the [bucket](#g-bucket), change the constant in the same PR as this
table.

**Why `us-central1`:** the Cloud Storage free tier covers only `us-east1`,
`us-west1` and `us-central1`, and the store is small.

## Two credentials, never one — and a forward token

(ADR 0128 was amended by issue #3745: a third credential, the
[forward token](#g-forward-token), is described in
[Local backend: the forward token](#local-backend-the-forward-token).)

- The [writer account](#g-writer) holds `roles/storage.objectCreator` and
  `roles/storage.objectViewer` on the [bucket](#g-bucket). It can create and
  read; it cannot delete, and so it cannot overwrite either. Its uploads also
  carry `ifGenerationMatch=0`, so an existing name answers "exists" instead of
  being replaced.
- The [reader account](#g-reader) holds `roles/storage.objectViewer` only. Its
  token is also minted with the `devstorage.read_only` scope, so it cannot
  write even if it is granted more by mistake.
- Each side refuses the other side's [key](#g-key) by its service-account
  name. A development machine pointed at the writer's [key](#g-key) fails when
  the store is built, not later.
- `scripts/__tests__/verdict-store-credentials.test.ts` reds if anything under
  `scripts/` or `src/` imports or names the write path. That is a tripwire
  against an accidental reach, not the boundary: the boundary is that no
  development machine holds the writer's [key](#g-key).

## Provision (once, by the owner)

```bash
PROJECT=<gcp-project-id>
BUCKET=tolaria-verdict-store
W=verdict-store-writer@$PROJECT.iam.gserviceaccount.com
R=verdict-store-reader@$PROJECT.iam.gserviceaccount.com

# 1. A private bucket: uniform access, public access prevention enforced.
gcloud storage buckets create gs://$BUCKET --project=$PROJECT \
  --location=us-central1 --uniform-bucket-level-access \
  --public-access-prevention

# 2. The two service accounts.
gcloud iam service-accounts create verdict-store-writer --project=$PROJECT
gcloud iam service-accounts create verdict-store-reader --project=$PROJECT

# 3. Their grants — on the bucket, never on the project.
gcloud storage buckets add-iam-policy-binding gs://$BUCKET \
  --member=serviceAccount:$W --role=roles/storage.objectCreator
gcloud storage buckets add-iam-policy-binding gs://$BUCKET \
  --member=serviceAccount:$W --role=roles/storage.objectViewer
gcloud storage buckets add-iam-policy-binding gs://$BUCKET \
  --member=serviceAccount:$R --role=roles/storage.objectViewer
```

If [key](#g-key) creation is refused, the organisation policy
`iam.disableServiceAccountKeyCreation` is on for the project.

### Check that the bucket is private

```bash
gcloud storage buckets describe gs://$BUCKET \
  --format='value(public_access_prevention,uniform_bucket_level_access)'
# expect: enforced  True
curl -s -o /dev/null -w '%{http_code}\n' \
  "https://storage.googleapis.com/storage/v1/b/$BUCKET/o"
# expect: 401 (no anonymous listing)
```

## Deployment: the write key

Run this only for **cloud** Convex deployments: production, and a cloud dev
deployment if you have one. The [key](#g-key) goes into the deployment's
environment and the local file is deleted straight away:

```bash
gcloud iam service-accounts keys create writer.json --iam-account=$W
bunx convex env set --prod VERDICT_STORE_WRITE_KEY "$(cat writer.json)"
rm writer.json
```

**Never a local backend.** A bare `bunx convex env set` targets whatever
`CONVEX_DEPLOYMENT` in `.env.local` names, and when that is `local:…` the
backend and its environment live on this machine's disk, which puts the
writer's [key](#g-key) on a development machine. A local deployment simply has
no write key, so it cannot upload. Never put the key in `.env.local` or any
other file in a checkout either.

## How a judgement reaches the bucket

The `verdicts` table is an [outbox](#g-outbox) (issue #3580, ADR 0128 §5):

1. `verdicts:submit` validates the judgement and writes the row FAT, stamped
   with its verdict id, its position key and the
   [attestation](#g-attestation) author `${deployment}:${userId}`.
2. It schedules `verdictsDrain:drain`, which uploads the verdict object and
   then its [attestation](#g-attestation), reads both back, and only then
   slims the row to its hashes and provenance (`storedAt` set).
3. A row whose upload failed or did not read back stays fat with no
   `storedAt`. The hourly cron runs the drain again; nothing needs doing by
   hand.

On a deployment without the write [key](#g-key) — every local backend — the
drain FORWARDS instead when it holds a [forward token](#g-forward-token)
(issue #3745): each fat row goes to the writer deployment, which checks it
again, uploads it, reads it back and answers. The row slims only after that
answer, and the [attestation](#g-attestation) keeps its local origin
(`local-<port>:<userId>`, `deploymentKind: local`). A deployment with neither
credential answers `skipped`, and its rows stay fat.

**Bulk upload** (the migration's door): an admin calls
`verdicts:enqueueBulk` with the judgements and their attestation authors, then
`verdictsDrain:drainNow`, which drains at once and returns every row stored and
every row left pending, with the reason. Both run on the deployment holding the
write [key](#g-key); `drainNow` throws if it holds none.

## Contested positions and their resolutions

Two judgements about one position with different answers keep each other out
of the Verdict Lock until an admin decides (issue #3582, ADR 0128 §6). The
decision is a [resolution](#g-resolution), and it is resolved at
`/admin/verdicts`:

1. The page lists every contested position and every resolved one. On a
   deployment holding the write [key](#g-key), or a local backend holding the
   reader [key](#g-key) in its environment (issue #3746), it reads the whole
   [bucket](#g-bucket) plus the rows its [outbox](#g-outbox) has not stored
   yet, one verdict per id. With neither, it reads the [outbox](#g-outbox)
   alone and says so. See
   [Local backend: review the whole store](#local-backend-review-the-whole-store).
2. Opening a position rebuilds the board from its spec with the deciding
   seat's hand, lists the candidates, and shows the answers side by side with
   everyone who gave each.
3. **Record resolution** needs a choice — one answer is right, or none is —
   and a reason for every answer not accepted. It is refused if the position
   gained an answer since the page loaded: reload and decide again.
4. The [resolution](#g-resolution) is written to the `verdictResolutions`
   table and uploaded by the same drain as the verdicts, to
   `resolutions/<positionKey>/<resolutionId>`, then read back before the row
   is marked stored.

Nothing is deleted. The rejected verdict and its
[attestation](#g-attestation) stay in the [bucket](#g-bucket); a later answer
at the same position reopens it, and changing your mind is a newer
[resolution](#g-resolution), never an edit.

The same page opens any single verdict by id to judge it cold. That judgement
goes through `verdicts:submit` like a quiz answer: agreeing attests the
verdict, disagreeing contests the position.

## Local backend: the forward token

A local backend never holds the write [key](#g-key). With a
[forward token](#g-forward-token), its drain sends each judgement and each
[resolution](#g-resolution) to the deployment that does, so the local and the
production judgements end up in the same [bucket](#g-bucket) with no manual
step (issue #3745, ADR 0128 § Amendment).

**What the token can do.** It can ask the writer to store a judgement or a
resolution authored `<its deployment>:<userId>`, from that deployment. The
writer runs `verdicts:submit`'s checks again, and it refuses any other author
and any other deployment. The token cannot name an object, cannot overwrite
one, and is not the write [key](#g-key).

**Mint one** for a local backend, on the machine that runs it. Its
deployment name is `local-<port>`, for example `local-3210`:

```bash
T="$(openssl rand -hex 32)"
printf %s "$T" | shasum -a 256   # the sha256 the writer keeps
```

**Register it on the writer.** `VERDICT_STORE_FORWARD_TOKENS` is a JSON array
of every accepted token. Setting it replaces the whole list, so read the
current value first and add your entry to it:

```bash
bunx convex env get --prod VERDICT_STORE_FORWARD_TOKENS
bunx convex env set --prod VERDICT_STORE_FORWARD_TOKENS \
  '[{"deployment":"local-3210","sha256":"<the sha256 above>","resolutions":true}]'
```

`"resolutions": true` lets the token forward the [resolutions](#g-resolution)
recorded on that backend as well. Only the writer's owner decides that, and
it gives a resolver's power: leave it out for a backend whose admins should
not decide contested positions for everyone. Every local backend on the
default port is named `local-3210`, so tokens for different machines on that
port share one identity.

**Set it on the local backend**, in the backend's environment and never in a
file in a checkout. Run this from the checkout whose `.env.local` names the
`local:…` deployment, so the bare `env set` targets the local backend:

```bash
bunx convex env set VERDICT_STORE_FORWARD_TOKEN "$T"
bunx convex env set VERDICT_STORE_FORWARD_URL https://<writer>.convex.site
unset T
```

The next drain forwards every fat row, including rows written before the
outbox. The hourly cron runs one anyway. A refused row stays fat, and the
drain report gives the reason: `forward refused (401)` means the token,
`(403)` an author or deployment outside it, or a resolution from a token
without `"resolutions": true`, and `(422)` a judgement `submit` would refuse or
a date past the writer's clock. A writer outage, or one that takes longer than 30 s,
leaves the rows fat for the next hour's retry.

**Revoke it** on the writer: remove its entry from
`VERDICT_STORE_FORWARD_TOKENS` and set the list again. From then on the route
answers 401 to that token. On the local backend,
`bunx convex env remove VERDICT_STORE_FORWARD_TOKEN` stops the forwarding.

## Local backend: review the whole store

A local backend's `/admin/verdicts` sees the judgements testers gave on
production only if it can read the [bucket](#g-bucket). Give it the reader
[key](#g-key) in its environment (issue #3746). Reading is what a development
machine already holds (ADR 0128), and the reader account cannot write. Run
this from the checkout whose `.env.local` names the `local:…` deployment, so
the bare `env set` targets the local backend:

```bash
gcloud iam service-accounts keys create reader-backend.json --iam-account=$R
bunx convex env set VERDICT_STORE_READ_KEY "$(cat reader-backend.json)"
rm reader-backend.json
```

It is a [key](#g-key) of its own, like every place's, so revoking it touches
neither the machine's file nor any other backend. It lives in the backend's
environment and never in a checkout. The review then reads the
whole [bucket](#g-bucket) plus the backend's own rows not yet forwarded,
deduplicated by verdict id. A position contested between a local judgement
and a production one shows up with both. The writer's [key](#g-key) is
refused under that name by its service account (`VERDICT_STORE_READ_KEY holds
the verdict-store-writer service account`), so it cannot be put there by
mistake. `bunx convex env remove VERDICT_STORE_READ_KEY` goes back to the
outbox-only review.

## Development machine

Each machine gets its own reader [key](#g-key), stored outside every checkout
so no worktree or `land` teardown ever holds it:

```bash
mkdir -p ~/.config/tolaria
gcloud iam service-accounts keys create \
  ~/.config/tolaria/verdict-store-reader.json --iam-account=$R
chmod 600 ~/.config/tolaria/verdict-store-reader.json
```

A missing file fails with the path it looked in and a pointer to this section.

## Machine cache

A fit reads the corpus the committed Verdict Lock names from ONE
[pack](#g-pack), `packs/<packHash>.jsonl.gz`, kept in the
[machine cache](#g-machine-cache) at
`~/.cache/tolaria/verdicts/packs/<packHash>.jsonl.gz`.

- A warm [machine cache](#g-machine-cache) makes no network call and needs no
  reader [key](#g-key).
- A cold one fetches the [pack](#g-pack) once with the reader [key](#g-key)
  and keeps it only after verifying it: its text hashes to the lock's
  `packHash`, it carries exactly the lock's verdict ids, and every verdict
  re-hashes to its id.
- About to lose connectivity? `bun run verdicts:sync` warms the
  [machine cache](#g-machine-cache) for the checkout's lock. Re-running it is
  a no-op.
- There is nothing to clear, ever: a new corpus is a new `packHash`, so a new
  file. Deleting the directory only costs the next run one download.
- `bun run worktree:init` never warms it.

## Promote the corpus

The [bucket](#g-bucket) holds everything ever submitted; the committed
`data/verdicts.lock.json` names what a fit runs over. Two commands move one
into the other (issue #3583, ADR 0128 §7).

`bun run verdicts:validate` is read-only and needs only the reader
[key](#g-key). It lists every verdict object that is not promotable and
exactly why: not what its name promises, unloadable, a position that no
longer rebuilds, no [attestation](#g-attestation), attested only implicitly,
or contested.

`bun run verdicts:promote` is a [promotion](#g-promotion). It needs the reader
[key](#g-key) and a deploy key (`CONVEX_DEPLOY_KEY`) for the deployment
holding the writer's [key](#g-key):

1. Every promotable verdict enters the lock: the verdicts already locked keep
   their order, new ones are appended.
2. `verdictsPack:writePack` builds and stores the [pack](#g-pack) on the
   deployment. This machine checks the hash it reports and reads the
   [pack](#g-pack) back before believing it.
3. The lock and `DEFAULT_EVAL_WEIGHTS` are written together. The guard
   (`weightFit.bot.test.ts`) is red on a checkout holding one without the
   other, so commit both in one PR.
4. The blade `must` tier runs on the new weights.

It prints the report the PR carries: new Eval Pairs, the pairs the fit could
not satisfy, how far each weight moved, and the blade `must` result.
Re-running with nothing new is a no-op and rewrites nothing.

`verdictsPack:writePack` ships with a release: a [promotion](#g-promotion)
never pushes code to the deployment.

## Per-tester quality

`bun run verdicts:testers` prints four numbers per person (issue #3585, ADR
0128). It is read-only and needs only the reader [key](#g-key):

- **given**: the positions the person judged.
- **contradicted**: the positions where someone else gave a different answer,
  resolved or not.
- **quarantined**: the positions the person judged that are contested now.
- **unsatisfied**: the positions where a verdict the person gave is in the
  Verdict Lock and the committed weights leave one of its pairs unsatisfied.

Under each number it lists the positions behind it, with the verdict ids to
open at `/admin/verdicts`. The unsatisfied count is a list of positions worth
looking at. It does not score the judge: a pair the fit cannot satisfy is as
often a term the evaluation lacks as a wrong judgement. With no lock
committed it prints "not measured".

Nothing is counted and stored. Each run reads the [bucket](#g-bucket) and the
committed lock, then re-derives the unsatisfied pairs at the committed weights,
as `verdicts:promote` reports them.

One person with accounts on several deployments is several authors until an
[alias](#g-alias) joins them. Record one on the deployment holding the writer
[key](#g-key):

```bash
npx convex run verdictAuthorAliases:record \
  '{"authors":["<deployment>:<userId>","<deployment>:<userId>"]}'
```

Aliases chain: joining A to B and B to C makes one person. The person is shown
under the smallest of their authors.

## Rotate or revoke

`gcloud iam service-accounts keys list --iam-account=<account>` lists the
[keys](#g-key); `gcloud iam service-accounts keys delete <key-id>
--iam-account=<account>` revokes one. After revoking a writer key, set a new
one on every deployment. A [forward token](#g-forward-token) is revoked on
the writer, by removing its entry from `VERDICT_STORE_FORWARD_TOKENS`
([Local backend: the forward token](#local-backend-the-forward-token)).

## Glossary

### <a id="g-alias"></a>Alias

Two authors who are one person, at `aliases/<author>/<author>` (the two
sorted). Kept in the [bucket](#g-bucket) and never in git, because the
repository is public. An alias is never retracted.

### <a id="g-attestation"></a>Attestation

One author's word for one stored verdict, at
`attestations/<verdictId>/<author>`: who (`${deployment}:${userId}`, never an
email), when, the note, and the deployment it came from. Two testers agreeing
are one verdict object with two attestations.

### <a id="g-outbox"></a>Outbox

The `verdicts` table since issue #3580: a row holds a judgement only until the
drain has stored it in the [bucket](#g-bucket) and read it back.

### <a id="g-bucket"></a>Bucket

The one Google Cloud Storage bucket that holds every Verdict object,
attestation and pack (ADR 0128 §1). Private, shared by every deployment.

### <a id="g-forward-token"></a>Forward token

The third credential (issue #3745). It is a random secret bound to one
deployment name on the writer deployment, which keeps only its sha256. It
lets a deployment without the write [key](#g-key) have its own judgements and
resolutions stored, and nothing else.

### <a id="g-key"></a>Key

A service account's JSON key file: the credential the code signs its OAuth
token request with. One per account per place, never shared between places.

### <a id="g-machine-cache"></a>Machine cache

`~/.cache/tolaria/verdicts/`: the [packs](#g-pack) this machine has fetched,
each under its store name. Outside every checkout, so removing a worktree
never re-buys a download.

### <a id="g-pack"></a>Pack

One object holding every verdict a Verdict Lock names, one JSON line each,
gzipped and named by the sha256 of its uncompressed text. The read form of
the corpus: one fetch instead of one per verdict. Never trusted for being in
the [bucket](#g-bucket) — it is verified against the lock on every read.

### <a id="g-promotion"></a>Promotion

One run of `bun run verdicts:promote`: the verdicts in the
[bucket](#g-bucket) that load, rebuild, are attested and are not contested
enter the Verdict Lock, their [pack](#g-pack) is stored, and the committed
weights are refitted — one change, reviewed as its delta.

### <a id="g-resolution"></a>Resolution

An admin's decision about a contested position, at
`resolutions/<positionKey>/<resolutionId>`: the accepted verdict (or none), a
reason for each rejected one, and who decided. Named by the decision itself,
so it is immutable like every other object in the [bucket](#g-bucket).

### <a id="g-reader"></a>Reader account

The `verdict-store-reader` service account. It can read and list, nothing
more. Development machines hold its [key](#g-key).

### <a id="g-writer"></a>Writer account

The `verdict-store-writer` service account. It can create and read objects but
not delete them. Only Convex deployments hold its [key](#g-key).
