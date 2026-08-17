# Browser verification

**How to prove a UI change actually renders.** The norm itself — when this is
mandatory — is resident in `.claude/rules/chrome-debug.md`; this guide is the
procedure, read on demand.

Task-by-task click sequences (start a game, reach the deck builder, load a
scenario) live in [UI runbooks](ui-runbooks.md). Read that one when the
question is "how do I GET to the screen", this one when it is "how do I prove
the screen is right".

## Why the unit tests do not cover this

The `dom` vitest project runs on happy-dom. It has a DOM tree, and it has no
layout engine: no viewport, no paint, no stacking contexts, no scroll
containers. `getBoundingClientRect()` returns zeroes. Every assertion of the
form "the card is in the document" passes on a screen where the card is
sitting under a fixed footer at 2px tall.

Measured on 2026-08-17, on the Limited pool builder, on `main`, with the whole
`dom` project green: at 390x844 (iPhone-class portrait) **90 of 95 card images
were occluded** by the legality/footer form; at 844x390 landscape, 77 of 95.
The cards were "rendered" by every test the repo had. A human on a phone saw
an empty pool.

That is the gap this guide closes. It is not a style check — it is the only
check that looks at pixels.

## The tool: chrome-devtools-mcp, not the Claude extension

Use the `mcp__plugin_chrome-devtools-mcp_chrome-devtools__*` tools. They speak
CDP to a Chrome instance the plugin manages — no extension, no side panel, no
site-approval step.

The Claude-in-Chrome extension (`mcp__claude-in-chrome__*`) is the other
option and it **does not work in Arc**: Arc does not implement
`chrome.sidePanel`, the panel never opens, so the per-site approval it needs
can never be granted, and every call ends in `tabs_context_mcp … did not
respond in time` with `Your approved sites: none`. Do not spend turns
diagnosing that — go straight to CDP.

Core calls:

```
list_pages                       # what is open
navigate_page {type,url}         # url | back | forward | reload
take_snapshot                    # a11y tree with uids — prefer over screenshots
click {uid}                      # includeSnapshot:true to get the next tree free
fill {uid,value}
evaluate_script {function}       # measurement lives here
emulate {viewport}               # device emulation, see below
take_screenshot                  # evidence, not diagnosis
list_console_messages {types}    # ["error"] after every state change
```

`take_snapshot` costs a fraction of a screenshot and gives clickable uids;
screenshots are for the PR receipt and for the cases where the question is
genuinely visual (overlap, colour, cropping).

## The viewport matrix

Emulate, do not resize the window — `emulate` sets DPR, touch and the mobile
flag, which is what triggers the responsive branches.

```
emulate { viewport: "1440x900x2" }                        # desktop
emulate { viewport: "390x844x3,mobile,touch" }            # phone portrait
emulate { viewport: "844x390x3,mobile,touch,landscape" }  # phone landscape
```

A change to a shared layout primitive (Panel, a zone surface, a scroll
container) owes all three. A change scoped to a desktop-only affordance owes
desktop plus one phone pass to prove it did not leak.

Emulation persists across navigations in the same page, so set it once and
walk the runbook.

## The occlusion probe

Eyeballing a screenshot is how the pool bug shipped: the strip of cards was
visible in the screenshot, cut off at the bottom, and read as "cards are
there". Measure instead. Paste this into `evaluate_script` after reaching the
screen:

```js
() => {
    const vw = innerWidth,
        vh = innerHeight;
    const imgs = [...document.querySelectorAll("img")].filter((i) =>
        /scryfall|card/i.test(i.src)
    );
    let zero = 0,
        occluded = 0;
    const covers = {};
    for (const i of imgs) {
        const r = i.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) {
            zero++;
            continue;
        }
        const cx = Math.min(Math.max(r.left + r.width / 2, 0), vw - 1);
        const cy = Math.min(Math.max(r.top + r.height / 2, 0), vh - 1);
        const top = document.elementFromPoint(cx, cy);
        if (top && !i.contains(top) && !top.contains(i)) {
            occluded++;
            const k = top.tagName + "." + (top.className || "").split(" ")[0];
            covers[k] = (covers[k] || 0) + 1;
        }
    }
    return {
        viewport: vw + "x" + vh,
        total: imgs.length,
        zero,
        occluded,
        covers,
    };
};
```

It answers three different failure modes at once:

- `zero` — the element collapsed (a flex child with no basis, an image with no
  intrinsic size).
- `occluded` — the element is laid out but something is painted over its
  centre. `covers` names the culprit, which is usually the fixed footer or a
  sticky form.
- `total` — the count itself. A pool of 90 that probes 0 images never rendered
  the list at all.

Swap the `img` selector for whatever the change is about (`[data-card-id]`,
`button`, a zone container). The three questions do not change.

Two things the probe does not see: an element scrolled outside its own
container (legitimate — that is what scrolling is for) and colour/contrast
regressions. For the first, scroll the container in `evaluate_script` and
re-probe; for the second, look at the screenshot.

## What goes in the PR

State the surface, then per viewport: the probe output line and one
screenshot. Three lines and three images is the whole receipt.

```
Deck-builder zones, verified in Chrome (CDP):
- 1440x900   → total 95, zero 0, occluded 0
- 390x844    → total 95, zero 0, occluded 0
- 844x390    → total 95, zero 0, occluded 0
console errors: none
```

A change with no browser receipt and no "cannot reach the DOM" note is not
done. Saying "the dom tests pass" is not a receipt — see the measurement at
the top of this page for what that is worth.

## Console errors

`list_console_messages {types:["error"]}` after every state-changing step.
React key warnings and Convex validator errors both surface here and both
predict a broken screen for the next person.
