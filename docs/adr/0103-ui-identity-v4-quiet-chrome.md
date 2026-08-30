# UI identity v4: "quiet chrome, loud world" — graphite ground, monochrome ivory chrome, Geist display, hairline panels, full-card board (amends 0007 / 0069 values; leaves 0101 untouched)

**Status:** accepted (2026-08-23). Supersedes the Antique Bronze _values_ of ADR 0007 and ADR 0069; keeps their _contract_ (semantic token roles, one `Panel`, one `Button`, shadcn remapped onto the palette). Leaves ADR 0101 (layout, viewport matrix, shell modes, touch model) untouched.

## Context

The UX pass of 2026-08 (PRD #2405, ADR 0101) fixed how the app _behaves_ across five viewports; it did not touch how it _looks_. A measured side-by-side with phase.rs (`preview.phase-rs.dev`, 2026-08-23) showed why a newcomer would pick their client on sight: our warm ground (`#0d0b07`/`#16110a`) under warm gold chrome under warm card art reads as one hue with no figure/ground separation; the lobby is ~5% art against their ~60%; one type size in Beleren small caps carries every title; gold is brand, action, border and title at once; opaque brown boxes with corner brackets sit on an already-dark page. The gap is the **Skin** (CONTEXT.md), not the layout. The bar is raised; the prior "identity stays" clause of the 2026-08 decisions (D1–D15) is withdrawn for the skin.

## Decision

A new visual identity, **v4**, as a skin change — token values, type, frame, materials, motion — with the token _roles_ of ADR 0007 and the layout of ADR 0101 unchanged:

1. **Register: quiet chrome, loud world.** The chrome is cold, dark and nearly colourless so that card art, mana symbols and game-state signals carry all the colour (Elden Ring / Baldur's Gate 3 menus, not Arena). No aesthetic constraint survives from v3: gold is not required.
2. **Ground: cold graphite**, not navy (navy is phase's). `surface-base #0b0d11`, `surface #14171c`, `surface-elevated #1c2027`, hairline `ivory/12`, `ivory/30` strong. The existing WCAG guards (`design-tokens.test.ts`: text ≥4.5:1 on every surface, `border-strong` ≥3:1, plate labels ≥4.5:1) stay the acceptance test for every value.
3. **Chrome is monochrome: graphite + ivory `#efe9da`.** The primary action is an opaque ivory plate with dark text; secondary = hairline; ghost = text. No brand hue on chrome. The game-state signal tokens (`signal-self/opponent/pending/target`, `combat-*`, `danger`, `success`) keep their hues — they carry meaning, not identity.
4. **Type: Geist for everything on the chrome** — display 500 weight, −0.025em tracking, lining tabular numerals; UI 400/600; eyebrow labels uppercase 10.5–11px tracking .16em (never monospace — the mono eyebrow is phase's dev-dashboard signature). **Beleren is confined to the card domain** (text-only card faces, card frame). Serif displays (Cormorant, Crimson Pro, Source Serif 4) were built, shown and rejected.
5. **Panel = hairline + material.** `1px` ivory/12 border, 4–6px radius, a fine grain (SVG noise at ~7% overlay) and a soft shadow for elevation; **no corner brackets**. One ornament atom survives — a rule with a diamond — for hero and game-over only. Same `Panel` composition API (`PanelHeader/Body/Footer`); same `Button`/`Banner`/`GameDialog`/`ActionSheet`/`BottomSheet` primitives, re-skinned once.
6. **Lobby is a game main menu, not a web page**: four art-backed **Mode Tiles** (Play vs Bot · Solo game · Open a table · Limited), one **Loadout** (active deck + Bo1/Bo3 + the single primary action), **Deck Shelves** (your decks, presets), live Limited events in a footer, a player HUD; fits one desktop viewport. The existing navigation (Home · Limited · Decks · Admin · Settings · Sign out; phone bottom nav) stays.
7. **The board shows the real printed card**, full image, everywhere — never an art-crop tile with an Arena-style name band. Card corners use a proportional radius (`4.8% / 3.45%`, the printed corner — see the amendment below) on every card surface and on the tilt wrapper, so no background ever shows at a corner. Card size is **adaptive per zone**: width = min(max, (zone − gaps) / n) — a zone never clips and never scrolls.
8. **Preserved, re-skinned:** `CardTilt3D` hover glare + 3D tilt; permanent stacks (`battlefield-stacks.ts`, same-name/same-state clusters with a count badge); the overlay strips (scry/surveil ordering, pile division, trigger order) keep today's behaviour; rings are **inset** (pseudo-element, zero layout impact) — candidates/legal targets in `signal-target`, selected in `accent`, attackers in `signal-pending`, with at most a soft outer glow.
9. **Card Preview Overlay carries an engine view** (#2704): beside the live Oracle text, the tree of keyword / target / effect / triggered / activated nodes with parameter chips, read from the real `CardDefinition`, a `DSL n/n` or `protocol` badge, "Report a problem" and rulings links.
10. **Every dialog shape is mapped once** — modal (GameDialog wide/narrow, game over, pregame, cast cost), prompt-bar (pinned Panel), banner/toast, anchored picker popover, fullscreen strip, context menu / action sheet, bottom sheet, HUD badge, text inputs — from the 2026-08-23 census (~80 surfaces, 10 shapes). Popovers and menus get 44px rows and real spacing.

## Considered options

- **Theme swap inside v3** (same Beleren/Geist, same brackets, only values) — rejected: fixes figure/ground but not type scale, surfaces or frame (diagnosis points 3–5); "Tolaria brown → Tolaria blue" with the same flat hierarchy.
- **Ink / blue-black ground** — built and shown; rejected as phase-adjacent (navy) though it pops art slightly more.
- **Brass accent** — built and shown; rejected: competes with art and with `signal-pending` (amber).
- **Art-crop permanents with a colour name band** — built and shown; rejected: the user wants the real card, and the band is an Arena/phase signature.
- **Editorial hero lobby** (serif H1 + paragraph + deck grid) — built and shown; rejected as "a website, not a game".
- **Thin-bracket or frameless panels** — built as knobs; hairline+grain chosen.

## Consequences

- ADR 0007's "theme swap is a token edit" holds: roles are untouched; the `@theme inline` values, the shadcn remap, `Panel`/`Button`/`Banner`/`GameDialog`/`ActionSheet`/`BottomSheet` skins, and the display face change. `/admin/design-system` must be updated with the v4 census.
- `design-tokens.test.ts` keeps failing the build on any value under its WCAG rungs; new v4 tokens (`--card-radius`, grain, hairline strengths) get rows there.
- `check:ui` at five viewports is the receipt for every slice; the phone board keeps ADR 0101's portrait/landscape bands — the prototype's phone layout is an illustration of the skin on those bands, not a new layout.
- The prototypes are the primary source: branch `prototype/identity-v4`, routes `/prototype/identity` (lobby + board, knobs `ground/frame/accent/font/perm/density`) and `/prototype/dialogs` (`view=preview|dialogs|elements`). They never merge; the implementation rewrites, it does not promote.
- Beleren leaves the chrome; any place that used it as a "brand" face (nav, titles, buttons, life totals) moves to Geist display.

## Amendment (779d1ca6): one `8%`, not the circular pair

`--card-radius` is **`8%`**, a single percentage, not the `4.8% / 3.45%` pair
§7 decided. The pair encoded a geometrically CIRCULAR corner: 4.8% of a 63mm
width and 3.45% of an 88mm height are the same physical 3mm. A single `8%`
resolves per axis instead — 8% of the width horizontally, 8% of the **height**
vertically — so the corner is a slightly vertical ellipse, larger than the
printed one. That is a deliberate look, chosen on the rendered board; the
circular equivalent at this size is `8% / 5.73%` if the geometry is ever wanted
back.

What §7 still holds, and what the guards hold with it, is the part that
mattered: the corner is a **fraction**, so one token serves a 40px pile thumb
and a 120px hand card. `design-tokens.test.ts` therefore asserts that the token
is a percentage and that it clears the `cardsSquare` floor in
`scripts/ui-gate/probe.js` — it no longer asserts the number itself (the
CSS ↔ typed mirror owns that) nor the `v/h ≈ 63/88` relation, which a single
value cannot express. A test that pins a look the ADR does not own is a test
that only ever blocks the next intentional change to it.
