# Combat-damage prevention is a battlefield-scanned static with an explicit direction

**Status:** accepted

## Context

`combat-damage-prevention` (`cards/types.ts` `StaticCombatDamagePrevention`,
evaluated by `gre/combatDamagePrevention.ts`) is a CR 615 prevention effect
evaluated live at the combat-damage step rather than written into game state and
consumed once. Two properties, both deliberate at the time, now block the next
card:

1. **It is self-scanned.** `isCombatDamagePreventedFromSource` reads
   `tryGetDefinition(target.card.id)` — the definition of the creature that
   would TAKE the damage — and nothing else. The module documents the reason:
   the prevention is a self-protective property of the damaged creature, so its
   own definition suffices, and the SOURCE filtering is left to each effect's
   `prevents(self, damageSource, state, ctx)` predicate. Both shipped users fit
   (Enchanted Being, Wall of Vapor: "prevent combat damage dealt to ME by
   creatures matching X").

2. **It has one direction.** The only question it can answer is "is damage
   arriving at this creature prevented?". Its signature takes a
   `CardInstanceState` as the damaged object, so damage dealt to a PLAYER never
   reaches it at all.

Gaseous Form (LEG / 4ED, blocked in #1009) breaks both at once:

> Enchant creature
> Prevent all combat damage that would be dealt **to and dealt by** enchanted
> creature.

The prevention is declared by an **Aura**, and applies to a creature that is not
the Aura — an aura's static cannot be found by a scan that only opens the
damaged creature's own definition. And half the card is the "dealt by" axis,
whose most common line of play is the enchanted creature's damage to the
DEFENDING PLAYER — the case the current signature cannot represent.

Every OTHER aura in the catalogue already says "the permanent I am attached to"
the same way: `applies: (target, source) => target.id === source.attachedTo`,
found verbatim in `atq/white.ts`, `arn/blue.ts`, `leg/blue.ts` and others. The
sibling guard module `gre/permanentGuard.ts` (`isGuardedAgainst`, Guardian
Beast) already scans EVERY permanent on the battlefield for exactly this reason.
The self-scan is the outlier, not the house style.

## Decision

Make combat-damage prevention a **battlefield-scanned static effect** with an
`applies` predicate naming the permanent it protects, and give it an explicit
**direction axis**.

**Scan the battlefield, not the victim's own definition.** A permanent declares
a prevention that names some OTHER permanent; the damage site asks one question
and the scan answers it. This is the shape every other continuous static in the
engine already has, so an Aura, a global enchantment and a self-protective
creature all express themselves in the same vocabulary instead of the first two
being unrepresentable.

**Direction is declared, not inferred.** `direction: "to" | "by" | "both"` —
`"to"` prevents damage arriving at the named permanent (today's behaviour,
which both shipped users keep unchanged), `"by"` prevents damage the named
permanent would deal, `"both"` is Gaseous Form. Inferring the axis from the
`prevents` predicate was rejected: the predicate's two object parameters would
have to carry the meaning positionally, and a card wanting one axis while
filtering on the other has no way to say so.

**The "by" axis covers damage to players.** The damage site consults the scan
for permanent recipients AND player recipients. This is not an extra: the
enchanted creature connecting with the defending player is the ordinary line of
play for Gaseous Form, and a version that only muted creature-to-creature damage
would be a card that looks implemented and is wrong every time it matters.

## Consequences

**A documented optimization is deliberately undone, and must be measured.** The
self-scan exists because it is O(1) in the damaged creature's own definition
where a battlefield scan is O(permanents), and it sits on the bot's hot path —
ISMCTS resolves combat thousands of times per decision. The scan must be
benchmarked against the bot suite, not merely covered by unit tests. The
mitigation available if it bites is the one `isGuardedAgainst` already uses:
scan only permanents whose definitions declare the static at all.

**Mechanic-whole, in one change.** Both axes and the player-recipient case ship
together. A "to"-only landing would be a shipped-but-partial mechanic — the
inert-keyword shape (#957/#958) the project rules forbid — and a
`// Deferred … tracked-by:` marker on the second sentence of an Oracle text is
explicitly not an acceptable way to land a mechanic.

**It does not depend on #2016.** The attached-host `EffectObjectSelector`
(`$host`) is an Effect Script concern: it lets an _Op_ name the enchanted
permanent. `applies` already receives `source` and reads `attachedTo` itself.
The two are related context, not a blocking edge.

**It does not wait for ADR 0082.** This is a CR 615 prevention, not a CR 613
characteristic-changing continuous effect, so it is outside the Continuous
Effects Registry's scope — the same boundary ADR 0082 draws when it leaves CR
611.3 rules-modifying effects out.

## Alternatives considered

**Add attachments to the self-scan.** Keep reading the damaged creature's
definition, and additionally read the definitions of permanents attached to it.
Smaller, and it makes the Aura findable. Rejected because it addresses only the
projection half: the "dealt by" axis and the player-recipient case remain
unrepresentable, so Gaseous Form would ship as half a card. It also entrenches a
second bespoke lookup path for the one effect family that has one.

**Grant the prevention to the host through layer 6.** Have the Aura confer an
ability on its host, so the self-scan finds it where it already looks.
Rejected: preventions are not keyword abilities, so this needs a new grant
channel built solely for them — and ADR 0082 is actively working to REDUCE the
number of provenances a granted characteristic can arrive from, not to add a
fourth.
