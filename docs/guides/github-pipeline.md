# GitHub pipeline — runners, labels, pause/resume, repository settings

ADR 0156 (and its Amendment I) moves everything after the PR — verification
scheduling, the merge queue, post-merge jobs, health, release — onto GitHub
Actions and Mergify. Every job runs on a [self-hosted runner](#g-runner) on
one of the owner's two machines. This guide is the operating manual of that
stack; **every slice of PRD #5620 updates it in the same PR**. Version 1
(issue #5634) covers the [runners](#g-runner) only: install,
[labels](#g-label), [pause](#g-pause) / resume, and the repository settings
checklist. No workflow uses the runners yet — that is Phase 0's next slice.

While the migration runs, the old stack (`land`, the land-runner, `loop:afk`,
batch health) stays the authority on what runs today, and it is **frozen**: no
new feature outside PRD #5620 (`docs/agents/quality-gates.md`).

## The runners on a machine

A machine declares how many [runners](#g-runner) of each
[role label](#g-label) it offers. Defaults:

| [Label](#g-label) | MacBook | Huawei | What it runs                                                                  |
| ----------------- | ------- | ------ | ----------------------------------------------------------------------------- |
| [`pass`](#g-pass) | 2       | 2      | one Claude Code session (`/next-ticket`) per job                              |
| [`lane`](#g-lane) | 1       | 1      | queue checks, health, release                                                 |
| [`seed`](#g-seed) | 1       | 0      | jobs that need the owner's Convex deployment (scenario seeds) — the MacBook's |
| `host:<name>`     | all     | all    | pins a job to one machine when it must                                        |

GitHub adds `self-hosted`, the OS and the architecture to every runner by
itself. Each [runner](#g-runner) is named `<host>-<role>-<n>` (e.g.
`macbook-pass-2`) and lives in its own directory,
`~/.local/share/tolaria/actions-runner/<name>/`. The number of
[`pass`](#g-pass) runners IS the cap on concurrent Claude sessions on that
machine (ADR 0156 §1): size it by the Max subscription's usage limits, which
both machines share.

Every [runner](#g-runner) runs **as the owner's user** (Amendment I: no
dedicated system user), so a job sees the same Convex deployment, `gh` and
Claude logins, merge drivers and telemetry as an interactive session.

## Install

From the [primary checkout](#g-primary-checkout) of each machine (the script
resolves it from any worktree too):

```bash
bun run runner install --dry-run --host macbook   # prints every step, runs nothing
bun run runner install --host macbook             # do it
bun run runner status                             # local services + GitHub's view
```

On the Huawei, `--host huawei`. Flags: `--pass N`, `--lane N`, `--seed N`,
`--no-convex` (MacBook: skip the [Convex agent](#g-convex-agent)). The first
run remembers host and counts in the [machine declaration](#g-declaration);
a later bare `bun run runner install` declares the same runners.

What `install` does, per [runner](#g-runner), only where the machine differs:

1. downloads the latest `actions/runner` release for this OS/arch once
   (cached under `~/.cache/tolaria/actions-runner/`) and unpacks it into the
   runner's directory;
2. registers it with `config.sh --unattended --replace` and its
   [labels](#g-label) — the registration token comes from
   `gh api -X POST repos/<owner>/<repo>/actions/runners/registration-token`,
   so the `gh` login must be the repository's admin;
3. installs its [user service](#g-user-service) and starts it — unless the
   runner is [paused](#g-pause), in which case it stays stopped.

**Idempotent**: a second run on an unchanged machine prints
`nothing to do — this machine already matches`. A changed unit template is
rewritten and its service restarted. A [runner](#g-runner) installed but no
longer declared (you lowered `--pass`) is reported, never removed silently:
`bun run runner remove <name>` stops it, unregisters it from GitHub and
deletes its directory. Changing a registered runner's
[labels](#g-label) = `remove` it, then `install` again.

### MacBook — launchd

- One [launchd agent](#g-user-service) per [runner](#g-runner):
  `~/Library/LaunchAgents/com.tolaria.gh-runner.<name>.plist`, rendered from
  `scripts/runner-units/com.tolaria.gh-runner.plist`. It starts at login,
  `KeepAlive` restarts it when it dies, and it runs `run.sh` **under
  [`caffeinate -i -s`](#g-caffeinate)**: a sleeping MacBook fails every job in
  flight. Log: `~/.cache/tolaria/gh-runner/<name>.log`.
- **`convex dev` becomes a launchd agent** too, the
  [Convex agent](#g-convex-agent) `com.tolaria.convex`
  (`scripts/runner-units/com.tolaria.convex.plist`): `convex dev --local` in
  the [primary checkout](#g-primary-checkout), restarted when it dies. A job
  cannot own it — a job's processes die with the job. On the first install a
  `convex dev` that `convex:ensure` started still holds the port: stop it
  (`pkill -f 'convex dev'`) and the agent takes over within 10 s. Log:
  `~/.cache/tolaria/convex/agent.log`.
- Every plist carries `node` on its `PATH` (the render refuses one without,
  issue #5598) and a `TOLARIA_OWNER=unit:…` tag that keeps the reaper off the
  job trees.

Check one: `launchctl print "gui/$(id -u)/com.tolaria.gh-runner.<name>" | grep -E 'state|last exit'`.

### Huawei — systemd

- One template [user service](#g-user-service),
  `~/.config/systemd/user/tolaria-gh-runner@.service`
  (`scripts/runner-units/tolaria-gh-runner@.service`); each
  [runner](#g-runner) is an instance, `tolaria-gh-runner@<name>.service`.
  `Restart=always`, and `KillMode=control-group` ends a job's whole tree with
  the unit. `PATH` is the one `install` ran with — run it from a shell where
  `bun` and `node` resolve.
- **[Linger](#g-linger)** keeps the services up with nobody logged in;
  `install` notes when it is off: `sudo loginctl enable-linger "$USER"`.
- The Huawei keeps its existing Convex unit, `tolaria-convex.service`
  (`docs/guides/huawei-runner.md` § Convex on the Huawei); `install` adds none.

Check one: `systemctl --user status tolaria-gh-runner@<name>.service`,
`journalctl --user -u tolaria-gh-runner@<name>.service -n 50`.

## Pause and resume

[Pause](#g-pause) a machine's [runners](#g-runner) while you work on it; the
other machine carries the queue:

```bash
bun run runner pause    # stop every runner here; they stay registered (GitHub shows them offline)
bun run runner resume   # start them again
```

`pause` writes a `.paused` mark in each runner's directory and disables its
[user service](#g-user-service) (`launchctl disable` + `bootout`;
`systemctl --user disable --now`), so neither a login nor a reboot brings it
back, and a later `install` leaves it stopped. `resume` reverses both. Both
accept `--dry-run`. **A job running at pause time is killed** — GitHub marks
it failed and the next event or sweep re-fires it. `pause` never touches the
[Convex agent](#g-convex-agent).

## Repository settings checklist (ADR 0156 §8)

The repository is public: these settings, not the workflow files, are what
keep an outsider's code off the [runners](#g-runner). Set once, by the owner,
in the repository's Settings; a slice that needs a new one adds its row here.

- [ ] **Actions → General → Fork pull request workflows from outside
      collaborators: "Require approval for all external contributors".** The
      barrier that matters: a fork PR can rewrite any check in its own workflow
      files.
- [ ] **Actions → General → Workflow permissions: "Read repository contents
      and packages permissions"** (read-only default `GITHUB_TOKEN`); a job
      that writes asks for its permission explicitly.
- [ ] **Actions → Variables → Repository variable
      [`TRUSTED_AUTHORS`](#g-trusted-authors)**, seeded with the owner's login
      (who also authors the loop's PRs). Admin-only, out of any PR's reach.
- [ ] **No secret in a PR job.** Claude's and `gh`'s credentials stay on the
      machines, in the owner's user; a workflow never reads them from GitHub
      secrets.
- [ ] **Actions → Runners** lists every [runner](#g-runner) of both machines
      online, with its [labels](#g-label) (`bun run runner status` prints the
      same).

Later slices add: the ruleset requiring the PR check (Phase 0), the queue's
entry conditions and `.github/` / `.mergify.yml` exclusion (Phase 1).

## Troubleshooting

| Symptom                                      | Look at                                                                                                                       |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `could not get a registration token`         | the `gh` login is not the repository's admin: `gh auth status`                                                                |
| `node not resolvable on the rendered PATH`   | run `install` from a shell where `command -v node` resolves                                                                   |
| a [runner](#g-runner) offline on GitHub      | `bun run runner status`; `paused` = expected; `STOPPED` = its log (MacBook) or `journalctl` (Huawei)                          |
| the [Convex agent](#g-convex-agent) restarts | `~/.cache/tolaria/convex/agent.log` — usually a second `convex dev` holding the port                                          |
| jobs fail when the MacBook lid closes        | [`caffeinate`](#g-caffeinate) cannot stop a clamshell sleep on battery: keep it on power, or [pause](#g-pause) before closing |

## Glossary

### <a id="g-runner"></a>Runner

A self-hosted GitHub Actions runner: GitHub's agent process on one of the
owner's machines that takes jobs whose `runs-on` labels it carries. One
directory, one registration, one service each.

### <a id="g-label"></a>Label

A tag a [runner](#g-runner) registers with; a job's `runs-on` names the
labels it needs and goes to the first free runner carrying all of them.
Tolaria's role labels are [`pass`](#g-pass), [`lane`](#g-lane),
[`seed`](#g-seed), plus `host:<name>`.

### <a id="g-pass"></a>`pass`

The [label](#g-label) of a [runner](#g-runner) that runs one Claude Code
session per job. Their count is the machine's concurrency cap.

### <a id="g-lane"></a>`lane`

The [label](#g-label) of a [runner](#g-runner) for verification work: queue
checks, batch health, release.

### <a id="g-seed"></a>`seed`

The [label](#g-label) of the [runner](#g-runner) on the machine holding the
owner's Convex deployment (the MacBook): scenario seeding runs there.

### <a id="g-pause"></a>Pause

Stopping a machine's [runners](#g-runner) without unregistering them: a
`.paused` mark plus a disabled [user service](#g-user-service), undone by
`resume`.

### <a id="g-user-service"></a>User service

A service run by the owner's own service manager, not root's: a launchd
agent in `~/Library/LaunchAgents/` on macOS, a `systemctl --user` unit on
Linux.

### <a id="g-convex-agent"></a>Convex agent

`com.tolaria.convex`, the MacBook's `convex dev --local` as a launchd
[user service](#g-user-service), so the deployment outlives any job.

### <a id="g-caffeinate"></a>`caffeinate`

macOS's keep-awake wrapper; `-i -s` prevents idle and system sleep while the
wrapped [runner](#g-runner) lives (system sleep only on AC power).

### <a id="g-linger"></a>Linger

systemd-logind's per-user switch that starts a user's services at boot and
keeps them after logout — what lets the Huawei's [runners](#g-runner) run
with nobody logged in.

### <a id="g-declaration"></a>Machine declaration

`~/.local/share/tolaria/actions-runner/machine.json`: the host name and
per-[label](#g-label) counts the last `install` used, so a re-run without
flags declares the same [runners](#g-runner).

### <a id="g-primary-checkout"></a>Primary checkout

The clone that owns `.git/` (not a worktree): where the Convex deployment
state and the units' working directory live.

### <a id="g-trusted-authors"></a>`TRUSTED_AUTHORS`

The admin-only Actions repository variable listing the accounts whose PRs
and issues the pipeline acts on; everyone else waits for the owner.
