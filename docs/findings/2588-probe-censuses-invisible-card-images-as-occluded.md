---
title: probe.js censuses `visibility: hidden` card images, so an invisible tile can score `occ` but can never BE an occluder
discoveredBy: 2588
status: draft
confidence: high
---

**What is wrong.** The ui-gate probe's card census and its occlusion hit-test
disagree about what "visible" means, in one direction. The card list is built by
selector with no visibility filter, so a `visibility: hidden` card image is
measured and hit-tested like any other. But `document.elementFromPoint` never
returns a `visibility: hidden` element. The asymmetry: such a tile CAN score
`occ` (the hit-test returns whatever is painted beneath it, which is not the
tile), while an identical tile can never be counted as the thing occluding
someone else. Invisible content is censused as occluded content.

**Evidence.** `scripts/ui-gate/probe.js:252` builds the list:

```js
const imgs = [
    ...document.querySelectorAll(
        'img[src*="scryfall"],img[src*="card-back"],img[src*="/cards/"],img[data-card-id],[data-card-id] img'
    ),
].filter((e) => !isDecorativeArt(e));
```

The only filter is `isDecorativeArt` (`probe.js:249` — `[data-ambient-art]` /
`aria-hidden="true"`). `vis()` exists at `probe.js:36` and checks exactly
`display`, `visibility` and `opacity`, and it IS applied to the other three
censuses — small controls (`probe.js:199`), tiny text (`probe.js:224`) and
fixed/sticky bands (`probe.js:272`) — but never to `imgs`. Inside
`probe(list)` (`probe.js:86`) a `visibility: hidden` element still returns a
real `getBoundingClientRect()`, so it clears the `< 4px` `zero` branch at
`probe.js:96` and reaches the `elementFromPoint` test at `probe.js:161`, which
by spec skips it and returns the painted element underneath — `!e.contains(t)`
holds, `o.occ++`.

Surfaced while diagnosing `occ 2` on `draft-pick` at 844×390 on PR #2652: the
two tiles were `visibility: hidden`, i.e. nothing a user could see was covered
by anything.

**Why it may not deserve its own issue.** Three reasons to leave it alone.
(1) It errs in the SAFE direction only — it inflates `occ`, so the failure mode
is a false red the runner investigates, never a false green that ships a
covered card. (2) It is pre-existing and untouched by #2588; `probe.js` is not
in that PR's diff. (3) The fix is one `.filter(vis)`, but choosing it is not
obviously right: dropping invisible images from `n` also drops them from the
`zero` census, and a card that is invisible because a bug hid it is arguably
something the lane SHOULD notice. Someone would have to decide whether "hidden
on purpose" and "hidden by accident" are separable here before the one-line
change is safe — which is the argument for a line on an existing ui-gate
tracker rather than a ticket of its own.
