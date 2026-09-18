# Production infrastructure: what runs where, who holds the keys, when to pay

## Status

accepted — drafted from the repo and completed by the owner 2026-09-18
(issue #3847, under the roadmap map issue #3846). Records infrastructure that
already exists; the one new decision is the upgrade rule (§ 5). ADR 0116
(release gate) and ADR 0128 (Verdict Store) stand and are referenced, not
restated.

## Context

Until now the production setup lived only in the owner's head. A session
could read `vercel.json` and guess the rest, but not which plans the services
run on, who can rotate a key, or what happens when a free tier runs out. At
five users none of this bites; at fifty one of the free tiers will, and the
first sign would be a hard stop rather than a bill.

Facts the repo could NOT supply and the owner did (2026-09-18): every service
is on its free tier; every account is owned by the one maintainer, credentials
in the owner's password manager, no second admin; the Resend sender uses a
verified domain of the owner's; `GITHUB_TOKEN` is a fine-grained token scoped
to Issues on the one repository; the frontend is served on a custom domain.
Free-tier caps below were read from the vendors' own pricing and limits pages
on 2026-09-18 — they drift, so re-read them before acting on a number.

## Decision

### 1. What runs where

| Service                  | Role                                                                                     | Plan             |
| ------------------------ | ---------------------------------------------------------------------------------------- | ---------------- |
| **Vercel**               | Hosts the static SPA **and runs the production deploy** (its build deploys Convex too)   | Hobby (free)     |
| **Convex** (cloud)       | Backend: game state, GRE mutations, auth, crons — prod deployment `jovial-guineapig-250` | Free             |
| **Resend**               | Password-reset OTP email only (`convex/resendOtpPasswordReset.ts`)                       | Free             |
| **Google Cloud Storage** | Verdict Store bucket `tolaria-verdict-store`, `us-central1` (ADR 0128)                   | Always Free      |
| **Sentry**               | Client error + console-log monitoring (`src/main.tsx`)                                   | Developer (free) |
| **GitHub**               | Source, issues; target of the in-app bug report (`fil-donadoni/tolaria`)                 | Free             |

The local development backend is a self-hosted Convex (`CONVEX_SELF_HOSTED_URL`
on `127.0.0.1`) and is not production; `check:ui` runs against it (ADR 0116).
There is no staging environment: the base branch never reaches a deployment.

### 2. How a release reaches production

1. `bun run land` merges a PR into the base branch (`staging`). Nothing deploys.
2. `bun run release`, from the primary checkout when a human decides, runs the
   full health gate on the `origin/staging` tip and fast-forwards the release
   branch (`main`) on GREEN (ADR 0116, `docs/guides/land-and-release.md`).
3. **Vercel's git integration is the trigger.** `vercel.json` enables
   deployments for `main` only (`"git.deploymentEnabled": { "main": true, "**": false }`),
   and its `buildCommand` is, in order:
   `convex codegen` → `convex deploy --cmd 'bun run build'` (pushes the Convex
   functions and schema to prod, then builds the SPA against the prod URL) →
   `bun run seed:preset:deploy` (upserts preset decks on the deployment the
   build's `CONVEX_DEPLOY_KEY` selects).

So the push to `main` IS the production deploy of both halves, and
`CONVEX_DEPLOY_KEY` lives only in Vercel's build environment. No script on a
dev machine holds it, and none should (the Verdict Store forward token, issue
#3745, exists precisely so a machine never needs it).

### 3. Secrets and environment

Every secret lives in the environment of the service that uses it, and a copy
of each account's credentials is in the owner's password manager. Only the
owner can rotate any of them.

| Where                   | Variable                                      | Purpose / notes                                                                                                               |
| ----------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Vercel build env        | `CONVEX_DEPLOY_KEY`                           | Prod deploy key; selects the deployment for `convex deploy` and `seed:preset:deploy`                                          |
| Convex prod             | `JWT_PRIVATE_KEY`, `JWKS`                     | `@convex-dev/auth` session signing                                                                                            |
| Convex prod             | `SITE_URL`                                    | The custom frontend domain; required by `@convex-dev/auth` (reset links, redirects)                                           |
| Convex prod             | `RESEND_API_KEY`, `AUTH_EMAIL_FROM`           | Reset OTP mail; sender on the owner's verified domain (default `onboarding@resend.dev` only reaches the Resend account owner) |
| Convex prod             | `GITHUB_TOKEN`                                | Fine-grained, Issues on `fil-donadoni/tolaria` only; bug reports                                                              |
| Convex prod             | `VERDICT_STORE_WRITE_KEY`                     | GCS writer service account; **prod only, never a local backend** (ADR 0128)                                                   |
| Convex prod             | `VERDICT_STORE_FORWARD_TOKENS`                | sha256 hashes of forward tokens, per deployment (issue #3745) — not a secret                                                  |
| Local backend           | `VERDICT_STORE_FORWARD_TOKEN`, `_URL`         | Lets a local drain forward Verdicts to prod instead of holding the write key                                                  |
| Dev machine             | `~/.config/tolaria/verdict-store-reader.json` | GCS reader key (`docs/guides/verdict-store.md`)                                                                               |
| Frontend build          | `VITE_CONVEX_URL`                             | Injected by `convex deploy --cmd`; not a secret                                                                               |
| Source (`src/main.tsx`) | Sentry DSN                                    | Public by Sentry's design; hardcoded, not an env var                                                                          |

`CONVEX_CLOUD_URL` / `CONVEX_SITE_URL` are set by Convex itself. Reading prod
values into a transcript is refused by the agent permission classifier, and
`convex env list` prints whole values — list NAMES only.

### 4. Free-tier caps (vendor pages, 2026-09-18)

| Service | Cap (per month unless stated)                                                                                      | At the cap                                                  | Next tier                                                           |
| ------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| Convex  | 1M function calls; 20 GB-h action compute; 0.5 GB DB storage; 1 GB DB bandwidth; 1 GB file storage, 1 GB egress    | Mutations that write may fail; no automatic overage on Free | Pro $25/developer/month (25M calls, 50 GB storage) or pay-as-you-go |
| Vercel  | 100 GB Fast Data Transfer; 1M edge requests; 1M function invocations; 100 deployments/day; non-commercial use only | **Hard stop until the 30-day window resets**                | Pro $20/seat/month (1 TB)                                           |
| Resend  | 100 emails/day, 3,000/month; 3 domains                                                                             | Sending refused                                             | Pro $20/month (50,000/month)                                        |
| Sentry  | 5,000 errors; 5 GB logs; 1 user                                                                                    | Events dropped                                              | Team $26/month                                                      |
| GCS     | 5 GB-months storage; 5,000 class A / 50,000 class B ops; 100 GB egress (US regions only)                           | Billed per use                                              | —                                                                   |
| GitHub  | Issue creation: 80/minute, 500/hour (secondary limit)                                                              | Request rejected                                            | —                                                                   |

Tolaria is non-commercial by charter, which is what keeps Vercel Hobby legal.
Sources: convex.dev/pricing, docs.convex.dev/production/state/limits,
vercel.com/pricing, vercel.com/docs/limits, resend.com/pricing,
sentry.io/pricing, cloud.google.com/free/docs/free-cloud-features,
docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api.

**Which cap binds first at 50 users: Convex database bandwidth.** Reads are
billed by whole document (`gameStates` is one fat snapshot patched in place,
re-read by every subscriber that holds it — the `gameTicks` companion exists
to keep that down), and 1 GB/month is small against 50 active players. Storage
is held down by the `sweepFinishedGames` cron (24 h TTL). Vercel serves a
static bundle with immutable asset caching and is far from 100 GB; Resend
sends only password resets; Sentry sees only client errors.

### 5. The upgrade rule (owner decision)

- **Check monthly**, from each vendor's usage dashboard.
- **At 70% of any one cap, upgrade that service alone** to its next paid tier
  — never a bundle of services "while we are at it". Convex is expected first.
- **Spending ceiling: 50 $/month across all services.** Crossing it is an
  explicit owner decision, not a rule a session applies.
- Before paying, the cheaper lever is checked: a Convex bandwidth spike is
  first read as a read-amplification bug (`/convex-performance-audit`), and
  only then as growth.

### 6. Monitoring today

- **Sentry** (client): errors and console logs, `userInfo: false`, no HTTP
  bodies. Disclosed in the bug-report consent screen.
- **In-app bug report** (`convex/bugReports.ts` `submitBugReport`):
  authenticated users only; files a GitHub issue on the public repository;
  diagnostics (route, user agent, game id, client console/network rings) are
  attached only when the reporter consents, and consent is re-derived
  server-side. The public issue carries the description and the reporter's
  display name (editable, "Anonymous" when blank); the email, the attachment
  and the full game state stay on the Convex report row, never on GitHub.
- **Convex dashboard**: function logs and usage, looked at by hand.
- **Nothing else**: no uptime probe, no alert on a failing cron or a quota
  approaching. A cap is noticed by the monthly check in § 5 or by a user.

## Consequences

- A session asked "is this deployed?" answers from § 2: only if `main` moved
  and Vercel's build went green; `land` never deploys.
- A new secret owes a row in § 3 in the same PR that reads it.
- The bus factor is one: every account, key and rotation belongs to the owner.
  A second admin is not planned; the password manager is the recovery path.
- There is no alerting. Adding one (a quota alert, an uptime probe) is a
  future decision, and would amend § 6.
- The Vercel build is also the Convex deploy: a Vercel outage or a red build
  blocks backend releases too, and a failed `seed:preset:deploy` fails the
  whole deploy after the Convex functions are already pushed.

## Alternatives considered

- **Pay up front for headroom.** Rejected: at five users every plan is idle,
  and § 5's trigger is cheap to watch.
- **Deploy Convex from `bun run release`.** Rejected (status quo kept): it
  would put `CONVEX_DEPLOY_KEY` on a dev machine and split the release into two
  deploys that can disagree.
