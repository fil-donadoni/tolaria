# ADR 0021 — General phasing via a silent holding-bundle move

**Status:** Accepted (2026-06-16)

## Context

Arabian Nights' Oubliette uses the modern phasing Oracle (ADR 0004): "target
creature phases out until this enchantment leaves the battlefield. Tap that
creature as it phases in this way. (Auras and Equipment phase out with it.
While permanents are phased out, they're treated as though they don't exist.)"

Phasing (CR 702.26) is **not** zone change. A phased-out permanent stays the
same object, keeps its counters, attachments, and control, and — critically —
its enters/leaves triggers do **not** fire when it phases (CR 702.26h). It is
simply "treated as though it doesn't exist" for as long as it's phased out.

The naïve implementation — exile the creature and remember it — is wrong on
three counts: it fires leaves/enters triggers, it sends attached Auras to the
graveyard (the aura-attachment SBA, CR 704.5n), and it resets battlefield
state. Phasing must preserve all of it.

The implementation also had to be **general**, not an Oubliette special case:
keyword phasing (Teferi's Veil) reuses the same primitive later, so the design
budgets for an untap-cycle return condition even though no ARN card needs it.

## Decision

### A holding bundle off the battlefield, not a per-permanent flag

Phased permanents are **pulled out of the battlefield arrays** entirely and
held in a new `GameState.phasedOut: PhasedOutBundle[]`. There is no
`isPhased` flag on `CardInstanceState`. This is the load-bearing choice: every
reader in the engine (`getEffectivePower`, target enumeration, SBAs, trigger
scans, combat) iterates `players[].battlefield`. A permanent that isn't in
those arrays is invisible to all of them **for free** — "treated as though it
doesn't exist" falls out of the data model rather than requiring every reader
to learn a new flag.

A bundle is the unit of phasing (CR 702.26d, indirect phasing):

```ts
interface PhasedOutBundle {
    id: string;
    cards: CardInstanceState[]; // host first, then its Auras/Equipment
    returnOn: PhaseReturnCondition;
    onPhaseIn?: { tap?: boolean };
}
```

`phaseOut(permanentId, { returnOn, onPhaseIn })` collects the host plus every
permanent whose `attachedTo === permanentId` (Auras and Equipment), splices
them all out of their battlefields, and stores them in one bundle. The Auras
ride along still attached — they never become orphans, so the
aura-attachment SBA never sees them off-battlefield and never destroys them.
Counters and `attachedTo` links are untouched because the instance objects are
moved verbatim.

### The move is silent

`phaseOut` / `phaseIn` emit **no** `PERMANENT_ENTERED` / `PERMANENT_LEFT`
events and perform **no** zone change (`CardInstanceState.zone` stays
`"battlefield"` — phased permanents are logically still battlefield
permanents, merely non-existent). Because no events are queued, `collectTriggers`
finds nothing: phasing fires no triggers, as CR 702.26h requires.

### Return is a continuous duration ending, driven by the source's leave

`PhaseReturnCondition` is a discriminated union:

```ts
type PhaseReturnCondition =
    | { kind: "source-leaves"; sourceId: string } // Oubliette — built now
    | { kind: "untap-cycle" }; // keyword phasing — expressible, deferred
```

For `source-leaves`, phase-in is hooked into `removePermanentTo` — the single
choke point every "leaves the battlefield" path already funnels through. After
a permanent leaves (to any zone — "until ~ leaves the battlefield" is
zone-agnostic), `phaseInBundlesForSource` phases in any bundle whose
`returnOn.sourceId` matches. This runs **immediately**, not via the stack: the
"until ~ leaves" duration ending is a continuous effect expiring (CR 611.2a),
not a triggered ability. The creature returns tapped (`onPhaseIn.tap`) and
still enchanted, with its counters intact.

`untap-cycle` is fully expressible but unused — no ARN card needs the
untap-step phase loop, so its driver is deferred (PRD #171, "Out of scope").

### Targeting

Oubliette's "target creature" is modeled as a `choose-permanents` resolution
choice (`ctx.requestChoice`, ADR 0008) over every battlefield, **not** a true
`TargetRequirement`. This avoids introducing a targeted-triggered-ability
target-selection path (the engine has none today) for a single card. The
trade-off: protection / hexproof are not re-checked at choice time. Acceptable
for the current pool; revisit if a phasing card interacts with protection in a
way that matters.

### Serialization

`phasedOut` is added to `PERSISTED_OPTIONAL_KEYS`. Its bundle cards are
battlefield-shaped permanents, so `compactState` / `expandState` slim and
rehydrate their `card` field through `compactCard` / `expandCard` exactly like
battlefield arrays (carrying `ownerId` explicitly, since a bundle has no
surrounding player to default it from). The drift-guard test gains a non-empty
round-trip case.

## Consequences

- New `GameState.phasedOut`; new `PhaseReturnCondition` / `PhaseInRider` in
  `gre/types.ts`; new `PhasedOutBundle` in `state.ts`.
- New `phaseOutPermanent` / `phaseInBundle` engine helpers and
  `ctx.phaseOut` / `ctx.phaseIn` SpellContext primitives.
- `removePermanentTo` gains a source-leaves phase-in hook at its tail.
- Phasing is invisible to every battlefield reader with zero per-reader
  changes — the whole point of the holding-bundle model.
- Keyword phasing (untap-cycle) is one return-condition branch away.

## Out of scope

- **Untap-cycle phasing** (Teferi's Veil, keyword `phasing`) — the return
  condition is expressible but its untap-step driver is not built.
- **Phasing as a true target** — Oubliette uses a resolution choice; no
  targeted-trigger target-selection path is added, so protection/hexproof are
  not consulted at choice time.
- **Cross-permanent imperative effects from the phased permanent** — phasing
  relies on read-time battlefield scanning to suspend a phased permanent's
  static effects; an imperative grant it wrote onto another permanent is not
  separately reverted. No current card exercises this.
