# Runner machines

How to set up the two machines of topology B' (ADR 0154): the Huawei's
one-time [setup for the batch gates](#set-up-the-huawei-for-the-batch-gates),
its Convex backend, a systemd unit ([Convex on the Huawei](#convex-on-the-huawei)),
and the MacBook's [land-runner agent](#install-the-land-runner-on-the-macbook).
The unit files live beside the scripts they run, in
[`scripts/runner-units/`](../../scripts/runner-units/). The hourly and nightly
jobs are [The crons](#the-crons). The full health gate is no longer a unit
here: it is `.github/workflows/health.yml` (ADR 0156 §4, issue #5655). The
reaper and the health runner that this page once installed were deleted by
that issue.

## Install the land-runner on the MacBook

From the primary checkout:

```bash
mkdir -p ~/.cache/tolaria/land-runner
out=~/Library/LaunchAgents/com.tolaria.land-runner.plist
bun scripts/launchd-render.ts scripts/runner-units/com.tolaria.land-runner.plist \
    > "$out.tmp" && mv "$out.tmp" "$out"
launchctl bootstrap "gui/$(id -u)" "$out"
launchctl print "gui/$(id -u)/com.tolaria.land-runner" | grep -E 'state|last exit'
```

Omit it on a machine that does not merge. `scripts/launchd-render.ts`
substitutes `__REPO__`, `__BUN__`, `__HOME__` and `__NODE_BIN__` (the directory
of `command -v node`: launchd's PATH does not carry nvm/mise, and `land`'s
`convex codegen` dies with `env: node: No such file or directory` without it,
issue #5598). It exits 1, and the installed plist is left untouched, when a
placeholder is left over or `node` is not on the rendered PATH. Verify the live
agent: `ps eww -p <pid> | tr ' ' '\n' | grep ^PATH=` shows the node directory.
Remove it with `launchctl bootout "gui/$(id -u)/com.tolaria.land-runner"` and
delete the plist.

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

The Convex preflight of health and its `check:ui --all` walk run on the Huawei
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

The unit carries its own `KillMode=control-group`, so stopping it kills the
backend `convex dev` forks. To remove it, run
`systemctl --user disable --now tolaria-convex.service` and delete the file.

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
service); `health:nightly` needs `tolaria-convex` up.

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
