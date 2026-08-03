# Modal activated abilities are announce-time (`ActivatedAbility.modes`), not a resolve-time `optionChoice`

## Status

accepted

## Context

Issue #1341 (Umezawa's Jitte, parent PRD #620) needs two capabilities the
Equipment spine (#776, ADR 0065) deliberately excluded. One of them is a
"choose one" on an **activated** ability where **only one mode targets**:

> Remove a charge counter from Umezawa's Jitte: Choose one —
> • Equipped creature gets +2/+2 until end of turn.
> • **Target** creature gets -1/-1 until end of turn.
> • You gain 2 life.

The issue proposed adding `targetRequirement` to `EffectMode` — the mode shape
of the DSL `optionChoice` Op — so the middle bullet could declare a target its
siblings don't. That Op picks its mode **during resolution**: it enqueues an
`option-pick` Pending Choice, suspends, and descends into the chosen branch
when the pick comes back.

Two facts made that the wrong seam:

1. **CR order.** CR 602.2b routes activation announcement through the same
   601.2 steps as casting: modes are chosen in **601.2b**, targets in
   **601.2c** — both at announcement, before the ability is even on the stack.
   Only the chosen mode's targets are declared (CR 700.2d). A resolve-time
   mode pick inverts this: the opponent gets no window in which the chosen mode
   and its target are known, the target is never locked at announcement, and
   the CR 601.2c legality check (shroud, protection, "you control") happens at
   the wrong moment or not at all.
2. **The machinery already existed — for spells.** `CardDefinition.modes:
SpellMode[]` has carried per-mode `targetRequirement` since the modal-spell
   work, with `chosenModeId` propagating announcement → `pendingCast` /
   `pendingTarget` → stack item (CR 700.2c) and a `<ModePicker>` on the client.
   Activated abilities simply had no equivalent.

So the choice was: build a **second**, CR-incorrect modal-targeting path on the
resolve-time Op, or extend the **existing** announce-time one to the other
announcement site.

## Decision

**A printed modal activated ability declares `ActivatedAbility.modes:
AbilityMode[]` and its mode is locked at announcement, riding the SAME
`chosenModeId` plumbing modal spells already use.** `EffectMode` is left
alone.

- **`AbilityMode`** is the activated-ability twin of `SpellMode`. Both now
  extend a shared **`ModeOption`** (`id` / `label` / `oracleText` — the display
  surface `<ModePicker>` consumes, so one picker serves both). `AbilityMode`
  adds `targetRequirement?`, `effects?` and `resolve?`, and deliberately omits
  `staticEffects` (a one-shot ability mode has no continuous half — that is a
  modal _permanent_'s concern, CR 700.2c).
- **Announcement** (`activateAbilityOnState`): `resolveActivationMode`
  validates the announced mode the way `announceCast` validates a spell's —
  a modal ability MUST name one of its modes, a non-modal one must name none.
  The chosen mode's `targetRequirement` then **replaces** the ability-level
  `targetRequirement` / `getTargetRequirement` for this activation (CR 700.2d).
- **Propagation** reuses the existing fields end to end: `pendingTarget.
chosenModeId` (already generic over `kind: "cast" | "ability"`) → the new
  `PendingActivation.chosenModeId` for the deferred-payment exit →
  `StackItem.chosenModeId` (already present). All three activation exits —
  straight to the stack, `pendingTarget`, `pendingActivation` — carry it.
- **Resolution** (`resolveTopOfStack`, ability branch) dispatches the chosen
  mode's body through the SAME `getAbilityEffectFn` seam as a non-modal
  ability, mirroring the modal-spell branch directly below it. The
  ability-level `effects`/`resolve` are ignored for a modal ability, exactly as
  the card-level ones are for a modal spell.
- **The DSL `optionChoice` Op keeps its resolve-time semantics** and gains
  nothing. It remains the right tool for a "choose one" that appears _inside_ a
  resolving effect (where there is no announcement to hoist the choice to), and
  it is the wrong tool for a printed modal ability. The distinction is now
  documented on both types.

The companion capability in the same issue — the **`$host`** implicit binding
(the source's `attachedTo` as an ability-site selector, CR 701.3) — is
orthogonal and needed no ADR: it is seeded alongside `$source` in
`runEffectScript` and is statically declared at every ability site.

## Consequences

- **One modal model, two announcement sites.** A future modal triggered
  ability (CR 601.2b applies via 603.3d) slots into the same `ModeOption` shape
  rather than a third mechanism.
- **The seam is wide but shallow.** The change touches every layer a printed
  modal ability crosses — mutation arg (`activateAbility.chosenModeId`),
  activation path, pending-state propagation, resolution dispatch, catalogue
  validation sweep (each ability mode is validated as its own ability-site
  script, with `$source`/`$host` in scope), bot move enumeration (one
  `activate-ability` variant per mode, each with its own target tuples), the
  bot executor, and the client (`<ModePicker>` opens _before_ `activateAbility`
  is called at all, since the server rejects a modal activation with no mode).
  Every one of those is an existing seam widened, not a new one.
- **A missing client picker is a hard dead end, not a degraded experience** —
  the server throws on a modal activation with no `chosenModeId`. That is
  deliberate (fail loud, per the project's authority model) and is why the
  frontend wiring carries its own test rather than relying on the GRE suite.
- `getTargetRequirement` and a modal ability are mutually exclusive by
  construction: the mode wins. No card mixes them today; the doc comment says
  so explicitly.

## Alternatives considered

- **`EffectMode.targetRequirement` on the resolve-time `optionChoice` Op** (the
  issue's written proposal). Rejected on CR grounds above: it would have made
  the target of a printed modal ability un-respondable and unlocked at
  announcement, and it would have been a second modal-targeting implementation
  alongside the spell one.
- **Hoisting `optionChoice`'s pick to announcement generically** (make the Op
  itself announce-time when it is the first Op of an ability's script).
  Rejected: it overloads one Op with two incompatible timings depending on its
  position, and the position rule is invisible at the call site — a card author
  could not tell which semantics they were getting.
- **Reusing `SpellMode` verbatim for abilities.** Rejected only in the small:
  `staticEffects` is meaningless on an ability mode and would have invited a
  card to declare one that is silently never read. Extracting `ModeOption` gets
  the shared picker surface without the dead field.
