# PROTOTYPE — `/prototype/touch` (PRD #2405, #G1) — throwaway

Question: which touch gesture model for the editing surfaces (draft room,
deckbuilder, search) — and do the two-stop pack/pool snap, the peek sheet's
CTA row, the 3-tab builder and the chamfer prompt feel right on a real phone?

## Run

```bash
cd /Users/filippo/code/mtg/tolaria-proto-touch   # branch prototype/touch-gestures
# the dev Convex backend is LOCAL (127.0.0.1:3210) — the phone cannot reach that
# address, so point the client at the Mac's LAN IP or the login spins on "Working…":
VITE_CONVEX_URL=http://192.168.0.47:3210 VITE_CONVEX_SITE_URL=http://192.168.0.47:3211 \
  bunx vite --host --port 5183
# phone on the same Wi-Fi → http://192.168.0.47:5183/prototype/touch  (log in once)
```

URL params: `?surface=builder|draft|prompt` · `?variant=A|B|C` (prompt: A|B).
The floating pill (top-left) cycles variants (← / → on keyboard too); the
surface tabs sit above it. The gesture log (top-right) says WHY each gesture
resolved as tap / scroll / drag / preview.

## Variants

| key | builder + draft                               | what to judge                                                      |
| --- | --------------------------------------------- | ------------------------------------------------------------------ |
| A   | long-press (250ms) = drag; swipe scrolls      | does the hold feel discoverable? false drags while scrolling rows? |
| B   | no touch drag; tap card, tap destination      | is "armed" state (pulsing tabs/rows) clear? two taps vs one drag?  |
| C   | tap selects → grip above the card; grip drags | is the grip reachable with a thumb? does it occlude the card?      |

All three: tap = select + peek sheet (portrait bottom / landscape rail) with the
44px CTA row (→ Side / → Pool / Inspect) — D16 says this is the PRIMARY path,
drag/two-tap is the power-user path. B/C keep hold(400ms) = preview; A cannot
(hold is the drag).

Builder: portrait = MV rows (duplicates collapsed ×N, rows scroll
horizontally, `overscroll-behavior-x: contain` so a row swipe does not flip the
tab pane); landscape = pile columns. Tabs = drop targets; panes swipe.
Draft: pack 85% ↔ pool 85% with scroll-snap mandatory; the pool strip (first
15% of the pool pane) is the live tab + drop target (SB half = pick to SB); the
pack pane's last 15% is its status bar / peek CTA row.
Prompt: A chamfered plate + arrow Confirm vs B rounded panel.

Prompt variants and the draft surface have no persistence; reload = reset.

## Verdicts so far (2026-08-19)

- Builder: **A** (long-press drag). Must also drag between rows/columns.
- Prompt: **B** rounded panel. Chamfer rejected.
- Draft: landscape = pack 80 | 20% sneak-peek pile + actions under; swipe → pack pile / pool MV columns (implemented round 2). Inspect closes on any tap except Pick. Portrait picks split Main/SB.

## Known limits (prototype, not findings)

- Bucket pinning (dropping on a specific MV row/column) is logged, not modelled.
- No density toggle on the pack grid (D11 4×4 mode).
- CardImage deliberately NOT used (its own hover/long-press preview is the thing being re-decided).
