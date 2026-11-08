# Who repairs a RED: the hosted release never fixes, a hand run may

## Status

accepted (2026-11-08, issue #8725). Draws the boundary ADR 0118 left implicit
after ADR 0156 and ADR 0158. Evidence: `.github/workflows/release.yml`,
`scripts/release.ts`.

## Context

ADR 0118 made a RED release verdict start a bounded fix loop with a fixer
session, only with a TTY. The release now runs hosted (`release.yml`) with
`--no-fix`: no terminal, so a RED is a failed job and the owner's failed-run
email. RED repair itself belongs to ADR 0156's ladder and ADR 0158's
revert-first rule, with ADR 0163's contained RED. `scripts/release.ts` keeps the
fix loop for hand runs.

## Decision

- **Hosted `release` (`--no-fix`)**: refuses on RED, spawns nothing. The repair
  is the reopened issue's ordinary pass (ADR 0158): revert first, fix forward.
- **Hand `bun run release` with a TTY**: may still start the bounded fix loop of
  ADR 0118, unchanged (bound, file return channel, fail-closed).
- ADR 0118's framing "RED starts a fix loop" is true of the hand run only.

## Consequences

- ADR 0118 gains a status line pointing here.
- Nothing in the code changes.
