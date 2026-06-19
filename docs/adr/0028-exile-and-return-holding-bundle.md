# ADR 0028 — Exile-and-return via a metadata holding bundle + a `PERMANENT_UNTAPPED` event

**Status:** Accepted (2026-06-19)

## Context

Antiquities' Tawnos's Coffin (issue #295) uses the modern Oracle (ADR 0004):

> You may choose not to untap this artifact during your untap step.
> {3}, {T}: Exile target creature and all Auras attached to it. Note the number
> and kind of counters that were on that creature. When this artifact leaves the
> battlefield or becomes untapped, return that exiled card to the battlefield
> under its owner's control tapped with the noted number and kind of counters on
> it. If you do, return the other exiled cards to the battlefield under their
> owner's control attached to that permanent.

This is the **exile** sibling of phasing's holding bundle (ADR 0021). The two
look alike — host + attached Auras leave together and come back as a unit — but
differ on the points that matter:

|                          | Phasing (ADR 0021)                               | Tawnos's Coffin (this ADR)                                           |
| ------------------------ | ------------------------------------------------ | -------------------------------------------------------------------- |
| Zone change              | No (CR 702.26h) — silent, no triggers            | **Yes** — exile; leaves/enters triggers fire                         |
| Returned object identity | Same object                                      | **New** object (CR 400.7)                                            |
| Counters                 | Preserved automatically                          | **Reset** on the zone change, so they are _noted_ and re-applied     |
| Return driver            | Continuous duration ending (immediate, no stack) | **Triggered ability** (CR 603.7a) — on the source's leave _or_ untap |

The repo had no "becomes untapped" event: `untap-cycle` existed only as a
deferred `PhaseReturnCondition` branch (ADR 0021), and every untap site flipped
`isTapped = false` inline. The "you may choose not to untap" clause, by
contrast, already existed as the `may-choose-not-to-untap` optional-untap static
(ADR 0005), so only the return half was new.

## Decision

### A metadata holding bundle, not a fat-card bundle

`GameState.exileHeld?: ExileReturnBundle[]`. Unlike `PhasedOutBundle` (which
holds the full `CardInstanceState` objects off-battlefield), the exiled cards
**stay in their owners' `exile` arrays** — a real zone change is the whole
point. A bundle holds only the linkage and the noted counter snapshot:

```ts
interface ExileReturnBundle {
    id: string;
    sourceId: string; // the holding artifact (LKI keeps it valid after it leaves)
    hostId: string;
    hostOwnerId: string;
    attached: { id: string; ownerId: string }[]; // exiled Auras
    counters: Record<string, number>; // noted counters
    returnTapped: boolean;
}
```

Because a bundle is pure data (ids, owners, scalars), it serializes verbatim —
no `compactCard`/`expandCard` special-casing like `phasedOut` needs. It is added
to `PERSISTED_OPTIONAL_KEYS` and round-trips in `serialize.test.ts`.

`exileWithAttachments(targetId, { sourceId, returnTapped })` notes the host's
counters, then exiles the Auras **first** and the host **second** (so the
orphan-aura SBA, CR 704.5n, never fires between the two), each via
`removePermanentTo(…, "exile")` so leaves-the-battlefield triggers fire.
`returnExiledForSource(sourceId)` returns each bundle's host from exile
(`putReanimatedOnBattlefield` — a fresh object, ETB fires, summoning-sick),
taps it, re-applies the noted counters, and returns each Aura attached to the
host (mirroring `reattachAura`). A host that has since left exile fizzles that
bundle.

### The bundle's existence is the "delayed trigger is armed" flag

Tawnos's Coffin's return is a **delayed triggered ability** (CR 603.7a)
established by the activated ability. Rather than add an event-keyed
delayed-trigger timing, the return is modelled as **two ordinary triggered
abilities on the artifact** — `leftTrigger` (scope `self`) and a new
`untapTrigger` (scope `self`) — each gated by a `condition` that checks whether
this source currently holds a bundle. `TriggerStateView` gains an optional
`exileHeld?: { sourceId }[]` (populated from the live `GameState` that
`collectTriggers` already passes to `matches`) so the condition can read it. A
coffin that untaps holding nothing therefore pushes no do-nothing trigger.

### A general `PERMANENT_UNTAPPED` event

`untapPermanent(state, card)` is the single choke point for "becomes untapped"
(CR 701.20b): it flips `isTapped` and emits `PERMANENT_UNTAPPED` **only on a
real tapped → untapped transition**. The untap step (CR 502.2) and untap effects
(Twiddle's `ctx.untap`) both route through it, so the event — and the new
`untapTrigger` factory — is reusable by any future "when ~ becomes untapped"
card.

Because UNTAP is an auto-phase that grants no priority, its events are not
drained by a `resolveTopOfStack` pass (the way an untap effect during a spell's
resolution is). The untap step therefore collects `PERMANENT_UNTAPPED` triggers
at its completion and pushes them onto the stack; they wait there for the upkeep
priority window. Untap effects during resolution need no special handling — the
normal post-resolution `pendingEvents` drain collects them.

## Consequences

- New `GameState.exileHeld` + `ExileReturnBundle` (state.ts); new
  `exileWithAttachments` / `returnExiledForSource` engine helpers and matching
  `SpellContext` primitives.
- New `PERMANENT_UNTAPPED` event + `untapPermanent` choke point; the untap step
  and `ctx.untap` route through it. New `untapTrigger` factory.
- `TriggerStateView` exposes `exileHeld` so return triggers can gate on "is a
  bundle armed".
- `exileHeld` added to `PERSISTED_OPTIONAL_KEYS`; round-trips as plain metadata.
- The mechanism generalizes: any "exile a permanent (and its Auras / noted
  counters) and return it later on some source event" card reuses
  `exileWithAttachments` + `returnExiledForSource` driven by `leftTrigger` /
  `untapTrigger` / future event triggers.

## Out of scope

- **Equipment** in the attachment bundle — the collection takes every
  `attachedTo` permanent, so Equipment would ride along, but no ATQ-era card
  exercises it (there is no Equipment in the pool).
- **Targeted triggered-ability returns** — the return is forced (no targeting);
  it reattaches Auras without re-checking enchant legality, matching the Oracle
  ("return … attached to that permanent").
- **Stacking multiple holds on one source** — the activated ability taps the
  artifact, and untapping returns the held creature, so only one bundle is held
  at a time in practice; `returnExiledForSource` still handles a multi-bundle
  source defensively.
