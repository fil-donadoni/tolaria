# Unified attachment model: Equipment reuses the Aura plumbing

## Status

accepted

## Context

Issue #776 adds the Equipment subsystem (Equip cost, attach/detach, SBA),
unblocking a cluster of Vintage Cube artifacts (Skullclamp, Umezawa's Jitte,
Batterskull, Kaldra Compleat, …). The engine already had a complete **Aura**
attachment stack:

- `CardInstanceState.attachedTo` — the host id an attachment tracks.
- `AURA_AFFECTS_HOST` — the `staticEffects[].applies` predicate that grants a
  source's effects to `source.attachedTo` (P/T buffs, keyword grants, control
  change), applied/reverted by `applySourceStaticEffects` /
  `unapplySourceStaticEffects`.
- `checkAuraAttachmentSBA` (CR 704.5m) — detaches an Aura whose host went
  illegal.
- `reattachAura` — moves an attachment and re-applies its static effects.
- `PERMANENT_LEFT` with a CR 603.10 last-known-information snapshot, already
  carrying `attachedToBeforeLeave` (the leaving card's OWN host).

An Equipment differs from an Aura in exactly two CR-mandated ways, everything
else is identical:

1. **Detach outcome.** An illegal Aura goes to the graveyard (CR 704.5m); an
   illegal Equipment **detaches and stays on the battlefield** unattached
   (CR 704.5q).
2. **Control-independence.** "Equip target creature you control" binds the
   controller restriction only at Equip time. Once attached, the Equipment
   stays on its host even if its controller loses control of that host
   (CR 301.5c) — the equipment can legally sit on an opponent's creature and
   buff it.

The registry rows `equip` / `attach` were pre-seeded as `implemented` but were
in fact inert: no Equipment card existed, no Equip activation path, no
Equipment branch in the attachment SBA.

The design question: build a parallel Equipment-specific subsystem (own field,
own SBA, own primitive), or fold Equipment into the existing Aura plumbing and
route the two differences by permanent kind?

## Decision

**Equipment reuses the Aura attachment plumbing. There is ONE attachment
subsystem; Aura-vs-Equipment is a branch on the detach outcome, not a second
implementation.**

- **Host tracking** — Equipment uses the same `attachedTo` field and the same
  `AURA_AFFECTS_HOST` grant path. No new state.
- **`attach` Op (generic, CR 701.3 keyword action).**
  `{ op: "attach", target: <selector> }` attaches `$source` to the selected
  permanent (re-applying its static effects, `reattachAura` semantics
  generalized to a first attach). This is the primitive; **Equip** is just the
  shell that invokes it — an `ActivatedAbility` with `sorcerySpeedOnly: true`,
  `targetRequirement: { type: "Creature", controller: "you" }`, and
  `effects: [{ op: "attach", target: { target: 0 } }]`. The Op is reusable by
  future attach-on-resolution spells and by Aura re-attach.
- **`checkAttachmentSBA`** (generalizes `checkAuraAttachmentSBA`) routes by kind
  when a host is illegal: Aura → graveyard (CR 704.5m, unchanged); Equipment →
  **detach in place** (clear `attachedTo` + `unapplySourceStaticEffects`, no
  zone move, CR 704.5q). Equipment legality is host-still-a-creature-on-the-
  battlefield ONLY — never "controller still controls it" (control-independent,
  CR 301.5c).
- **Last-known info for "equipped creature dies" (M1).** The attachment SBA
  detaches BEFORE triggers are collected (`checkStateBasedActions` runs the SBA
  sweep to a fixpoint, then `processPendingActionTriggers`). So a "whenever
  equipped creature dies" trigger (Skullclamp) cannot read the equipment's live
  `attachedTo` — it is already cleared. The reverse of the existing
  `attachedToBeforeLeave`: the leaving CREATURE's event carries a new
  **`attachmentsBeforeLeave: string[]`** — the ids of permanents attached TO it,
  captured at the existing CR 603.10 snapshot point before the detach clears
  them. Skullclamp matches `event.attachmentsBeforeLeave?.includes(self.id)`.

Scope of #776: the base subsystem above + **Skullclamp** as the end-to-end
tracer (static +1/-1 via layer 7c + M1 dies-trigger → draw 2). Skullclamp needs
no new capability beyond the `attach` Op.

## Consequences

- Zero duplication: one attachment field, one grant path, one SBA (with a
  two-way detach branch). New attachment kinds (Fortification) slot in as a
  third branch, not a third subsystem.
- `PERMANENT_LEFT` / `CREATURE_DIED` schema grows one optional field
  (`attachmentsBeforeLeave`) — add it to `PERSISTED_OPTIONAL_KEYS` if it lands
  on `GameState`; the event is transient. Any future "when equipped/enchanted
  creature dies or leaves" trigger reuses it for free.
- Control-independence is a genuine gameplay surface (Equipment on a stolen
  creature) — tested explicitly.
- **Frontend wiring** (mandatory): `getStackAbilities` must offer the Equip
  ability (existing sorcery-speed timing gate, mana cost — no new cost shape);
  `matchesTargetRequirement` already marks `controller:"you"` creatures
  clickable (Simulacrum precedent). Verify through `buildTriggerStateView` /
  `projectPublicState`, not a hand-built view.

## Deferred (own issues, both depend on #776)

- **Umezawa's Jitte** — needs two orthogonal new capabilities: a DSL **host-ref**
  (`$host`, the source's `attachedTo` as an effect selector, reusable by
  Regeneration-on-Aura and any equip/aura ability acting on its host) and
  **per-mode modal targeting** (`EffectMode.targetRequirement`, so a "choose one"
  mode can carry its own target while sibling modes carry none — CR 601.2b/c).
- **Living Weapon** (CR 702.90) — ETB creates a 0/0 black Phyrexian Germ token
  and auto-attaches this Equipment to it (no target, no equip cost). Unblocks
  Batterskull and Kaldra Compleat.

## Alternatives considered

- **Parallel Equipment subsystem** (own `equippedTo` field, own SBA, own
  primitive). Rejected: the two differences are a detach-outcome branch and a
  legality predicate; everything else (host tracking, ability grant, re-attach,
  static-effect apply/revert) is byte-for-byte the Aura path. Duplicating it
  violates the primitive-reuse mandate (target scale ~80k cards) and doubles the
  surface for attachment bugs.
- **`equip`-specific Op** instead of a generic `attach`. Rejected: `equip` is
  the CR 702.6 ability shell; `attach` (CR 701.3) is the underlying keyword
  action, reusable by attach-on-resolution spells and Aura re-attach. The Op
  pays its per-Op test cost once; reuse rides free.
- **Reorder the SBA sweep** to collect leaves-the-battlefield triggers before
  the attachment SBA detaches (avoiding M1). Rejected: it inverts the
  established sweep→trigger invariant (CR 704.4 fixpoint before CR 603.3b),
  affecting every Aura LTB trigger. A last-known event field is local and
  CR-exact.
