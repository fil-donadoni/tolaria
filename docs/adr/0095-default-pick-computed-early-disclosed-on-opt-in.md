# 0095 — The Default Pick is computed early and disclosed on opt-in (extends ADR 0060)

## Status

Accepted. **Extends ADR 0060** (which owns the **Selected Card** and made the
draft-time Pool the working deck). Closes issue #2271.

## Context

When a human **Seat**'s **Pick Timer** expires, `autoPickSeatTimeout` resolves
the seat's **Selected Card** if one is set and otherwise falls back to
`chooseBotPick` — the same **Pick Rating** / **Pick Heuristic** engine a **Bot
Drafter** uses. In the fallback case the Seat is never told what it took. The
card leaves the **Booster** and lands in the **Pool**, in whatever **Column**
its **Mana Value** claims; in a Pool tens of cards deep and grouped by mana
value, a card that arrived without a choice is effectively unfindable. There is
no banner and no toast for this, and the transient `"Auto-picking…"` state the
timer shows at expiry announces that an Auto-Pick is _happening_, never _what
it took_ — and it is gone by the time the new pack arrives.

The fallback path is also computed **only at expiry**, so nothing before the
timeout can name the card. That is what makes both halves of the problem
possible: the Seat cannot be warned in advance, and cannot be told afterwards.

## Decision

- **The engine's pick is computed when the pack is assigned, not at expiry, and
  persisted as its own seat field — the Default Pick.** Every mutation that
  hands a pack to a human seat (`startLimitedEvent`, `submitPick`,
  `autoPickSeatTimeout`) already loads `loadEventPickRating` +
  `loadEventCardProfile` and builds `makeBotChoosePick`, and already writes the
  event row — so the Default Pick costs one small extra field on a write that is
  happening anyway. Resolution at expiry becomes
  `selectedPickId ?? defaultPick ?? chooseBotPick(...)`, the last arm surviving
  only as a safety net for a stale/absent default.

- **It is NOT written into `selectedPickId`.** That field means a _human's_
  tentative choice (ADR 0060), it is client-written by `selectDraftPick` alone,
  and it drives the Booster card's `ring-4 ring-accent`. Writing the engine's
  pick there would light that ring for every seat on every pack, and would erase
  the distinction the whole design rests on: whose pick this is.

- **The Default Pick is disclosed only on opt-in.** A "show autopick" toggle on
  the Booster header (client-local, `localStorage`, defaulting to **off**, the
  same shape as the surface's existing `useCardZoom` prefs) renders it as a
  ring **subordinate** to the Selected Card's — thinner, dimmed — so "mine"
  always outranks "the engine's" at a glance. Off by default because a standing
  recommendation displayed on the pack conditions the Seat's own **Pick** even
  when it does not mean to; the surface must not volunteer it.

- **A Pick the clock made from the Default Pick is an Unattended Pick, and is
  marked in the Pool until the Seat picks by hand again.** The mark is
  seat-level transient state (the Pool indices auto-picked since the seat's last
  hand-made Pick), rendered as a ring on the Pool card, cleared by the next
  manual Pick — the gesture that proves the Seat is back at the table. An
  Auto-Pick that honoured a **Selected Card** is deliberately **not** marked:
  the Seat chose that card, the clock only committed it.

## Consequences

- **The disclosure is deliberately asymmetric with the computation.** The server
  knows the pick from second zero and hides it by default. A future reader
  finding a computed-but-unshown value will read it as dead code or an
  unfinished feature, and the "obvious cleanup" — show it always — silently
  reintroduces the anchoring this ADR exists to prevent. That is the sentence
  this record is for.

- **Client-side computation was rejected.** The browser could run the same pure
  `botDrafter` modules the **Draft Lab** runs (ADR 0074), which would need no
  field and no write. But its inputs are DB-backed Pick Ratings / Card Profiles
  whose reads are `assertIsAdmin`-gated, so this would mean publishing the
  drafter's tuning data to every client _and_ maintaining a second computation
  path that can drift from the resolver — on the one value that must not drift,
  since the ring's entire claim is "this is the card that will be taken".

- **No durable record of which Pool cards were unattended.** Marking is
  transient by choice: it answers "what arrived while I was away", and stops
  when that is no longer true. A Seat away for six packs who returns and picks
  one card by hand loses all six marks on that click, and nothing afterwards can
  say which they were — except the case where the Seat never returns, where the
  marks survive into deckbuild on their own. A per-card `pickSource` on the Pool
  entry was designed and rejected: it would have answered "which of these did I
  not choose" at deckbuild, at the cost of a schema field on the heavy
  `limitedSeats` payload (plus its legacy inline copy) and a mark that never
  goes away.

- **Ephemeral surfaces were rejected outright** — toast, banner, naming the card
  in text. All of them target the one person guaranteed not to be looking: the
  timeout fires _because_ the Seat stopped watching. The mark is the durable
  form of the same announcement, and it points at the card in place rather than
  naming it and sending the Seat hunting.

- **Adjacent, deliberately out of scope:** a pack with 1 card remaining
  schedules no timeout at all (`pickTimerSchedule.ts` returns `null` at ≤1), so
  an absent Seat still stalls its table on the last card of every pack — against
  what the domain model promises of a **Draft**. The Default Pick makes closing
  that nearly free (with one card left, the default _is_ that card), but it is a
  liveness defect with a different acceptance test and is tracked separately (#2278).
