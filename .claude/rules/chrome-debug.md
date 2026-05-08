# Chrome Debug Rules

When verifying UI/UX or reproducing gameplay scenarios in Chrome via the
`claude-in-chrome` MCP, **always use solo mode**. A solo game is a single-user
match: one user controls both players and the viewer auto-switches to whoever
currently has priority. This removes the need for two browser tabs and lets
you reach a playable board with the fewest possible MCP actions.

## Solo-mode setup (one batch, four actions)

Pre-populate `localStorage` so the lobby skips deck selection and name input,
then click `New Solo Game`. The whole flow fits in a single
`browser_batch`:

```jsonc
[
    {
        "name": "tabs_context_mcp",
        "input": { "createIfEmpty": true }
    },
    {
        "name": "javascript_tool",
        "input": {
            "tabId": <TAB_ID>,
            "action": "javascript_exec",
            "text": "localStorage.clear(); localStorage.setItem('tolaria:selectedDeckId','mono-red-burn'); localStorage.setItem('tolaria:playerName','Debug'); 'ready'"
        }
    },
    { "name": "navigate", "input": { "tabId": <TAB_ID>, "url": "http://localhost:5173" } },
    { "name": "find",     "input": { "tabId": <TAB_ID>, "query": "New Solo Game button" } }
]
```

Then click the returned `ref_*` and screenshot. Total: **two MCP round-trips**
to reach a playable board.

### Storage keys

| key                      | purpose                                            |
| ------------------------ | -------------------------------------------------- |
| `tolaria:selectedDeckId` | preset id of the deck (e.g. `mono-red-burn`)       |
| `tolaria:playerName`     | display name (becomes "X (P1)" / "X (P2)" in solo) |
| `tolaria:gameId`         | active game id — clear to force return to lobby    |
| `tolaria:playerId`       | session player id — clear together with `gameId`   |

Available preset ids: `white-weenie`, `mono-red-burn`, `channel-fireball`,
`mono-green-stompy`, `le-deck`, `gueddon`, `mono-black`. Pick whichever deck
exposes the cards your scenario needs (`mono-red-burn` is a fine generic
default for non-deck-specific debugging).

## Already in a game?

If a game is already loaded, do **not** go back through the lobby — open the
debug panel and click `Restart Solo` (or `New Solo Game` if the current match
isn't solo). It reuses the current deck and switches you into a fresh solo
game in one click. Same outcome, fewer MCP actions.

## Loading a preset scenario

Once on the board:

1. `find` → click the `Debug` button (bottom-right)
2. `find` → click `Scenarios`
3. `find` → click the scenario label

Add new scenarios to `PRESET_SCENARIOS` in
`src/components/debug/debug-panel.tsx` whenever you need a repeatable starting
position — that's faster than scripting card placements via JS.

## Verifying the auto-switch

The defining property of solo mode: the viewer follows the player who has
priority. To check it:

1. Screenshot — note which player's life total is highlighted at the bottom.
2. Press <kbd>Space</kbd> (Pass) once.
3. Screenshot — the bottom should now show the **other** player, with their
   hand revealed and the previous player's hand backed.

If both screenshots show the same viewer, the auto-switch is broken.

## Caveats

- Never call `confirm()` / `alert()` — modal dialogs freeze the MCP session.
  The Debug panel's `Reset Game` and `Restart Solo` are safe; avoid `Clear
Storage` because it triggers a full reload and breaks the batch.
- Do not open a second tab to simulate the opponent — solo mode replaces that
  workflow entirely.
- Console errors should always be checked with
  `read_console_messages(onlyErrors: true)` after any state-changing action.
