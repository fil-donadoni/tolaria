---
title: A "combat-to-and-by" prevention slot is signed beneficial, so Maze of Ith on the opponent's attacker reads as misdirected
discoveredBy: 5815
status: declined
confidence: medium
declinedReason: >
    No decision moves today. The sign is read by the root misdirection penalty,
    which ranks siblings of ONE announcement against each other, and every
    candidate of an "attacking creature" requirement sits on the active
    player's side in a two-player game — the own-vs-opponent split this
    finding assumed never exists. Elvish Scout / Ebony Horse are
    `controller: "you"`, Goblin Snowman is `$source`. The only reachable
    effect is a future Bot-play sweep pose once Maze of Ith / Foxfire compile
    `ready` (both `unparsed` today): a gap row there is the signal to act.
---

**DECLINED (triage of issue #5815's finding).** See `declinedReason`.

**What is wrong.** Issue #5815 made `opBeneficence` read `preventDamage`'s
sign off its mode: `"all-from-source"` names the source whose damage is erased
and signs `"harmful"`, every other mode stays `"beneficial"`. The
`"combat-to-and-by"` mode stayed `"beneficial"`, but it is two-sided: it
prevents the damage dealt TO the creature and the damage dealt BY it. Maze of
Ith (`convex/cards/sets/drk/colorless.cards.ts`) and Foxfire
(`convex/cards/sets/ice/green.cards.ts`) target ANY attacking creature, and
their other Op (`tapUntap` untap) is beneficial as well. So
`misdirectedTargetCount` ranks the opponent's attacker, which is the card's
main defensive use, as the misdirected sibling of the bot's own attacker.

**Evidence.** `convex/gre/ai/opValuers.ts`: the `preventDamage` case in
`opBeneficence`, together with `collectScriptSigns` in
`convex/gre/ai/beneficence.ts`. Elvish Scout and Ebony Horse carry
`controller: "you"`, so the requirement already forces their orientation and
the sign is harmless there.

**Why it may not deserve its own issue.** Re-signing the mode `"harmful"`
alone gives `mergeSign` a beneficial untap plus a harmful prevent, which comes
out `"neutral"`. That drops the self-save line and still leaves the two
targets unranked. The effect really is two-sided, so it needs a design (for
example a per-field split like `SPLIT_SIGN_OPS`, or a board-aware read). It is
not a flat sign flip, and no blade position has shown the blunder yet.
