---
title: hold-trick keeps Strip Mine in the bot's own main phase while the opponent's Library of Alexandria stays live through the turn
discoveredBy: 5155
status: draft
confidence: medium
---

**What is wrong.** With issue #5155's valuation in place, the bot holding an
untapped Strip Mine against an opponent's Island + Library of Alexandria (seven
cards in hand) prices the Library above the Island on every seed — but in its
OWN precombat main phase the search's pick is `pass`, mechanism `hold-trick`
(`convex/gre/search.ts`, the rule gated on `isSorceryTimingFor`): the best
activation's mean reward sits inside `outcomeEps` of `pass`, and the rule
holds an instant-speed action for a later window. Only in the opponent's end
step (`isLastDeferralWindow`) does the bot fire, which is where the `must`
blade entry `removal: Strip Mine takes the Library of Alexandria, not the
Island (issue #5155)` pins it.

Holding is wrong here: the Library's draw is itself instant-speed and live
(`canActivate` at exactly seven cards), so every priority window the bot
waits through is a window the opponent can draw in. Land destruction has no
"later is free" property when the target is an active engine.

**Evidence.** Measured in this session with the committed tree, 400 iterations,
seed `0xb1ade`: main-phase candidates Island 0.3466 / Library 0.3429 / pass
0.3307 (all inside the 0.05 band), chosen `pass`, `mechanism: "hold-trick"`;
end-step candidates Library 0.4814 / Island 0.4692 / pass 0.4687, chosen the
Library, `mechanism: "material-tiebreak"`. The leaf evaluator separates the
three (margin −36.9 / −56.6 / −67.5 after resolution).

**Why it may not deserve its own issue.** `hold-trick` is a frozen root rule
(ADR 0124 §5, `ROOT_RULE_ALLOWLIST`): narrowing it needs either a Verdict +
refit that widens the margin past the band, or a new term the fit can learn
("an active engine's activations are lost per window held") — the second is
exactly the class ADR 0124 wants expressed in the evaluation, not at the root.
The gap is also bounded: the bot still fires at the opponent's end step, so
the cost is one turn of Library draws, not a never-fired Strip Mine. Against
that: the same hold applies to any instant-speed removal aimed at an
instant-speed engine (a Prodigal Sorcerer, an Icy Manipulator), which is a
class, not a position.
