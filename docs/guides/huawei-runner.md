# Runner machines — the reaper

How to install, check and remove the [reaper](#g-reaper) on both machines of
topology B' (ADR 0154): a `launchd` agent on the MacBook, a `systemd` user
timer on the Huawei. Built by issue #5470. The unit files live beside the
scripts they run, in [`scripts/runner-units/`](../../scripts/runner-units/).

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
REPO=$(git rev-parse --show-toplevel)
mkdir -p ~/.cache/tolaria/reaper
sed -e "s|__REPO__|$REPO|g" -e "s|__BUN__|$(command -v bun)|g" -e "s|__HOME__|$HOME|g" \
    scripts/runner-units/com.tolaria.reaper.plist \
    > ~/Library/LaunchAgents/com.tolaria.reaper.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.tolaria.reaper.plist
launchctl print "gui/$(id -u)/com.tolaria.reaper" | grep -E 'state|last exit'
```

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

On each machine, with the agent installed. Two strays — an untagged orphan the
[pattern net](#g-net) must catch, and a tagged arbitrary binary whose
[lease](#g-lease) dies:

```bash
# 1. Untagged orphan named like a vitest worker (parent becomes pid 1).
bash -c 'exec -a "node vitest/dist/workers/forks.js" sleep 100000 &' ; sleep 1
pgrep -fl 'vitest/dist/workers/forks.js'

# 2. A tagged python under a lease whose anchor we then kill. Homebrew's
#    python3 on macOS: Apple's own binaries (/usr/bin/*) hide their
#    environment from `ps -E`, so a tag on them cannot be read.
sh -c 'echo $$ > /tmp/anchor; exec sleep 100000' & sleep 1
bun scripts/lib/process-lease.ts put proof-1 proof "$(cat /tmp/anchor)" 3600
TOLARIA_OWNER=proof-1 sh -c "python3 -c 'import time; time.sleep(1e6)' &"
kill "$(cat /tmp/anchor)"

bun run reaper --dry-run --orphan-min-age 0   # both listed, with reasons
```

The vitest stray is reaped by the first [sweep](#g-sweep) after it is a minute
old, the python by the next [sweep](#g-sweep). Both must show in `reaped.log` with their reasons.

## Glossary

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
