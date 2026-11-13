# Draft Table Audit — the Vintage Cube Floors after fetch lands × scope-relative plan

> **Measured at `32b043e06` (2026-11-13).** Issue #9369, PRD #8772.

## What broke

Once PR #9345 (fetch lands are sources, issue #9334) and PR #9320 (the plan
read against its scope, issue #9298) were both on the base, the Vintage Cube
audit failed two Floors on seeds 1..8:
`worstDeckCastability 0.762 < 0.77` and `meanPlanShare 0.482 < 0.50`. Each PR
had passed on its own, but each was measured on a different tree.

## Bisect, seeds 1..8

| Tree                                      | Worst deck | Plan share |
| ----------------------------------------- | ---------: | ---------: |
| Base `85cd2a059` (neither)                |      0.772 |      0.526 |
| + PR #9345 only (`276fdea1f`)             |      0.761 |      0.538 |
| + PR #9320 only (tip, PR #9345 reverted)  |      0.772 |      0.505 |
| Both (`aa64e94dc`, still the case on tip) |      0.762 |      0.482 |

PR #9345 alone already breaks the worst-deck Floor on these profiles. Its own
receipt was taken on the census profiles that PR #9343 later reverted.

## 64 seeds, eight blocks of eight

```bash
bun run draft:audit -- --scope vintage-cube --seeds 64 --json
```

| Tree       | Mean cast (64) | Plan share (64) | Worst deck per block (median)                   | Plan share per block (median)                   |
| ---------- | -------------: | --------------: | ----------------------------------------------- | ----------------------------------------------- |
| Base       |          0.864 |           0.543 | .772 .683 .718 .742 .746 .764 .712 .712 (0.730) | .526 .544 .554 .550 .560 .548 .535 .526 (0.546) |
| PR #9345   |          0.865 |           0.545 | .761 .659 .759 .794 .640 .664 .720 .757 (0.738) | .538 .544 .552 .551 .568 .548 .535 .526 (0.546) |
| PR #9320   |          0.863 |           0.512 | .772 .683 .718 .742 .619 .651 .712 .576 (0.697) | .505 .525 .510 .522 .517 .524 .496 .502 (0.513) |
| Both (tip) |          0.865 |           0.513 | .762 .659 .678 .629 .761 .664 .643 .745 (0.671) | .482 .512 .520 .527 .526 .518 .510 .508 (0.515) |

## Reading

- **No build regression.** Over 64 seeds, mean castability does not move
  (0.864 → 0.865), and fetch lands leave plan share unchanged (0.512 → 0.513
  with PR #9320 under both).
- **The worst deck is one seat's draw.** On a single tree it spans 0.58–0.79
  across blocks. On the base, seeds 1..8 happened to be its best block. Fetch
  lands change Fixing Value, so every pick changes and every table is drafted
  again. That is enough to lose a lucky block.
- **The tail, all 512 decks.** Fetch lands do not hurt it. PR #9320 thickens
  only its last percent; p5 and above do not move.

    | Tree     |   p1 |   p5 |  p10 | Decks < 0.77 |
    | -------- | ---: | ---: | ---: | -----------: |
    | Base     | .734 | .782 | .806 |           16 |
    | PR #9345 | .751 | .786 | .811 |           14 |
    | PR #9320 | .712 | .778 | .806 |           21 |
    | Both     | .703 | .781 | .811 |           20 |

- **Plan share falls because of PR #9320**, as that PR measured. On the tip,
  seeds 1..8 are the lowest block (0.482).
- **Floors moved** in `scripts/lib/draft-audit.ts`, rounded down from the
  seeds 1..8 run as the table requires: `worstDeckCastability` 0.77 → 0.76,
  `meanPlanShare` 0.50 → 0.48. The reasons sit beside each value.
- **What follows for the next red.** The worst-deck Floor sits inside its own
  block-to-block noise. Before reading a broken Floor as a regression, run the
  same 64-seed comparison.
