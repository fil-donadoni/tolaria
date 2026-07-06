# Land-entry pay-choice as a stackless pending choice (shock lands)

## Context

The RAV/GPT/DIS "shock land" cycle (Steam Vents, Godless Shrine, Watery Grave,
…) reads: _"As this land enters the battlefield, you may pay 2 life. If you
don't, it enters the battlefield tapped."_ By CR 614.12 this is a
self-replacement effect applied as the permanent enters.

Every existing tapped-on-entry source in the engine is a **deterministic
board predicate**: the unconditional `entersTapped: true` (Nevinyrral's Disk),
the `entersTappedUnless` predicate (fast lands / Arena of Glory / Starting
Town), and the battlefield-scanned opponent replacement (Kismet). All three
resolve inside `shouldEnterTapped` with no player in the loop, so
`applyPlayLand` is a synchronous leaf primitive that returns with the land
already settled.

The shock land is the first land whose tapped-on-entry bit depends on a
**player decision made at the moment of entry** — and a land is _played_, not
cast, so it never touches the stack. The stack's `resolveSteps` suspend/resume
machinery (and the stack-coupled `may-pay` submit path, which commits into a
`StackItem.collectedChoices`) has no stack item to hang on. Left as a tracked
stub since the RAV/GPT/DIS tranche (formerly blocked-by #675).

## Decision

Model the choice as a **stackless pending choice at land entry**, not as a
replacement effect and not through the stack-coupled `may-pay` path.

1. **New `CardDefinition` field `entersTappedUnlessPay?: MayPayCost`** — a
   structural sibling of `entersTapped` / `entersTappedUnless` (shock lands:
   `{ life: 2 }`). Reuses `MayPayCost` so the clause generalises beyond life.
   Not an Op or keyword, so no Mechanics Registry entry (neither sibling is
   registered).

2. **New pending-choice family `LandEntryChoiceKind = "land-entry-tapped"`**,
   enqueued by `applyPlayLand` with the sentinel `stackItemId: ""` — the same
   stackless convention `untap-pick` / `draw-look-keep` already use. The
   entering land's instance id rides on the `PendingChoice`
   (`landInstanceId?`), so no new top-level `GameState` field and no
   `PERSISTED_OPTIONAL_KEYS` change. `applyPlayLand` enqueues the choice and
   returns **before `moveCard`** — the card stays in hand for the choice
   window (CR-faithful "as it enters" timing; nothing observes it since
   priority is frozen).

3. **Its own submit path** `submitLandEntryChoice` → `applyLandEntrySubmit` →
   `finalizeLandEntry` (mirrors `name-card` → `submitNameCard` and
   `draw-look-keep` → `finalizeDrawLookKeep`). On accept it pays the cost via
   the shared `canPayMayPayCost` / `payMayPayCost`, then completes the entry
   through the extracted `settleEnteredLand` body — identical to the normal
   land path. The tapped bit is
   `resolveEntersTapped(def, card, state) || (choice === skip)`: paying removes
   only the shock land's **own** tapped clause; any other tapped source
   (Kismet) still counts independently (CR 616 — each replacement is
   independent; you may pay 2 life even when another effect forces tapped, as
   on Arena).

4. **Bot** treats it exactly like a `may-pay` — accept iff affordable
   (`life >= 2`), the ADR 0016 minimal-legal default, both in real play
   (`chooseResolution`) and in search, where `applyMove`'s play-land case
   auto-finalises the fresh choice inline so the rollout never stalls.

## Considered Options

- **Genuine replacement effect in `replacements.ts`** (the literal CR 614.12
  classification) — rejected: the replacement pipeline rewrites event payloads
  synchronously with no input-suspend point, so it would need a whole
  pending-choice mechanism bolted in. The chosen model is behaviourally
  identical for this card class: same "as it enters" timing, no stack, no
  trigger, un-respondable, and it composes with other tapped-replacements
  through the same `shouldEnterTapped` seam.
- **Generalise the `may-pay` submit to accept `stackItemId === ""`** — rejected:
  every existing caller of `applyMayPaySubmit` assumes a stack item and calls
  `resolveTopOfStack`; overloading it risks regressions and the exhaustive
  `PendingChoiceKind` gates wouldn't force the land case to be handled
  distinctly. A dedicated family + submit path follows the `draw-look-keep`
  precedent.

## Consequences

- Land entry now has a genuine suspend point: `applyPlayLand` can return with
  the land still in hand and a pending choice enqueued. Callers already treat a
  non-empty `pendingChoices` as "freeze until resolved," so `playCard` needs no
  special handling beyond persisting.
- The pattern is reusable for any future "as it enters, you may pay <cost>,
  else tapped" land (`entersTappedUnlessPay` takes any `MayPayCost`).
- The suicide edge (bot pays 2 life at exactly 2 life and loses to SBA) is
  inherited from the shared `may-pay` affordability rule, not shock-specific;
  a global fix belongs to the `may-pay` policy, not here.
