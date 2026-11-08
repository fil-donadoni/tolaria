# The AFK loop driver is retired; ADRs 0092, 0097, 0099, 0109 and 0147 are history

## Status

accepted (2026-11-08, issue #8725). Records what ADR 0156 did and issue #7486
finished on 2026-10-29. Evidence: `docs/research/adr-audit-2026-11-07.md`.

## Context

Five records describe the home-built AFK driver: ADR 0092 (fan-out stays
model-driven), 0097 (out-of-process shell loop, budget proxy), 0099 (hand-off
and crash retry), 0109 (a pass never starts the driver; budget mandatory) and
0147 (terminal as rendered view of the stamped log). ADR 0156 replaced the
orchestration with GitHub-native workflows; `loop-drain.sh`,
`loop-handoff.sh`, `train-order.ts` and `loop-render.ts` were deleted on
2026-10-29 (issue #7486). ADR 0110's 2026-11-04 amendment names `afk-dispatch`
as the driver, but none of the five says it is retired.

## Decision

The loop driver and its terminal are retired. The dispatcher is the
`afk-dispatch` workflow (`.github/workflows/afk-dispatch.yml`,
`scripts/afk-dispatch.ts`); a pass is `afk-pass.yml` and `/next-ticket`. The
five records are **superseded by ADR 0156 (driver) and ADR 0110 (one session,
one issue)**. The budget question of 0109 lives on as the dispatcher's admission
by queue depth, not as a token proxy.

## Consequences

- Each of the five gains a status line pointing here.
- Their bodies are kept as history of what the shell driver defended.
