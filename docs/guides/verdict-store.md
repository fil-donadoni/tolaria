# The Verdict Store

How to provision the bucket the Verdict corpus lives in, and how a deployment
and a development machine each get their credential. The decision record is
ADR 0128; the code is `convex/verdictStore.ts` (the port and its decisions),
`convex/verdictStoreGcs.ts` (the read transport),
`convex/verdictStoreGcsWriter.ts` (the write transport, deployments only) and
`scripts/lib/verdict-store.ts` (the machine reader).

## What exists

| Thing                       | Name                                                     | Lives in                                                                                                                                          |
| --------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Bucket](#g-bucket)         | `tolaria-verdict-store`                                  | the owner's GCP project, `us-central1`                                                                                                            |
| [Writer account](#g-writer) | `verdict-store-writer@<project>.iam.gserviceaccount.com` | its [key](#g-key) in the `VERDICT_STORE_WRITE_KEY` env var of each CLOUD Convex deployment — never a local backend, nowhere else                  |
| [Reader account](#g-reader) | `verdict-store-reader@<project>.iam.gserviceaccount.com` | its [key](#g-key) in `~/.config/tolaria/verdict-store-reader.json` on each development machine (`VERDICT_STORE_READ_KEY_FILE` overrides the path) |

The [bucket](#g-bucket) name is a constant (`VERDICT_STORE_BUCKET` in
`convex/verdictStoreCredentials.ts`), not an env var: it is not a secret, and a
constant cannot drift between deployments. If the name is taken when you
create the [bucket](#g-bucket), change the constant in the same PR as this
table.

**Why `us-central1`:** the Cloud Storage free tier covers only `us-east1`,
`us-west1` and `us-central1`, and the store is small.

## Two credentials, never one

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

## Rotate or revoke

`gcloud iam service-accounts keys list --iam-account=<account>` lists the
[keys](#g-key); `gcloud iam service-accounts keys delete <key-id>
--iam-account=<account>` revokes one. After revoking a writer key, set a new
one on every deployment.

## Glossary

### <a id="g-bucket"></a>Bucket

The one Google Cloud Storage bucket that holds every Verdict object,
attestation and pack (ADR 0128 §1). Private, shared by every deployment.

### <a id="g-key"></a>Key

A service account's JSON key file: the credential the code signs its OAuth
token request with. One per account per place, never shared between places.

### <a id="g-reader"></a>Reader account

The `verdict-store-reader` service account. It can read and list, nothing
more. Development machines hold its [key](#g-key).

### <a id="g-writer"></a>Writer account

The `verdict-store-writer` service account. It can create and read objects but
not delete them. Only Convex deployments hold its [key](#g-key).
