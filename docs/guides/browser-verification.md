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
form "the card is in the document" passes on a screen where the card sits in a
24px-tall container.

Measured 2026-08-17 on `main`, with the whole `dom` project green, at 390x844
(phone portrait): on the Limited pool builder the two card zones were **24px
and 66px tall while their card tiles are 101px**; 25 of 95 card images were
occluded outright. The same shape on `/decks/create`: a 24px zone holding
158px children. A human on a phone saw no cards. Every test the repo had said
they were rendered.

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
emulate { viewport: "1440x900x2" }                         # desktop
emulate { viewport: "390x844x3,mobile,touch" }             # phone portrait
emulate { viewport: "844x390x3,mobile,touch,landscape" }   # phone landscape
emulate { viewport: "820x1180x2,mobile,touch" }            # tablet portrait
emulate { viewport: "1180x820x2,mobile,touch,landscape" }  # tablet landscape
```

Five viewports since ADR 0101 (the tablet pair was where the deck builders hid
their worst clipping). A change to a shared layout primitive (Panel, a zone
surface, a scroll container) owes all five. A change scoped to a desktop-only
affordance owes desktop plus one phone pass to prove it did not leak.

Emulation persists across navigations in the same page, so set it once and
walk the runbook.

## The probe

Eyeballing a screenshot is how the deck-builder bug shipped: the strip of
cards was visible, cut off at the bottom, and read as "cards are there".
Measure instead. Paste this into `evaluate_script` after reaching the screen:

```js
() => {
    const V = innerWidth,
        H = innerHeight;
    const canScroll = (e) =>
        e.scrollHeight > e.clientHeight + 2 ||
        e.scrollWidth > e.clientWidth + 2;
    const scrollableAncestor = (e) => {
        for (let p = e.parentElement; p; p = p.parentElement) {
            const cs = getComputedStyle(p);
            if (/auto|scroll/.test(cs.overflowY + cs.overflowX) && canScroll(p))
                return true;
        }
        return false;
    };
    const probe = (list) => {
        const o = {
            n: list.length,
            zero: 0,
            occ: 0,
            reachable: 0,
            stranded: 0,
        };
        for (const e of list) {
            const r = e.getBoundingClientRect();
            if (r.width < 4 || r.height < 4) {
                o.zero++;
                continue;
            }
            const cx = r.left + r.width / 2,
                cy = r.top + r.height / 2;
            if (cx >= 0 && cx <= V - 1 && cy >= 0 && cy <= H - 1) {
                const t = document.elementFromPoint(cx, cy);
                if (t && !e.contains(t) && !t.contains(e)) o.occ++;
            } else if (scrollableAncestor(e)) o.reachable++;
            else o.stranded++;
        }
        return o;
    };
    const starved = [];
    for (const el of document.querySelectorAll("*")) {
        const cs = getComputedStyle(el);
        if (!/auto|scroll/.test(cs.overflowY + cs.overflowX)) continue;
        const kids = [...el.children];
        if (!kids.length || el.clientHeight === 0) continue;
        const tallest = Math.max(
            ...kids.map((k) => k.getBoundingClientRect().height)
        );
        if (tallest > 40 && el.clientHeight < tallest * 0.9)
            starved.push({
                cls: (el.className || "").toString().slice(0, 34),
                h: el.clientHeight,
                tallest: Math.round(tallest),
            });
    }
    return {
        vp: V + "x" + H,
        cards: probe([
            ...document.querySelectorAll(
                'img[src*="scryfall"],img[src*="card-back"]'
            ),
        ]),
        ctrls: probe([...document.querySelectorAll("button,a[href]")]),
        starvedN: starved.length,
        starved: starved.slice(0, 4),
    };
};
```

### Reading the output

- **`zero`** — the element collapsed: a flex child with no basis, an image
  with no intrinsic size. Always a defect.
- **`occ`** — laid out, inside the viewport, and something else is painted
  over its centre. Almost always a defect; the exception is deliberate overlap
  (the hand fan on the board reports a few).
- **`stranded`** — outside the viewport with no scrollable ancestor: the user
  cannot reach it by any gesture. Always a defect.
- **`reachable`** — outside the viewport but inside something that scrolls.
  **Not** a defect; this is what a long list looks like.
- **`starved`** — a scroll container shorter than the tallest thing inside it.
  This is the metric that catches the deck-builder class: the cards were not
  occluded and not collapsed, they were in a 66px window. Read it with
  judgement — a 300px container holding a 1200px column is a normal scrolling
  list; a 66px container holding 101px card tiles is broken, because scrolling
  cannot recover height the tile needs all at once.

**The `reachable` / `occ` distinction is why this probe looks the way it
does.** The first version clamped every element's centre point into the
viewport before hit-testing, so anything below the fold hit whatever happened
to be at the clamp point and counted as occluded — it reported 90 of 95 on a
screen whose real count was 25, and it reported 13 of 13 on a lobby that is
fine. If you write your own variant, never hit-test a point the element does
not actually occupy.

Swap the `img` selector for whatever the change is about (`[data-card-id]`, a
zone container). The five questions do not change.

What the probe still does not see: colour and contrast regressions, and
whether the layout is _good_. For those, look at the screenshot.

## What goes in the PR

State the surface, then per viewport: the probe line and one screenshot.

```
Deck-builder zones, verified in Chrome (CDP):
- 1440x900  → cards n95 zero0 occ0 stranded0, starved0
- 390x844   → cards n95 zero0 occ0 stranded0, starved0
- 844x390   → cards n95 zero0 occ0 stranded0, starved0
console errors: none
```

A change with no browser receipt and no "cannot reach the DOM" note is not
done. Saying "the dom tests pass" is not a receipt — see the measurement at
the top of this page for what that is worth.

## Console errors

`list_console_messages {types:["error"]}` after every state-changing step.
React key warnings and Convex validator errors both surface here and both
predict a broken screen for the next person.
