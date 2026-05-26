# UI design system: semantic tokens + universal Panel frame

The app's visual language (Zelda BotW–inspired, MTG-themed) is enforced through two centralized mechanisms: **semantic design tokens** in `src/index.css` (`surface`, `accent`, `danger`, `parchment`, `text`, etc.) and a **single shared `Panel` component** in `src/components/ui/panel.tsx` that owns the corner-bracket frame motif and is consumed by every panel-like surface (dialogs, lobby cards, deck rows, battlefield zones, stack, mana pool). Components never reach for chromatic Tailwind utilities (`bg-amber-30`, `bg-zinc-800`) or duplicate the frame's HTML/CSS — theming and shape changes happen in one place.

## Considered Options

- **Chromatic naming (`zelda-amber-30`)** — rejected: couples class names to the current theme; renaming when the inspiration changes touches every component.
- **Differentiated frames per panel role** — rejected: more visual hierarchy at the cost of drift across 30+ surfaces; the user explicitly flagged duplicated frame HTML/CSS as a current problem.
- **Props-based Panel API (`<Panel title=... footer=... />`)** — rejected in favor of composition (`<Panel><PanelHeader/><PanelBody/><PanelFooter/></Panel>`): matches the shadcn `Dialog`/`DialogHeader` pattern already in `ui/`, scales when a panel grows, and avoids contributors recreating headers inline when prop shape doesn't fit.
- **One file per sub-component for `Panel`** — rejected for `ui/` primitives only: `panel.tsx` bundles `Panel` + `PanelHeader` + `PanelBody` + `PanelFooter` + `CornerBrackets` + `SunburstIcon` matching `dialog.tsx`. The one-component-per-file rule continues to apply to domain components under `board/`, `lobby/`, `cards/`, etc.

## Consequences

- Adding a new color requires adding a token first; ad-hoc hex picks are a code smell.
- Adding a new panel-like surface means importing `Panel`, not copy-pasting borders/brackets.
- The Zelda BotW theme can be swapped for another (e.g. Hyrule scroll, Sheikah slate) by editing tokens — no component touches required.
- New structural slot in panels (e.g. `PanelSidebar`) is added as a sub-component, never as a prop on `Panel`.
