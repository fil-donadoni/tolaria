---
title: The same position is searched noisier from the second-built seat — at 48 iterations Grizzly Bears is passed on 4 seeds of 10 as p2 and on none as p1
discoveredBy: 3830
status: draft
confidence: medium
---

**What is wrong.** The Bot-play sweep (`convex/gre/ai/botReach.ts`) builds one
generated position twice, once with the first-built seat holding the card and
once with the second. The two boards are identical: same lands, same fillers,
same life, same hand size, and `evaluate` returns the same value (306.85) for
both holders. Yet `searchWithTrace` at `{ iterations: 48 }` casts Grizzly Bears
on 10 of 10 seeds as `p1` and on 6 of 10 as `p2`; at 200 iterations it is 10
and 9, at 800 it is 10 and 10. The pick converges, so this is noise rather than
a wrong preference, but noise that depends on seat identity. That means some
part of the search (determinization, the rollout policy, the seeded stream's
consumption order) is not symmetric in which seat is `players[0]`.

**Evidence.** Reproduce with `buildBotReachState(getCardByName("Grizzly
Bears"), seat)` for seat 0 and 1, then `searchWithTrace(state, holderId,
{ iterations: 48 }, seed)` for seeds `0xb07, 0x5eed, 1..8`. The seat-1 passes
fall on `0xb07`, `0x5eed`, `6` and `8`.

**Why it may not deserve its own issue.** The sweep's verdict is not affected:
`played` means SOME seat chose the card, so the card is still `played`. And
a budget-dependent tie that converges by 800 iterations is ordinary rollout
noise at 48. It matters only if seat-asymmetric noise turns up in a blade
`must` entry, where a position declared for `bot: "opp"` could pass on seeds
where the same position as `"me"` would not.
