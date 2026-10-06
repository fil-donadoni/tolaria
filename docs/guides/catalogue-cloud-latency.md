# Catalogue cloud latency

How to measure what a request pays for the catalogue on Convex **cloud**, with
`bun run perf:catalogue-cloud` (issue #4167, PRD issue #4161, ADR 0113
Amendment III § Decision 5). Run it when a change could move the
[packed corpus](#g-packed-corpus)'s cost: a new [block size](#g-block-size), a
different dictionary, a new inflate library, a much bigger catalogue.

It is a measurement, never a gate: no suite and no `check:*` runs it, and no PR
waits on it.

## Why cloud, and why a throwaway deployment

The [latency budget](#g-latency-budget) is judged on cloud only: cloud CPU
measured ~2x slower than the dev machine, and only cloud is what a player feels.
The script therefore refuses to print a [verdict](#g-verdict) unless the
deployment itself reports a `*.convex.cloud` URL — a local or self-hosted
backend answers with its own address and gets `no verdict` (exit 2).

The [harness](#g-harness) replaces every function on its target, so the target
is a [throwaway deployment](#g-throwaway-deployment) in a project of its own.
The script refuses anything not named `dev:<name>` (never `prod:`, `preview:`,
`local:` or a deploy key), and any deployment the repository's own `.env*`
files name.

## 1. Create the throwaway project

Needs a Convex login on this machine (`~/.convex/config.json`; `bunx convex
login` otherwise). In an empty directory outside the repository:

```bash
mkdir -p ~/catalogue-latency && cd ~/catalogue-latency
echo '{"name":"catalogue-latency-harness","private":true,"dependencies":{"convex":"*"}}' > package.json
ln -s ~/code/mtg/tolaria/node_modules node_modules
mkdir convex && printf 'import { mutationGeneric } from "convex/server";\nexport const run = mutationGeneric({ args: {}, handler: async () => null });\n' > convex/empty.ts
env -u CONVEX_DEPLOYMENT -u CONVEX_SELF_HOSTED_URL -u CONVEX_SELF_HOSTED_ADMIN_KEY \
  ./node_modules/.bin/convex dev --once --configure new \
  --team <team-slug> --project catalogue-latency-throwaway --dev-deployment cloud \
  --typecheck disable --codegen disable --tail-logs disable
grep CONVEX_DEPLOYMENT .env.local    # → dev:<name>, the deployment to measure
```

The `env -u` matters: a `CONVEX_SELF_HOSTED_URL` or `CONVEX_DEPLOYMENT`
inherited from the repository's `.env.local` would point the CLI at the local
backend.

## 2. Run the sweep

From the repository (any worktree):

```bash
bun run perf:catalogue-cloud --deployment dev:<name>
```

| flag           | default         | meaning                                                                                |
| -------------- | --------------- | -------------------------------------------------------------------------------------- |
| `--deployment` | (required)      | the [throwaway deployment](#g-throwaway-deployment), `dev:<name>`                      |
| `--blocks`     | `8,16,32,64`    | [block sizes](#g-block-size) to sweep, one push each                                   |
| `--rows`       | `35000`         | size of the [synthetic catalogue](#g-synthetic-catalogue)                              |
| `--deck`       | `76`            | definitions the deck case asks for, each in its own block                              |
| `--rounds`     | `40`            | measured [rounds](#g-round) per block size                                             |
| `--warmup`     | `5`             | discarded [rounds](#g-round) after each push                                           |
| `--work-dir`   | a fresh tmp dir | where the [harness](#g-harness) project is written; kept when given, deleted otherwise |

Per block size it packs the [synthetic catalogue](#g-synthetic-catalogue),
pushes the [harness](#g-harness), checks every deck id resolves, then runs
interleaved [rounds](#g-round) and prints, per case (0, 1 and 76 definitions),
the median and p90 [added latency](#g-added-latency), the
[latency budget](#g-latency-budget) and `PASS` / `FAIL`. It ends with a
Markdown table — block size, packed bytes, bytes per row, every case — ready
for a PR body. Four block sizes take ~3 minutes.

The figures are cloud-side differences, so the dev machine's load barely moves
them; the p90 is noisier than the median (one slow call of a
[round](#g-round) is enough), which is why the
[verdict](#g-verdict) is on the median.

### Failure modes

- `refusing "<x>"` (exit 2, nothing pushed): not a `dev:<name>` selector, or a
  deployment the repository's env files name.
- `no verdict: … is not Convex cloud` (exit 2): the deployment reported a local
  or self-hosted URL — measure on cloud.
- `In order to push, add convex to your package.json dependencies`: a stale
  `--work-dir` from an older script; delete it.
- `harness resolved N of 76 deck ids`: the pushed corpus is not the packed one
  (a push that failed silently) — re-run.

## 3. Clean up

The Convex CLI cannot delete a project. Either:

- **Dashboard**: `https://dashboard.convex.dev/t/<team-slug>/catalogue-latency-throwaway`
  → Project Settings → Delete Project; or
- **Management API**, with the login's token: list the team's projects
  (`GET https://api.convex.dev/v1/teams/<team-id>/list_projects`) to find the
  throwaway's numeric id, then
  `POST https://api.convex.dev/v1/projects/<project-id>/delete`, both with
  `Authorization: Bearer <token>`. Check the id is the throwaway's, not the
  app's, before the POST: it cannot be undone.

Then `rm -rf ~/catalogue-latency`.

## Last sweep (issue #4167, 2026-10-06)

35,000 synthetic rows from 4,360 real ones; median / p90 added latency, ms:

| block rows | packed bytes | B/row | 0 definitions | 1 definition  | 76 definitions |
| ---------- | ------------ | ----- | ------------- | ------------- | -------------- |
| 4          | 7,992,349    | 228   | +4.4 / +35.0  | +5.8 / +22.4  | +30.1 / +46.8  |
| 8          | 7,541,591    | 215   | +1.6 / +16.5  | +3.4 / +19.9  | +37.6 / +55.3  |
| 16         | 7,281,712    | 208   | +6.5 / +17.3  | +9.7 / +24.2  | +50.2 / +61.5  |
| 32         | 7,136,317    | 204   | +5.6 / +18.0  | +11.3 / +19.5 | +62.1 / +83.5  |
| 64         | 7,065,237    | 202   | +4.8 / +13.1  | +11.5 / +25.1 | +95.4 / +116.9 |

Every size passes; 8 is the generator's `PACKED_BLOCK_ROWS`
(`scripts/lib/packed-corpus.ts` says why).

## Glossary

### <a id="g-packed-corpus"></a>Packed corpus

The server's copy of every compiled card definition, sorted by id, deflated in
fixed-size blocks against one shared dictionary and carried as one string
(`data/catalogue/packed-corpus.json`). A request pays only for the blocks it
inflates.

### <a id="g-block-size"></a>Block size

How many rows one deflate block holds. Bigger blocks compress better (fewer
bytes in the bundle, on every request's heap) but a lookup inflates its whole
block.

### <a id="g-latency-budget"></a>Latency budget

100 ms of added CPU per mutation attributable to the catalogue, measured on
cloud (ADR 0113 Amendment III § Decision 5).

### <a id="g-verdict"></a>Verdict

`PASS` when every case's median [added latency](#g-added-latency) is within the
[latency budget](#g-latency-budget), else `FAIL`. Printed only for a Convex
cloud deployment.

### <a id="g-harness"></a>Harness

The tiny Convex project the script pushes: `empty:run` (a mutation importing
nothing), `corpus:lookup` (a mutation whose module imports the
[packed corpus](#g-packed-corpus) and resolves ids with the server's own
decoder) and `empty:where` (the deployment's own URL).

### <a id="g-throwaway-deployment"></a>Throwaway deployment

A cloud dev deployment in a project created for the measurement and deleted
after it, so the [harness](#g-harness) never replaces the app's functions.

### <a id="g-synthetic-catalogue"></a>Synthetic catalogue

The real compiled rows copied up to the target size, each copy with a rewritten
id (still a lowercase UUID) and a suffixed name, so ids and names stay unique.

### <a id="g-round"></a>Round

One call of the empty mutation and one call per case, in an order rotated every
round. Differences are taken inside a round, so the network round trip cancels.

### <a id="g-added-latency"></a>Added latency

A case's round-trip time minus the empty mutation's in the same
[round](#g-round): what the catalogue added on the server.
