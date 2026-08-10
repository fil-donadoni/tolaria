# A face-down permanent carries WHY it is face down (`faceDownKind`), and the paid turn-up is a special action

## Status

proposed

## Context

Face-down permanents shipped with ADR 0013 for exactly one card, Illusionary
Mask. `gre/faceDown.ts` swaps the instance's `card.id` to a registered 2/2
vanilla sentinel and overwrites the stored characteristics, so every def-derived
reader (colours, abilities, P/T, layers) sees the 2/2 automatically (CR 708.2);
the real id survives in `faceDownOf`, and `projectExileCard` /
`projectPublicState` re-derive the per-viewer identity gate on the wire.

Illusionary Mask's creature turns face up **automatically**, as a replacement
effect (`gre/replacements.ts:251`), the moment it would deal or be dealt damage
or become tapped. Nothing in the engine — and nothing in `CONTEXT.md`, which
says a turn-up happens "never by paying a cost" — models a turn-up the
controller **chooses** and **pays for**.

Manifest (CR 701.40) and manifest dread (CR 701.62, Abhorrent Oculus, issue
#703) are exactly that: "Turn it face up any time for its mana cost if it's a
creature card." Per CR 116.2b this is a **special action** — no stack, no
priority passed, taken any time its controller has priority. Morph (CR 702.36),
megamorph, disguise (CR 702.166) and cloak (CR 701.58) are all the same shape
with different costs and riders, and all sit `planned` in the Mechanics
Registry.

So the engine needs to answer, per face-down permanent: **may its controller
turn it face up by paying, and paying what?** Today that question has one hard
coded answer ("no"), and it is not derivable from the instance — a manifested
card and a Masked card are byte-identical on the battlefield.

## Decision

**1. `CardInstanceState.faceDownKind` — a discriminated reason, set by
`turnFaceDown`.** `"mask" | "manifest"` today; `"morph" | "megamorph" |
"disguise" | "cloak"` as each ships. The paid-turn-up rule switches on it:

- `"mask"` — no player-initiated turn-up at all. Today's replacement-effect
  behaviour, unchanged; the shipped card keeps its exact semantics.
- `"manifest"` — legal only while `faceDownOf` is a **creature card**
  (CR 701.40b), cost = that card's printed mana cost.

Rejected: storing the permission as flat data (`turnUpCost?: ManaCost` +
`turnUpRequiresCreature?: boolean`). It looks more general and is in fact less
honest — every subsequent keyword bolts on another boolean (megamorph's +1/+1
counter, disguise's ward), and the flag space represents combinations no printed
keyword has. A discriminated kind adds one arm per keyword, each carrying its
own rider, and makes an unimplemented keyword a compile error rather than a
silently-wrong default.

Rejected: deriving it globally ("face down + the real card is a creature ⇒
payable turn-up"). This would silently make Illusionary Mask's creatures
turn-upable for mana — breaking a shipped card and contradicting CR 708 for the
Mask case, whose whole point is that the turn-up is not a cost.

**2. The paid turn-up is a special action (CR 116.2b), modelled on the
companion summon.** The companion special action (CR 116.2/702.139a, ADR 0064 —
`gre/moves.ts:1361`, `applyMove.ts:298`, with its matching `search.ts` bot
branch) already establishes the shape: a non-stack move, offered while its
controller has priority, paid through the `pendingCast` payment seam so the
normal mana-payment UI and auto-tap apply. The turn-up reuses that path
wholesale rather than inventing a second non-stack payment.

Consequences that follow and are part of this decision:

- `turnFaceUp` stays the single mutator (CR 708.9); the special action pays and
  then calls it. The replacement-driven Mask path and the paid manifest path
  converge on one function, so a future characteristic restored wrongly is
  wrong in exactly one place.
- Turning face up is **not** casting and **not** a spell — it uses no stack, so
  it cannot be responded to and triggers nothing that watches casts (CR 701.40b).
- The bot needs the move in its enumeration (`search.ts`), or a manifested
  creature can never be turned up in a vs-AI game.
- `CONTEXT.md`'s **Turn Face Up** entry loses its "never by paying a cost"
  clause; **Manifest Dread** is added beside it.

## Consequences

Positive: morph/megamorph/disguise/cloak each become one arm plus their own
cost source, on a seam that already exists; the Mask's semantics are pinned by
an explicit arm instead of by the absence of a feature; the paid turn-up
inherits payment, auto-tap and bot enumeration from the companion path.

Negative: `faceDownKind` is a new optional `GameState`-reachable field, so it
owes `PERSISTED_OPTIONAL_KEYS` (`serialize.ts`) an entry and a round-trip smoke
test, and `projectPublicState` must carry it — the kind is **public**
information (everyone can see that a permanent was manifested rather than
Masked; only the identity underneath is hidden), so it is not redacted.

Divergence, deliberate: CR 701.40's plain manifest ("manifest the top card of
your library") is not built — only manifest dread (CR 701.62) has a card in the
pool. Plain manifest is a thin second Op over the same `manifestCard` helper
when a card needs it. Tracked with the Mechanics Registry row for CR 701.40,
which stays `planned`.
