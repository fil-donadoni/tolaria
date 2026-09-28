---
title: an activated haste grant is held past its attack window by hold-trick
discoveredBy: 4768
status: draft
confidence: medium
---

**What is wrong.** `isSorcerySpeedTrickDump`'s activation branch
(`convex/gre/search.ts`) calls any transient-only deferrable activation at the
mover's own sorcery timing a "trick dump", so `hold-trick` flips an
outcome-equal activated haste grant ("{R}: target creature gains haste until
end of turn") to `pass` in the precombat main phase. The grant's last useful
window is before attackers are declared (CR 508.1a / 302.6), so holding it
past that forfeits the attack rather than keeping an option. Issue #4768 fixed
the CAST shape (`isPreAttackGrant`, fired by `last-window-fire`) and kept
activations out on purpose: a pre-attack arm for activations would contradict
`hold-trick` (one flips the pick to `pass`, the other flips it back), and some
activated grants sacrifice another permanent (the conversion class the deferral
perimeter keeps out).

**Evidence.** Review of PR for issue #4768 named Boros Guildmage, Whip
Sergeant, Crimson Mage, Goblin Motivator and Akki Drillmaster as targeted
activated haste grants; the self-grant form ("{R}: this creature gains haste",
target `$source`: Thornling, Flinthoof Boar, Skyship Stalker) announces no
target and is refused by `isPreAttackGrant` too.

**Why it may not deserve its own issue.** No blade entry shows the Bot holding
one of these to its cost; the fix is an exclusion in `isSorcerySpeedTrickDump`
plus widening `isPreAttackGrant` to activations (minus `sacrificeFilter`), and
it may fold into issue #4757's root rule instead.
