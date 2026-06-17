# PROTOTYPE — Board rendering: DOM high-perf vs WebGL

**Throwaway.** Delete `src/routes/prototype-board*` + remove the route reg in
`src/router.tsx` once the decision is captured. Also drop `motion` / `pixi.js`
from `package.json` if the chosen path doesn't need them.

## Question being answered

The UI revolution brief says "replace the CSS board with a canvas". Is "canvas"
**literal** (WebGL surface — Pixi/Three, cards as sprites) or a **metaphor**
for a high-end animated DOM board? They cost wildly differently, so we look
before deciding.

## How to run

Dev server already runs. Open `http://localhost:5173/prototype/board`
(logged in). Bottom bar: switch **DOM (Motion)** ⇄ **WebGL (Pixi)**, drag the
Battlefield/Hand sliders, hit **Cast → BF** to feel a hand→battlefield zone
transition. FPS meter top-right of the bar.

## What to look at

| Dimension                   | Watch for                                                                                                                                                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Text crispness**          | The P/T badge. DOM = native font, crisp at any zoom/hover. WebGL = rasterized `Text`, pick-a-resolution, softens on scale. (Card ART is an image in both — equal.)                                                                                                              |
| **Motion feel**             | Cast a card, drag cards, change counts. Both should feel fluid at normal counts.                                                                                                                                                                                                |
| **Stress**                  | Push Battlefield to 40–60. Where does each engine's FPS hold?                                                                                                                                                                                                                   |
| **Interaction cost (CODE)** | Compare `dom-board.tsx` (~110 lines, native `drag`/`whileHover`) vs `webgl-board.tsx` (~210 lines, manual hit-test, manual ticker tween, manual hover). This gap IS a finding — every interaction in WebGL is hand-wired, and a11y/DOM tooltips/text selection are simply gone. |

## Finding surfaced while building (counts toward the decision)

WebGL textures need **CORS-clean, same-origin** image bytes. The current app
serves card art from `cards.scryfall.io` via a **service worker**
(`public/sw-cards.js`) that returns _opaque_ responses — fine for a DOM
`<img>` (display only), but they **taint/break WebGL** texture upload. To run
the WebGL variant we had to add a Vite same-origin proxy. In production a
WebGL board would force either: proxying/hosting all card art same-origin, or
reworking the SW to do CORS-mode fetches. The DOM board has none of this
constraint. → A real, recurring tax on the WebGL path.

## Not yet modelled (would only widen the gap, not change direction)

- Card hover-zoom preview, right-click ability menus, leader-line target arrows
  — all native/trivial in DOM, all manual in WebGL.
- Shader effects (particles, glow, displacement) — the ONE axis where WebGL
  wins. Could live as a thin WebGL FX layer _over_ a DOM board (hybrid).

## Three variants (fair fight)

1. **DOM (Motion)** — `dom-board.tsx`. Native drag/hover, crisp text, FLIP springs.
2. **WebGL (parity)** — `webgl-board.tsx`. Same board re-done in Pixi. This is
   WebGL on DOM's home turf (text + hit-test) — its WEAKEST case. The first
   demo only showed this, which biased the comparison.
3. **WebGL (FX)** — `webgl-fx-board.tsx`. Canvas on ITS turf: animated godray
   bg, breathing glow on castable cards, holographic foil (RGB-split) on hover,
   shockwave + additive particle burst on cast. This is the "awwwards/videogame"
   ceiling DOM can't reach.

The honest question is NOT "DOM vs WebGL" but **"is the wow worth the tax?"** —
where the tax (text/a11y/hit-test/CORS, see findings) is real and the wow lives
almost entirely in the FX layer, not the board layout.

## The hybrid (likely answer)

DOM board (layout, cards, text, drag, a11y) + a **WebGL FX overlay** (a
transparent Pixi canvas on top, pointer-events: none) that only draws
particles / shockwaves / glow keyed to game events. Captures variant 3's wow
without paying variant 2's tax on the parts DOM already does well. Costs: two
render systems to coordinate, FX positioned in screen-space synced to DOM card
rects.

## VERDICT

**DOM-only. Canvas deferred.** The only genuine canvas win in this board is
additive particle/light VFX; tilt, glare, glow, motion, layout are all better
in DOM (crisp text, native hit-test, a11y). Canvas can be added LATER as a
transparent Pixi FX overlay positioned by DOM rects, with no rework — so it is
deferred, not foreclosed.

Drag-to-cast = hand only, option (a) (drop = announce cast / play land, reuse
existing pipeline). CSS 3D tilt (`card-tilt.tsx`) is the validated Arena twist.

→ PRD: fil-donadoni/tolaria#249 (board-variant flag, A+C migration).
→ These prototype routes + `pixi.js`/`pixi-filters` are throwaway; delete once
the real implementation lands. The DOM-validated bits (layout math, tilt,
drag, springs) fold into the real board.
