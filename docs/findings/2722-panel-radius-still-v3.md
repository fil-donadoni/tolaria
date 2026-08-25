---
title: --radius is still the v3 10px, but ADR 0103 §5 specifies a 4–6px panel radius
discoveredBy: 2722
status: draft
confidence: medium
---

**What is wrong.** ADR 0103 §5 defines the v4 Panel as "1px ivory/12 border,
4–6px radius, a fine grain and a soft shadow; no corner brackets". The tokens
slice (#2722) shipped the border, the grain and the palette, but left
`--radius` at its v3 value, so every `rounded-sm/md/lg/xl` in the app still
derives from a 10px base and panels keep the v3 corner under the v4 skin.

**Evidence.** `src/index.css` `:root` declares `--radius: 0.625rem` (10px), and
`@theme inline` derives the whole scale from it (`--radius-sm: calc(var(--radius)

- 0.6)`= 6px …`--radius-4xl`= 26px). ADR 0103 §5 asks for 4–6px on the
Panel — i.e. roughly`--radius: 0.375rem`, which would give sm 3.6 / md 4.8 /
  lg 6px.

It was left deliberately: the issue's own "What to build" enumerates the tokens
#2722 owns (`--card-radius`, grain, hairlines, the palette, the display face)
and `--radius` is not among them, while the Panel frame is #2723's subject. But
that means the decision now lives only in this file — nothing in the tree
records that the radius is knowingly still v3, and the ADR reads as though it
shipped.

**Why it may not deserve its own issue.** It is almost certainly already inside
#2723's scope ("Panel hairline+grain without brackets"), in which case this is a
comment on that issue, not a ticket. Worth a look before #2723 is closed, since
a one-line token change is exactly the kind of thing a slice about component
recipes can finish without noticing it never happened.
