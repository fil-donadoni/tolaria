# UI design system: semantic tokens + universal Panel frame

The app's visual language (Zelda BotW–inspired, MTG-themed) is enforced through two centralized mechanisms: **semantic design tokens** in `src/index.css` (`surface`, `accent`, `danger`, `parchment`, `text`, etc.) and a **single shared `Panel` component** in `src/components/ui/panel.tsx` that owns the corner-bracket frame motif and is consumed by every panel-like surface (dialogs, lobby cards, deck rows, battlefield zones, stack, mana pool). Components never reach for chromatic Tailwind utilities (`bg-amber-30`, `bg-zinc-800`) or duplicate the frame's HTML/CSS — theming and shape changes happen in one place.

## Single palette: shadcn remapped to the semantic tokens (Antique Bronze)

Originally the app carried **two** colour systems at once: the bespoke semantic tokens above (driving `.btn-tone-*` and the `Panel` frame) and a full parallel shadcn OKLCH palette (`--primary`, `--secondary`, `--popover`, `--foreground`, `--background`, `--border`, `--input`, `--muted`, `--destructive`, `--ring`) driving every shadcn primitive (`Button`, `Dialog`, `Input`, `Command`, `ContextMenu`). Half the UI was themed and half was stock shadcn, the two disagreed, and contrast could not be fixed surface-by-surface while both coexisted (PRD #589).

The Design System Overhaul (PRD #589, "Antique Bronze") collapsed this to **one palette**:

- **The shadcn primitive tokens are remapped to the semantic palette.** In `src/index.css` the `:root`/`.dark` blocks point `--primary`, `--primary-foreground`, `--secondary`, `--popover`, `--foreground`, `--background`, `--border`, `--input`, `--muted`, `--destructive`, `--ring` (and the `--sidebar-*`/`--chart-*` aliases) at the Antique Bronze hex values. shadcn supplies **components only — never colour**: a new `Button`/`Dialog`/`Input` is on-theme automatically (user story 21). The parallel generic OKLCH palette is eliminated as a source of truth.
- **The semantic token roles are unchanged — only their values changed.** `--color-surface*`, `--color-accent*`, `--color-secondary-accent*`, `--color-danger*`, `--color-parchment`, `--color-text*` keep their names and meanings; the Antique Bronze values (engraved warm-charcoal grounds `#0d0b07`/`#16110a`/`#241d12`, antique-gold trim `#c9a24b`/`#ecc878`, cool-teal secondary accent `#5f97a8`, garnet `danger` `#b1473a`, parchment `#f3ead2`) replace the prior values. Because roles are stable, this remains a token edit, not a component rewrite.
- **Contrast = ambient/signal split, not lower opacity.** The root cause of the old "muddy" look was translucency applied to the _signal_ layer (panels/buttons at ~80% opacity, faked greys from low-opacity white). Atmosphere (gradients, glows, grain, art) now lives only on **background** layers; signal surfaces (panels, buttons, selected state, dialog content) are **opaque and high-contrast**. No surface fakes grey from low-opacity white.

The direction, materials, and component shapes were validated in a throwaway prototype (DEV-gated `/design-prototype` route, code under `src/components/prototype/`, decisions in its `NOTES.md`). The validated decisions were folded into the real components across PRD #589's slices; the prototype and its route registration were then deleted (issue #601) — prototype code was never promoted directly.

## Considered Options

- **Chromatic naming (`zelda-amber-30`)** — rejected: couples class names to the current theme; renaming when the inspiration changes touches every component.
- **Differentiated frames per panel role** — rejected: more visual hierarchy at the cost of drift across 30+ surfaces; the user explicitly flagged duplicated frame HTML/CSS as a current problem.
- **Props-based Panel API (`<Panel title=... footer=... />`)** — rejected in favor of composition (`<Panel><PanelHeader/><PanelBody/><PanelFooter/></Panel>`): matches the shadcn `Dialog`/`DialogHeader` pattern already in `ui/`, scales when a panel grows, and avoids contributors recreating headers inline when prop shape doesn't fit.
- **One file per sub-component for `Panel`** — rejected for `ui/` primitives only: `panel.tsx` bundles `Panel` + `PanelHeader` + `PanelBody` + `PanelFooter` + `CornerBrackets` + `SunburstIcon` matching `dialog.tsx`. The one-component-per-file rule continues to apply to domain components under `board/`, `lobby/`, `cards/`, etc.
- **Keeping the parallel shadcn OKLCH palette** — rejected (PRD #589): two disagreeing palettes made every surface half-themed and blocked a root-cause contrast fix. shadcn is remapped onto the semantic tokens so there is exactly one source of colour truth.
- **Re-skinning each shadcn primitive component individually** — rejected: remapping the shadcn token variables once means primitives inherit the theme with zero per-component work, and a future theme swap stays a token edit.

## Consequences

- Adding a new color requires adding a token first; ad-hoc hex picks are a code smell.
- Adding a new panel-like surface means importing `Panel`, not copy-pasting borders/brackets.
- The Antique Bronze theme can be swapped for another (e.g. Hyrule scroll, Sheikah slate) by editing tokens — no component touches required. Both the semantic tokens **and** the shadcn primitive tokens move together because the latter are remapped onto the former.
- New structural slot in panels (e.g. `PanelSidebar`) is added as a sub-component, never as a prop on `Panel`.
- shadcn is for component behaviour/accessibility only. Its colour variables are downstream of the semantic palette; never hardcode an OKLCH value back into a shadcn token, or the single-palette guarantee breaks.
