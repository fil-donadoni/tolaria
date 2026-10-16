# Runner machines — the reaper and the health runner

How to install, check and remove the [reaper](#g-reaper) on both machines of
topology B' (ADR 0154): a `launchd` agent on the MacBook, a `systemd` user
timer on the Huawei. Built by issue #5470. The unit files live beside the
scripts they run, in [`scripts/runner-units/`](../../scripts/runner-units/).
The Huawei's one-time setup for the batch gates is [its own section](#set-up-the-huawei-for-the-batch-gates);
its Convex backend, a systemd unit, is [Convex on the Huawei](#convex-on-the-huawei).
The [health runner](#g-health-runner), which gates batch health there, is
[its own section](#the-health-runner); the hourly and nightly jobs that
run beside it are [The crons](#the-crons).

## What it does

Every process tree the tooling starts — a `gate:run` run, a gate, `check:ui`,
`health-main`, a `claude -p` pass of the AFK driver — registers a
[process lease](#g-lease) and hands its [owner tag](#g-tag) to everything it
spawns. Every 2 minutes a [sweep](#g-sweep) reads the process table and
terminates (TERM, 5 s, KILL):

- every process of a dead [lease](#g-lease): its [anchor](#g-anchor) is gone,
  its deadline passed unrenewed, its cwd was removed (a deleted worktree), or
  the [lease](#g-lease) it was spawned under is dead — whatever the binary is;
- every process whose [owner tag](#g-tag) names no registered
  [lease](#g-lease), past a 1-minute margin;
- the [pattern net](#g-net): an untagged orphan (parent pid 1, or a
  `systemd --user`) of THIS checkout — its cwd or command path under the
  primary checkout's path (sibling worktrees share it as a prefix) or the
  tooling cache — matching vitest, vite, Chromium under the Playwright cache,
  `bun scripts/*` or `claude -p`, older than a minute. The local
  `convex-local-backend` is not a pattern: `convex:ensure` leaves it serving on
  purpose and tags the one it starts with a [unit tag](#g-unit).

A [lease](#g-lease) that renews itself (a gate, `check:ui`, `health-main`, a
pass) never dies on the clock — its renewal stalls whenever the machine sleeps
or a synchronous step blocks it — only on its [anchor](#g-anchor), cwd or
parent. An unreadable [lease](#g-lease) registry sweeps nothing, and an empty
one never condemns a tagged process.

It never touches a live [lease](#g-lease)'s tree, a tree inside its
[grace window](#g-grace), anything carrying a [unit tag](#g-unit), another
user's processes, or itself. Every kill is logged with its reason in
`~/.cache/tolaria/reaper/reaped.log`.

## Check what it would do

```bash
bun run reaper --dry-run     # one sweep, prints every kill and its reason, changes nothing
bun run machine              # the leases, and the last sweep on this machine
```

`bun run machine` ends with two lines: `process leases` (one row per
[lease](#g-lease): kind, [anchor](#g-anchor) pid and whether it runs, age, time
left, [grace window](#g-grace), cwd) and `reaper` (when the last
[sweep](#g-sweep) ran and what it took). `never swept on this machine` means
the agent below is not installed.

## Install on the MacBook

From the primary checkout:

```bash
mkdir -p ~/.cache/tolaria/reaper ~/.cache/tolaria/land-runner
for u in reaper land-runner; do   # land-runner: omit on a machine that does not merge
    out=~/Library/LaunchAgents/com.tolaria.$u.plist
    bun scripts/launchd-render.ts scripts/runner-units/com.tolaria.$u.plist \
        > "$out.tmp" && mv "$out.tmp" "$out" || break
    launchctl bootstrap "gui/$(id -u)" "$out"
    launchctl print "gui/$(id -u)/com.tolaria.$u" | grep -E 'state|last exit'
done
```

`scripts/launchd-render.ts` substitutes `__REPO__`, `__BUN__`, `__HOME__` and
`__NODE_BIN__` (the directory of `command -v node`: launchd's PATH does not
carry nvm/mise, and `land`'s `convex codegen` dies with `env: node: No such
file or directory` without it, issue #5598). It exits 1, and the installed plist is left untouched,
when a placeholder is left over or `node` is not on the rendered PATH. Verify
the live agent: `ps eww -p <pid> | tr ' ' '\n' | grep ^PATH=` shows the node
directory.

The agent runs `scripts/reaper.ts` from the primary checkout, so it always
sweeps with the code of the base branch that checkout is on. Remove it with
`launchctl bootout "gui/$(id -u)/com.tolaria.reaper"` and delete the plist.

## Install on the Huawei

The [reaper](#g-reaper) runs as a **user** unit — it signals the same user's
processes, never root's — and lingering keeps it running with nobody logged
in:

```bash
REPO=$(git rev-parse --show-toplevel)
mkdir -p ~/.config/systemd/user
for f in tolaria-reaper.service tolaria-reaper.timer; do
    sed -e "s|__REPO__|$REPO|g" -e "s|__BUN__|$(command -v bun)|g" \
        "scripts/runner-units/$f" > ~/.config/systemd/user/$f
done
sudo loginctl enable-linger "$USER"
systemctl --user daemon-reload
systemctl --user enable --now tolaria-reaper.timer
systemctl --user list-timers tolaria-reaper.timer
journalctl --user -u tolaria-reaper.service -n 20
```

Remove it with `systemctl --user disable --now tolaria-reaper.timer`.

### Every Tolaria unit

Every other Tolaria unit on the Huawei (the health runner, the self-hosted
Convex, the crons) gets the [`tolaria-unit.conf`](../../scripts/runner-units/tolaria-unit.conf)
drop-in: `KillMode=control-group`, so stopping the unit kills its whole cgroup,
and a [unit tag](#g-unit), so the [reaper](#g-reaper) leaves the unit's tree to
systemd instead of taking its processes (parent pid 1) for orphans:

```bash
UNIT=tolaria-health.service   # each Tolaria unit in turn
mkdir -p ~/.config/systemd/user/$UNIT.d
cp scripts/runner-units/tolaria-unit.conf ~/.config/systemd/user/$UNIT.d/
systemctl --user daemon-reload
```

A Tolaria unit installed WITHOUT the drop-in whose command matches the
[pattern net](#g-net) (`bun scripts/…`) is reaped after a minute — that is the
check that it was forgotten: `grep 'untagged orphan' ~/.cache/tolaria/reaper/reaped.log`.

## Prove it

On each machine, with the agent installed. Three strays — two untagged orphans
the [pattern net](#g-net) must catch (a vitest worker, a headless Chromium
under the Playwright cache), and a tagged arbitrary binary whose
[lease](#g-lease) dies:

```bash
# 1. Untagged orphan named like a vitest worker (parent becomes pid 1).
bash -c 'exec -a "node vitest/dist/workers/forks.js" sleep 100000 &' ; sleep 1
pgrep -fl 'vitest/dist/workers/forks.js'

# 2. Untagged headless Chromium from the Playwright cache, orphaned the same
#    way. On macOS the binary is under ~/Library/Caches/ms-playwright.
HS=$(ls -d ~/.cache/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell | head -1)
bash -c "\"$HS\" --no-sandbox --remote-debugging-port=0 about:blank >/dev/null 2>&1 &" ; sleep 1

# 3. A tagged python under a lease whose anchor we then kill. Homebrew's
#    python3 on macOS: Apple's own binaries (/usr/bin/*) hide their
#    environment from `ps -E`, so a tag on them cannot be read.
sh -c 'echo $$ > /tmp/anchor; exec sleep 100000' & sleep 1
bun scripts/lib/process-lease.ts put proof-1 proof "$(cat /tmp/anchor)" 3600
TOLARIA_OWNER=proof-1 sh -c "python3 -c 'import time; time.sleep(1e6)' &"
kill "$(cat /tmp/anchor)"

bun run reaper --dry-run --orphan-min-age 0   # all three listed, with reasons
```

The vitest and Chromium strays (Chromium with every child it forked) are
reaped by the first [sweep](#g-sweep) after they are a minute old; the python
by that sweep or the next. All three must show in `reaped.log` with their
reasons. Run on the Huawei on 2026-10-13 (issue #5492): all eight processes
reaped by one sweep.

## Set up the Huawei for the batch gates

What the Huawei (Omarchy / Arch, i7-8550U, 4 cores / 8 threads, 16 GiB)
needs to run every batch gate — `check:pr`, `test`, `check:all`,
`check:ui --all`, `health` — and the check that proves each. Issue #5463
made these changes, in this order; every step is re-runnable (run it again on
a machine that has it and nothing changes). What the machine then measured:
`docs/research/huawei-gate-bench-2026-10-11.md` § 4.

| Need                                            | Check                                                                            | Why                                                                                                                         |
| ----------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| The machine never suspends on lid, keys or idle | `systemd-analyze cat-config systemd/logind.conf` shows the `Handle*=ignore` rows | A suspended health step is recorded `infra`, never a verdict (sleep detection, `lib/health-verdict.ts`)                     |
| Read access to the system journal               | `journalctl --system -n1` prints a line                                          | Sleep detection reads it                                                                                                    |
| Playwright's Chromium and its shared libraries  | `bunx playwright install chromium` exits 0; `ldd` on both binaries finds all     | `check:ui` drives it                                                                                                        |
| GNU `time`                                      | `/usr/bin/time --version`                                                        | Peak RSS of a gate (`time -v`); without it every wrapped step exits 127 in under a second                                   |
| Node at the repo's pin                          | `mise current node` equals `.nvmrc`                                              | Vitest and the Convex CLI run under it                                                                                      |
| `perl`                                          | `perl -v`                                                                        | The AFK loop's detach path (`loop-handoff.sh`: `POSIX::setsid`, log stamping)                                               |
| A local Convex deployment                       | `bun run convex:ensure` prints `answers`                                         | `check:ui` signs in against it; the [`tolaria-convex` unit](#convex-on-the-huawei) runs the watcher in the primary checkout |

### 1. logind and the journal — one root script

Run from a real terminal (Claude Code's `!` prefix gives `sudo` no tty for
the password), as `sudo bash huawei-setup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
install -d /etc/systemd/logind.conf.d
cat >/etc/systemd/logind.conf.d/30-tolaria-runner.conf <<'EOF'
# Tolaria batch runner (issue #5463): never sleep on lid, keys or idle.
[Login]
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
HandleSuspendKey=ignore
HandleHibernateKey=ignore
IdleAction=ignore
EOF
usermod -aG systemd-journal fil
systemctl kill -s HUP systemd-logind
systemd-analyze cat-config systemd/logind.conf | grep -E '^(Handle|Idle)'
```

`HUP` makes logind re-read its configuration without a restart, so the
graphical session survives. Omarchy's own `10-ignore-power-button.conf` and
`20-inhibit-delay.conf` stay as they are. On Arch, `wheel` already has a read
ACL on `/var/log/journal`, so `journalctl --system` answered before the group
was added; `systemd-journal` makes access independent of `wheel` from the next
login.

### 2. Playwright Chromium — user-level, no system package

```bash
bunx playwright install chromium
ldd ~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome | grep 'not found'
ldd ~/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell | grep 'not found'
```

Both `ldd` lines must print nothing. Playwright downloads its Ubuntu 24.04
fallback build on Arch (it says so); `install --with-deps` and
`install-deps` are apt-only. The Omarchy desktop already carried every
library both binaries load, so **no pacman package was installed** for it. If
a later build reports a missing `lib*.so`, `pacman -F <lib>.so` names the
package: install it and add it here.

### 3. GNU `time` — one pacman package

```bash
sudo pacman -S --needed time
```

Arch does not ship `/usr/bin/time`; bash's `time` builtin has no `-v`.

### 4. Node, perl — nothing to install

`mise.toml` at the repo root pins Node to `.nvmrc` (24.21.0) and `mise`
resolves it on `cd`; if `mise current node` differs, `mise install`. Omarchy
ships Perl 5 (5.42.2 on 2026-10-12).

### 5. Check the whole machine

```bash
bun run machine
journalctl --system -n1 --no-pager
systemd-inhibit --list
perl -v
```

`bun run machine` prints the admission thresholds from `tolaria.config.json`
beside the live readings. Linux counts runnable **and** uninterruptible tasks
in the load average, so the same `loadMax` can read higher here than on macOS
for the same work; compare with the idle reading in the bench's § 4.
`systemd-inhibit --list` must show no `block`-mode sleep inhibitor you did
not expect: only `delay` ones (NetworkManager, UPower, Omarchy's lock).

## Convex on the Huawei

Health's Convex preflight and its `check:ui --all` walk run on the Huawei
(topology B', ADR 0154), so the deployment they sign in against runs there
too, as a systemd **user** unit, and never depends on the MacBook (issue
#5468). Scenario seeds stay on the MacBook's own deployment.

The unit, [`tolaria-convex.service`](../../scripts/runner-units/tolaria-convex.service),
runs `convex dev --local` in the primary checkout, which is the command
`convex:ensure` used to spawn by hand. It runs the watcher, not the bare
`convex-local-backend`, because the watcher pushes the primary checkout's
functions whenever they change. Nothing else deploys functions before a walk,
so the bare binary would serve whatever was pushed last. The deployment is the
one `.env.local` in the primary checkout names (`VITE_CONVEX_URL`,
`CONVEX_DEPLOYMENT=local:<name>`). The lane accounts a walk signs in with are
minted there at the start of each run and destroyed at the end
(`scripts/ui-gate/lane-account.ts`), so there is nothing to seed.

It listens on `127.0.0.1` only. That is deliberate: every caller (health, the
walk, `convex:ensure`) runs on the Huawei, and `convex dev --local` has no bind
option. Reaching it from the LAN would mean the bare binary on `0.0.0.0` plus
a deploy step, and nothing needs that yet.

`convex:ensure` finds the unit installed (`systemctl --user cat
tolaria-convex.service` succeeds) and hands it the start:

- the URL answers → nothing happens;
- the unit is active but silent → wait, then `systemctl --user restart`;
- the unit is inactive → `systemctl --user start`.

It never spawns a second watcher beside the unit and never kills the unit's
process by hand.

### Install

Stop the hand-started watcher first, or the unit's backend finds port 3210
taken. Then install the unit. Lingering is needed for it to start at boot
with nobody logged in. `sudo` needs a real terminal (see § 1 above):

```bash
REPO=$(git rev-parse --show-toplevel)   # the PRIMARY checkout
# Only the primary checkout's watcher — never a worktree session's.
for p in $(pgrep -f "convex dev --local"); do
    [ "$(readlink /proc/$p/cwd)" = "$REPO" ] && kill "$p"
done
sleep 5 ; pgrep -af convex-local-backend   # nothing
(cd "$REPO" && mise trust && mise exec -- bun --version)   # the unit's toolchain resolves
mkdir -p ~/.config/systemd/user
sed -e "s|__REPO__|$REPO|g" -e "s|__MISE__|$(command -v mise)|g" \
    scripts/runner-units/tolaria-convex.service \
    > ~/.config/systemd/user/tolaria-convex.service
sudo loginctl enable-linger "$USER"
systemctl --user daemon-reload
systemctl --user enable --now tolaria-convex.service
```

The unit carries its own `KillMode=control-group` and
[unit tag](#g-unit), so it needs no
[`tolaria-unit.conf`](../../scripts/runner-units/tolaria-unit.conf) drop-in.
To remove it, run `systemctl --user disable --now tolaria-convex.service` and
delete the file.

### Prove it

```bash
systemctl --user status tolaria-convex.service   # enabled; active (running)
bun run convex:ensure                            # "answers — nothing started"
bun run check:ui -- --all                        # reaches it: exit ≠ 3
```

Then reboot, do not log in for a minute, log in, and run the first two
commands again. The unit must read `active (running)` with its start time at
boot, and `convex:ensure` must start nothing. If it fails, run
`journalctl --user -u tolaria-convex.service -n 50`. The usual causes are an
untrusted `mise.toml` (`mise trust` in the checkout), bun missing from the
global mise config (the repo's `mise.toml` pins only Node), or a watcher still
holding the port.

## The health runner

Batch health runs on the Huawei (topology B', ADR 0154 §9). It is not started
by `land`. The [health runner](#g-health-runner), `bun run health:runner`
(`scripts/health-runner.ts`, issue #5467), is one oneshot service that a
systemd timer starts every 5 minutes. Each tick:

1. fetches `origin/<base>` (the base branch in `tolaria.config.json`);
2. reads the lineage from the verdict store;
3. counts the base commits since the last gated tip with
   `git log --first-parent <last gated tip>..origin/<base>`. Each one is a
   landing, and its age is its merge time;
4. applies the same cadence rule `land` applies on the MacBook (20 landings
   or 8 h since the first un-healthed one, 90-minute dedup, a proved repair
   first). The rule is `runnerPlan` in `scripts/lib/health-cadence.ts`;
5. on a fire, runs `health-main` the way `land`'s detached decision does: the
   offline gates in its own throwaway worktree, then the walk if one is owed.
   `health-main` writes the verdict through the store.

No ledger file crosses machines and nothing uses ssh. A repair is fired at
once only when it is PROVED: `land` writes AMBER to the store when the
repair's lane ran the failing tests. A repair declared with `--repair` or by
closing a `/health-fix` issue, with no proof, leaves nothing in the store, so
the runner gates it with the next batch (20 landings or 8 h). Run `bun run
health` on the Huawei to confirm it sooner. The runner never
claims, lands, seeds a scenario or opens a `health:fix` issue. On a
[second RED](#g-second-red) it stops gating and notifies the owner once.

**A RED carries its evidence to the MacBook** (issue #5589). `health-main`
publishes it as a commit comment on the gated sha: the failing step, the
failure kind (`assertion`, `timeout`, `crash`, `gate`, `unparsed`), the
vitest projects and files, the FAIL blocks and the output tail. The commit
status's link points at it, and its description carries `failure:` and
`tests:`. Read it from either machine with `bun run health:status` (a
summary) or `bun run health:status --evidence` (the whole body). The log
under `.claude/telemetry/health/` stays on the Huawei, and nothing on the
MacBook reads it. On the MacBook, `loop:afk` repairs the RED with one
headless `health:fix` per tip. The attempt is recorded as a `health-fix`
commit status on the red sha, so both machines see what was tried.

### Turning it on — the order matters

Do the steps in this order:

1. **The store becomes shared.** Set `health.verdictStore` to `github` in
   `tolaria.config.json` (a PR, landed like any other). Both machines then
   read one verdict per tip, a commit status with `context=health`. `gh auth
status` must succeed on the Huawei, because the runner and `health-main`
   write through `gh`.
2. **Install the units on the Huawei** (below), then prove one tick with
   `--dry-run`.
3. **Name the runner.** Add `"healthRunner": { "platform": "linux" }` to
   `tolaria.config.json` (a PR). From then on:
    - `health:runner` gates on `linux` and exits at once ("nothing to do")
      everywhere else;
    - on the MacBook, `land`'s cadence becomes the
      [stale-verdict fallback](#g-stale-verdict).

If you set `healthRunner.platform` while the store is still `file`, the
MacBook can never see the runner's verdict. Every due batch then reads as
stale, and the MacBook gates it locally and sends a notification.

### Environment

| What               | Where it comes from                                                                                                                                                                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toolchain          | `mise exec` in the primary checkout, as for [`tolaria-convex`](#convex-on-the-huawei): Node at the repo's pin, bun from the global mise config                                                                                                                                     |
| Convex deployment  | The primary checkout's `.env.local`: `VITE_CONVEX_URL=http://127.0.0.1:3210`, `CONVEX_DEPLOYMENT=local:<name>`, served by the [`tolaria-convex` unit](#convex-on-the-huawei). The service starts after it. If the deployment is down, health records `infra` at `preflight:convex` |
| GitHub             | `gh` logged in as the owner (`~/.config/gh`). It writes the commit status and, on a RED, the evidence comment                                                                                                                                                                      |
| Push notification  | `TOLARIA_NOTIFY_CMD` in `~/.config/tolaria/runner.env` (optional). It runs with `sh -c` and gets the message as `$1`, e.g. `curl -s -d "$1" ntfy.sh/<topic>`. Without it the runner uses `notify-send`, which only reaches a logged-in desktop                                     |
| The runner's state | `.claude/telemetry/health/runner.json` in the primary checkout: the last fire (the dedup stamp) and the second RED already notified                                                                                                                                                |
| The machine        | Everything in [Set up the Huawei](#set-up-the-huawei-for-the-batch-gates). Machine admission waits on PSI before the heavy gate                                                                                                                                                    |

On the MacBook, `land`'s cadence runs under the land-runner. To make the
stale-verdict notification a push as well, add the same `TOLARIA_NOTIFY_CMD`
to the `EnvironmentVariables` of its launchd agent
([`com.tolaria.land-runner.plist`](../../scripts/runner-units/com.tolaria.land-runner.plist)).
Without it, macOS shows the notification on the desktop.

### Install

```bash
REPO=$(git rev-parse --show-toplevel)   # the PRIMARY checkout
mkdir -p ~/.config/systemd/user ~/.config/tolaria
for f in tolaria-health.service tolaria-health.timer; do
    sed -e "s|__REPO__|$REPO|g" -e "s|__MISE__|$(command -v mise)|g" \
        "scripts/runner-units/$f" > ~/.config/systemd/user/$f
done
sudo loginctl enable-linger "$USER"
systemctl --user daemon-reload
systemctl --user enable --now tolaria-health.timer
```

The installed service runs exactly
`ExecStart=<mise> exec -- bun scripts/health-runner.ts` in `WorkingDirectory=<primary checkout>`.
It carries its own `KillMode=control-group` and [unit tag](#g-unit), so it
needs no [`tolaria-unit.conf`](../../scripts/runner-units/tolaria-unit.conf)
drop-in. `TimeoutStartSec=6h` matches `MAX_PENDING_MS`: a batch that has gone
unanswered that long is the MacBook's to gate anyway. To remove it, run
`systemctl --user disable --now tolaria-health.timer` and delete both files.

### Prove it

```bash
bun run health:runner --dry-run                 # the decision, nothing run or written
systemctl --user list-timers tolaria-health.timer
journalctl --user -u tolaria-health.service -n 20
bun run health:status                           # the verdict health-main wrote
gh api "repos/{owner}/{repo}/commits/$(git rev-parse origin/staging)/statuses" --jq '.[] | select(.context=="health")'
```

`--dry-run` prints one line, either `holding — <reason>`, `firing on <trigger>
— <reason>` or `stopped — <reason>`. The first tick after the store turns
`github` fires `unproven`, because no verdict exists yet to count from.

### Recovery

| Symptom                                                          | Cause and fix                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stopped — SECOND RED …` on every tick                           | By design. A proved repair (`land` writes AMBER) or a GREEN by hand (`bun run health` on the Huawei) ends it. To get the notification again, delete `notifiedSecondRed` from `runner.json`                                                                    |
| `holding — the verdict store is unreadable`                      | `gh` cannot reach GitHub or is logged out. Run `gh auth status`. The tick gates nothing until the store reads                                                                                                                                                 |
| `holding — health already started for tip …` and no run is going | A run died without a verdict (reboot, OOM). The dedup expires after 90 minutes. To re-fire sooner, delete `lastFire` from `runner.json`. The runner passes `--retry-infra`, so a tip left `infra` is gated again; a RED tip is not                            |
| Verdicts are `infra` at `preflight:convex`                       | The deployment is down: see [Convex on the Huawei § Prove it](#prove-it-1)                                                                                                                                                                                    |
| Verdicts are `infra` at `preflight:machine`                      | PSI stayed over the cut-off past `machine.waitMaxS`. Run `bun run machine` and find the load                                                                                                                                                                  |
| The MacBook notifies "health runner silent"                      | A batch has been due for 6 h with no GREEN or RED since (an `infra` does not count). Check `systemctl --user status tolaria-health.timer` and `journalctl --user -u tolaria-health.service` on the Huawei. The MacBook's own run has already gated that batch |
| `health:status` says `evidence: none published`                  | The publish failed: `journalctl --user -u tolaria-health.service` shows `the RED evidence could not be published` with `gh`'s error. The verdict still carries `failure:` and `tests:`. The log exists only on the Huawei                                     |
| `nothing to do` on the Huawei                                    | `healthRunner.platform` is absent or names another platform in the primary checkout's `tolaria.config.json`. Pull the base                                                                                                                                    |

## The crons

The hourly housekeeping and the nightly Bot upkeep **no longer run from
systemd timers** (issue #5644, ADR 0156 Amendment I). Both are jobs of
`.github/workflows/post-merge.yml` on the Huawei's [`lane`](github-pipeline.md#g-lane)
runner, so the units `tolaria-housekeeping.{service,timer}` and
`tolaria-nightly.{service,timer}` were deleted from
[`scripts/runner-units/`](../../scripts/runner-units/). What each does and when
it fires: [post-merge](github-pipeline.md#post-merge).

The job runs as the owner in a worktree of this machine's primary checkout, so
what the units needed still holds: `housekeeping` pushes `gaps:sync`'s
allowlist to the base branch, so `gh auth status` must succeed and `git push`
must work from the primary checkout (`GH_TOKEN` in
`~/.config/tolaria/runner.env` if the keyring is not reachable from a user
service); `health:nightly` needs `tolaria-convex` up, like the health runner.

### Retire the old timers

On a Huawei that installed them before issue #5644, once, from the primary
checkout:

```bash
systemctl --user disable --now tolaria-housekeeping.timer tolaria-nightly.timer
rm -f ~/.config/systemd/user/tolaria-{housekeeping,nightly}.{service,timer}
systemctl --user daemon-reload
```

Left running they would run the same steps a second time (both are
idempotent, so the cost is a wasted run, not a wrong one).

## Glossary

### <a id="g-health-runner"></a>Health runner

`scripts/health-runner.ts` (`bun run health:runner`) is batch health on the
machine `healthRunner.platform` names. A systemd timer starts one cadence tick
every 5 minutes, and the tick rebuilds the cadence rule from the verdict store
and git. It gates, writes verdicts, and does nothing else.

### <a id="g-stale-verdict"></a>Stale-verdict fallback

This is what `land`'s cadence does on the MacBook once a health runner is
named. A batch that is due is left to the runner. If the runner writes no
GREEN or RED within `MAX_PENDING_MS` (6 h) of the batch falling due, the
MacBook gates that batch locally, once, and notifies the owner. It never does
so on a [second RED](#g-second-red).

### <a id="g-second-red"></a>Second RED

A RED on a lineage whose earlier RED a proved repair (AMBER) had already
answered: the repair did not hold. The AFK loop stops and the health runner
stops gating, and each notifies once.

### <a id="g-reaper"></a>Reaper

`scripts/reaper.ts` (`bun run reaper`) — the process that ends the trees nobody
owns any more. Active: it runs on a timer, rather than waiting for somebody to
call the script that started a tree.

### <a id="g-sweep"></a>Sweep

One run of the [reaper](#g-reaper): read the [leases](#g-lease), read the
process table, decide, signal, log. One sweep at a time per machine; every
2 minutes.

### <a id="g-lease"></a>Process lease

A JSON file under `~/.cache/tolaria/leases/` saying who owns a tree: its
[anchor](#g-anchor), cwd, parent lease and deadline
(`scripts/lib/process-lease.ts`). Alive while the [anchor](#g-anchor) runs,
the deadline is ahead and the cwd exists.

### <a id="g-anchor"></a>Anchor

The process whose life a [lease](#g-lease) follows — the `gate:run` runner,
the gate, the `claude -p` pass. Recorded with its start second, so a recycled
pid is not mistaken for it.

### <a id="g-tag"></a>Owner tag

`TOLARIA_OWNER=<lease id>` in a process's environment, inherited through every
fork and exec and kept after the parent dies — which is what lets the
[reaper](#g-reaper) attribute an orphan whose parent chain is gone.

### <a id="g-unit"></a>Unit tag

An [owner tag](#g-tag) starting `unit:`: the tree belongs to a service manager
(launchd, systemd), which ends it itself. The [reaper](#g-reaper) never reaps
on one.

### <a id="g-grace"></a>Grace window

A span after a legitimate re-attach (a second `gate:run` call to the same run)
during which the [reaper](#g-reaper) takes no action on that
[lease](#g-lease)'s tree, whatever its deadline says.

### <a id="g-net"></a>Pattern net

The [reaper](#g-reaper)'s last rule, for strays nobody tagged (a process
started by hand): an orphan matching a tooling command pattern, past an age
threshold. A process with a live parent — a dev server in a terminal — is
never an orphan.
