# Cumulative Upkeep via Age Counters and a Scaling Cost Template

## Status

accepted

## Context

Ice Age introduces **cumulative upkeep** (CR 702.24) — the set's headline
keyword and its only structurally new engine mechanic. Roughly 30 ICE cards
carry it, far more than any one-off. At the beginning of the permanent's
controller's upkeep, an **age counter** is put on it, then the controller _may_
pay the cumulative upkeep cost **once for each age counter** on it; declining —
or being unable to pay — sacrifices the permanent. The cost therefore grows by
one increment per turn the permanent survives.

The engine already ships a one-shot **pay-or-else upkeep trigger**
(`makeUpkeepPayOrElse` / `upkeepPayOrElse`, the Stasis / Sunken City family):
at upkeep the controller may pay a flat `ManaCost`, and declining runs an
`onDecline` callback. Cumulative upkeep is the same shape plus two new
requirements: a per-permanent running counter, and a cost that is the printed
cost **repeated N times** (N = age counters after this turn's increment).

Three forces push the design beyond a trivial extension:

1. **Cost is not just mana.** The real ICE cards demand a cost _union_:
   pure mana (`{U}`, `{1}{U}{U}`, `{3}`…), pay life (Glacial Chasm — "Pay 2
   life"), **mana _and_ life together** (Infernal Darkness — "Pay {B} and 1
   life"), and **sacrifice a permanent** (Polar Kraken — "Sacrifice a land").
   `requestMayPay` today accepts only a `ManaCost`.

2. **Cumulative upkeep is grantable.** Several cards _give_ the ability to other
   permanents rather than carrying it themselves: Breath of Dreams ("Green
   creatures have 'Cumulative upkeep {1}'") as a group static, Balduvian Shaman
   (single-target grant), and Dreams of the Dead (reanimates with a granted
   "Cumulative upkeep {2}" plus an exile-on-leave replacement). So the keyword
   must live in the ability-grant layer (layer 6), not only as a printed
   triggered ability.

3. **A restricted mana feeds it.** Adarkar Unicorn and Snowfall produce mana
   "spent only to pay cumulative upkeep costs" — a use-restricted mana, already
   modelled by ADR 0022 (restricted mana).

This is hard to reverse: the template's shape is consumed by ~30 cards now and
by the rest of the Ice Age block later (Alliances and Coldsnap carry yet more
cumulative upkeep, with snow-mana costs on top). Picking the wrong cost
representation or counter model means reworking every CU card.

## Decision

**Age counter = a plain named counter.** The accrued counter is the existing
named-counter primitive keyed `"age"`, not a new player resource and not a
bespoke field. Its running total is the cost multiplier. This reuses counter
storage, projection, and SBA plumbing unchanged.

**One declarative template generates the triggered ability.** A
`cumulativeUpkeepTrigger({ cost })` helper — sibling to `upkeepPayOrElse` —
emits a "your upkeep" `phaseTrigger` that (a) increments the `age` counter, (b)
asks the controller to pay `cost × ageCount`, (c) sacrifices the permanent on
decline or inability. Multiple cumulative-upkeep triggers stack and order under
the normal APNAP rules (CR 603.3b), like any other upkeep trigger.

**The cost is a small union, scoped to what the Ice Age block actually uses:**
`{ mana?: ManaCost; life?: number; sacrifice?: <permanent predicate> }`, any
combination of which may be present (Infernal Darkness sets both `mana` and
`life`). Scaling by age count is **repetition of the whole cost**, not a
multiply-the-numbers shortcut, so "pay {B} and 1 life" at three age counters is
"pay {B}{B}{B} and 3 life", and "Sacrifice a land" at two counters sacrifices
two lands — paid all-or-nothing (CR 702.24c). **Discard-as-cost is deliberately
omitted** — no ICE card uses it; it is added the day a set needs it.

**`requestMayPay` is generalized from `ManaCost` to the cost union.** The
may-pay choice gains optional `life` and `sacrifice` legs alongside `mana`; the
flat pay-or-else family keeps working (mana-only is the union's degenerate
case). "Unable to pay" (can't produce the mana, not enough life, nothing legal
to sacrifice) collapses to the decline branch → sacrifice, with no fake prompt
(ADR 0003 auto-resolve).

**Cumulative upkeep is a grantable ability via layer 6.** The keyword is
expressed so it can be conferred by a static effect (Breath of Dreams' group
grant, Balduvian Shaman's single grant, Dreams of the Dead's reanimation
grant), reading its cost from the granting effect. A granted CU behaves
identically — age counters accrue on the _host_, paid by the host's controller.

**Restricted CU mana reuses ADR 0022.** Adarkar Unicorn / Snowfall produce mana
tagged usable only for cumulative upkeep costs; no new mana machinery.

## Consequences

- `requestMayPay` widening touches every current caller, but mana-only callers
  are unaffected (the new legs are optional). The drift-guard and existing
  pay-or-else tests pin the degenerate case.
- The `age` named counter shows up in projection like any counter; no schema
  field is added to `GameState`, so no `PERSISTED_OPTIONAL_KEYS` entry is
  needed for it.
- Repetition-based scaling keeps the all-or-nothing rule and arbitrary cost
  types correct by construction, at the cost of building a cost list rather than
  scaling a number — accepted, since non-mana and mixed costs (Infernal
  Darkness) make a numeric multiplier wrong anyway.
- The cost union is intentionally ICE-scoped (mana / life / sacrifice). Alliances
  and Coldsnap will add snow-mana CU costs; because snow mana is itself deferred
  (see CONTEXT.md "Snow"), that extension lands with the set that needs it, not
  speculatively now.
- Grantable CU means the keyword must be readable from layer-6 ability grants,
  not just printed triggers — a small amount of extra indirection that pays off
  immediately (three ICE granters) rather than a future refactor.

## Amendment (issue #977): summed-power threshold on the sacrifice leg

The `MayPayCost` sacrifice leg introduced above (`{ filter, count }`) originally
carried a **fixed cardinal** `count` — "sacrifice N matching permanents". Mirage
adds Phyrexian Dreadnought, whose self-ETB punisher is _"sacrifice it unless you
sacrifice any number of creatures with total power 12 or greater"_ (CR 118 /
701.16). That is not a fixed count but a **variable-size set gated on summed
power**. Rather than add a new Effect Script Op (the mechanic is already a
`mayPay` punisher — the counter/consequence shape the interpreter runs), the
`count` field is widened in place to a union:

```ts
sacrifice?: {
    filter: PermanentFilter;
    count: number | { minTotalPower: number };
};
```

- **`number`** — the unchanged fixed cardinal (shock lands, cumulative upkeep).
- **`{ minTotalPower: N }`** — "sacrifice any number of matching permanents
  whose summed EFFECTIVE power (CR 613 layer pipeline) is ≥ N". Over-payment is
  legal; minimality is not required. Affordability sums the matching candidates
  with power `> 0`; the submit boundary validates the payer's chosen set reaches
  the threshold; the bot / auto-pick default takes candidates highest-power-first
  until the running total reaches `N`.

The threshold deliberately rides the **cost leg** (a `mayPay` punisher) rather
than a generic `choice`-Op rider: Phyrexian Dreadnought's decision is
cost-or-lose-the-permanent, exactly what `mayPay` + `if !$paid` already models.
A general "sacrifice things totalling power N" rider OUTSIDE a cost context is
deferred until a card needs it (YAGNI). No new `GameState` field is added — the
threshold rides the existing `may-pay` PendingChoice's `cost`, so no
`PERSISTED_OPTIONAL_KEYS` change is required.
