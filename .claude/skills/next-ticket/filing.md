# /next-ticket — an issue this session files inherits its band

Reached from `SKILL.md` when you are about to run `gh issue create`.

Every issue the session files by hand — an abort prerequisite, a follow-up
split off an acceptance criterion this PR cannot meet, a defect found on the
way — takes the band of the issue being worked, straight after
`gh issue create` (owner rule, issue #4928):

```bash
bun run issue:inherit-band <N> <new>
```

It copies the band `queue:plan` orders `N` by (the open umbrella's
`Priority`, else `N`'s own) onto `<new>`'s board `Priority`, reads it back,
and refuses rather than overwrite a band already set. It COPIES a hand-set
band and never derives one — the one way a script writes `P0` (ADR 0143,
Amendment IV). The issue body's `## Band` names the same band and where it
came from. Gap issues are not filed by hand: `land` already passes the band
to `gaps:sync --band`. Labels and the `## Band` section follow
`docs/agents/triage-labels.md` § Every new issue is stamped at filing.

**Done when:** `issue:inherit-band` read the band back on `<new>`, and its
body carries `## Band` plus an `area:*` and a type label.
