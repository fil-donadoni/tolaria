# UI design system unification: one button, one banner, one modal, signal tokens

Phase 3 of the UI/UX revamp (spec `docs/superpowers/specs/2026-07-20-ui-ux-revamp-design.md`) collapses the drift the ADR-0007 system accumulated back into its single-palette / single-frame guarantees, and adds the missing token families the audit found hard-coded across 71 files.

## Decisions

- **Contrast fixes are token edits, verified numerically.** `text-disabled` `#6f6244 → #968a68` (2.78–3.28:1 → ≥4.5:1 on every surface); `danger` as text → existing `danger-strong` (7.99:1) everywhere; new `--color-border-strong: #7d6b42` for control edges (≥3:1, WCAG 1.4.11); input focus is an accent border + ring (8.2:1, was 1.41:1); the dialog scrim went `bg-black/10` → the single `--color-scrim` (black/50); the shadcn popup edge `ring-foreground/10` (1.27:1) → `ring-border-accent/40`. A guard test (`src/__tests__/design-tokens.test.ts`) parses `index.css` and re-derives every ratio so the values can't silently regress.
- **One Button.** `ui/Button` is the single component: cva variants map onto the forged-plate `.btn-tone-*` classes (primary/secondary/destructive/ghost/link). The three retired systems collapse in: raw `.btn-tone-*` buttons (42 uses), shadcn-variant names (`default → primary`, `outline → secondary`), and the board's ad-hoc "Beleren plates" (→ primary/destructive `sm`). Board `ActionButton` is now a thin wrapper. Card-overlay buttons and circle numeral pickers stay bespoke (positioned overlays / card numerals, not standard controls). Disabled state is owned by the component.
- **One inline notice.** `ui/Banner` (tones danger / info / prominent / success / neutral) replaces the 13 copy-pasted banner recipes — including the error banner that existed verbatim in 6 files.
- **One modal language.** Everything converges on the Panel frame (ADR 0007): bug-report moved off plain shadcn onto `GameDialog`; the black-glass pickers (mana/alt-cost/mode/phyrexian, combat panels) and the 15 floating board prompts (60 hand-drawn corner brackets) now render the shared `Panel` frame; scrims use `--color-scrim`; ActionSheet stays as the mobile touch pattern (ADR 0009). GameDialog additionally emulates overlay-click dismissal itself: its popup spans ~90vw/80vh so the backdrop was unreachable and pile browse dialogs (graveyard/library/hand/exile) never closed on overlay click (QA) — a click landing on the popup container now closes it.
- **Signal hues are tokens.** `--color-signal-self(-strong)` (turn/priority/selection), `--color-signal-opponent(-strong)`, `--color-signal-pending(-strong)`, `--color-signal-target(-strong)`, and `--color-combat-1..4` replace the raw emerald/rose/amber/violet/combat-group utilities (ADR 0007's no-chromatic rule). Buff/debuff/damage map onto the existing success/danger families. The priority indicator's inline `rgba()` edge glows are now `color-mix` off the tokens.
- **Named z layers.** `--z-hud/sheet/arrows/modal/modal-top/modal-peak` (40/50/60/100/110/120) with matching utility classes replace the flat ladder where `z-100` served 35 consumers and `z-[110]`/`z-[120]` existed only to beat it. Card-internal stacking (0–30) stays bare — it never escapes a card.
- **Dead layer verdicts.** `TitleTreatment` ADOPTED (headlines the game-over dialog, its #597 purpose); `OrnamentalDivider` kept; keyrune kept (user call: the set glyph in `set-filter`); `StatChip` PRUNED (component, `.stat-chip` CSS, tests — the `GameDialog.stats` slot still accepts any node). `bg-surface-2`/`bg-surface-muted` were deleted, never defined: their 6 consumers moved to `surface-elevated`.
- **`/design-system` is a permanent page.** The census (every token with live WCAG ratios, chrome atoms, component variants, retired-vs-current recipes) is kept as the living reference — unlike `/prototype/*` spikes — and is lint-clean production code. Update it when the system changes.

## Considered options

- **Define `bg-surface-2`/`bg-surface-muted` tokens** — rejected: six consumers, all better served by the existing `surface-elevated`; fewer near-duplicate surfaces.
- **Keep two button systems (plate for lobby, shadcn for dialogs)** — rejected: the triplication was the drift; one cva API over the plate classes keeps base-ui behaviour AND one visual language.
- **Migrate all 107 bare z-index values** — rejected: the card-internal band (0–30) is scoped inside cards and never collides; only the board-and-above layers moved to names.
- **Full re-skin of debug tooling** — rejected: `debug/*` is dev tooling, explicitly out of the visual pass.

## Consequences

- New chromatic classes are a code smell the same way ad-hoc hexes were: signal/state colour comes from `signal-*`/`combat-*`/semantic tokens.
- `design-tokens.test.ts` fails CI if a token value drops below its WCAG rung.
- The `/design-system` page must be updated when tokens, chrome, or variants change (AGENTS.md).
- QA follow-ups shipped in the same pass: pile browse dialogs close on overlay click; counter chips use the plate language; declare-attackers draws one gold arrow per attacker to its target (player nameplate or planeswalker, CR 508.1a) with an info banner, and the solo viewer-swap stale-anchor bug (arrows landing on the wrong nameplate) is fixed by bumping the DOM publisher's revision with the seat assignment.
