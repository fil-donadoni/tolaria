---
title: AppHeader (Browse top bar) has no top safe-area padding
discoveredBy: 2594
status: draft
confidence: medium
---

**What is wrong.** `src/components/chrome/app-context-bar.tsx` (the Immersive
bar) now pads for `env(safe-area-inset-top)` (issue #2594) — it is the first
thing rendered in Immersive mode, flush against the shell's own top edge. Its
Browse-mode sibling, `src/components/chrome/app-header.tsx`, sits in exactly
the same position (first element, `<div className="relative z-20 mx-auto
w-full max-w-6xl shrink-0 px-4 …">` in `app-shell.tsx`, no vertical padding
above it) whenever `showsBottomNav` is false and no return banner is showing —
tablet/desktop always, and a landscape phone.

**Why it wasn't fixed here.** The issue's own body text names "Immersive bars"
explicitly, not the Browse top bar, and `AppHeader` already drops to a
`short-viewport:h-10` (40px) compact form on a landscape phone — the device
class most likely to have a real inset. Adding `pt-[env(safe-area-inset-top)]`
there risks squeezing that already-compact 40px row's icon/text sizing on a
notched landscape phone, which I could not verify without a live device or a
CDP safe-area-inset override (the five `check:ui` viewport profiles do not set
one), so I left it as a documented gap rather than a browser-unverified guess.

**Why it may not deserve its own issue.** The desktop/tablet case (no notch)
is unaffected either way (`env()` resolves to 0). It matters only for a
landscape phone or a notched tablet running the app in standalone/PWA mode —
worth confirming with a real device before spending a ticket on it; if
`AppHeader`'s `short-viewport:h-10` row turns out fine as-is (Safari's own
"safe" content inset may already reserve the space some other way in that
mode), this is a non-finding.
