# City's Blessing designation (Ascend, CR 702.131)

## Status

accepted

## Context

Issue #1460 asked for **Ascend** (CR 702.131) and the **city's blessing**
designation it grants, so a card printed with Ascend does something instead of
shipping silently inert. Ascend's first real consumer is Ocelot Pride (#1461);
no Ascend card is in the catalogue yet (Ixalan block, no `xln`/`rix` module), so
this record is about the mechanism, verified by tests and a debug scenario.

The rules shape (CR 702.131):

- **702.131a** — Ascend on an **instant or sorcery** is a spell ability: "If you
  control ten or more permanents and you don't have the city's blessing, you get
  the city's blessing for the rest of the game." Checked once, on resolution.
- **702.131b** — Ascend on a **permanent** is a static ability: "**Any time** you
  control ten or more permanents and you don't have the city's blessing, you get
  the city's blessing for the rest of the game." Evaluated continuously.
- **702.131c** — The city's blessing is a **designation**, not an ability of any
  object, and any number of players may hold it at once.
- **702.131d** — After a player gets the blessing, continuous effects are
  reapplied **before** the game checks trigger conditions.

Once obtained, the blessing lasts **for the rest of the game**: dropping below
ten permanents never revokes it.

The engine already had a near-exact precedent: the **Monarch** designation
(#1199), a player status held in game state (`GameState.monarchId`), projected to
the client and rendered as a marker-card tile — with `CITY_BLESSING_DESIGNATION`
already registered in `convex/cards/designations.ts` for its marker art, ahead of
the mechanic.

## Decision

Model the city's blessing on the Monarch precedent, with two CR-driven
divergences.

1. **Storage — a monotonic SET, not a scalar.** `GameState.cityBlessingIds?:
string[]` holds every player who has obtained the blessing. - **Set, not scalar** (vs. `monarchId`): the blessing is NON-exclusive —
   both players can hold it at once (CR 702.131). - **Monotonic** (vs. the monarch, which moves): the only writer,
   `grantCityBlessing`, ADDS; there is deliberately no revoke primitive
   (CR 702.131b). Persisted via `PERSISTED_OPTIONAL_KEYS` (serialize drift
   guard + round-trip smoke test).

2. **The ten-permanent check lives in one place, wired at two moments.**
   `gre/cityBlessing.ts` owns `countControlledPermanents` (counts by
   `controllerId` across every battlefield — "permanents you control") and
   `grantCityBlessingIfThreshold`, shared by both forms:
    - **Permanent (static).** `checkAscendCityBlessing` runs at **every
      battlefield-entry site** — a permanent spell resolving, a token created,
      a permanent put onto the battlefield by an effect, a land played, a
      control change, a phase-in (`state.ts` / `playLand.ts`) — plus once more
      in the SBA sweep (`checkStateBasedActions`, after the fixpoint) as the
      stable-point backstop. Being idempotent and monotonic it never unsettles
      the loop, and it is cheap: one O(battlefield) pass tallying per-controller
      counts and Ascend controllers together.

        **The SBA sweep alone is NOT sufficient**, and the original version of
        this ADR got that wrong (fixed after the Ocelot Pride bug): CR 702.131b is
        a STATIC ability, true at all times (CR 604.1), whereas the SBA sweep by
        CR 704.3 runs only when a player would receive priority. Any effect that
        creates a permanent and then reads the designation **within the same
        resolution** would read a stale `false` — exactly Ocelot Pride's "create a
        Cat token. **Then** if you have the city's blessing, …", whose Gatherer
        ruling states you get the blessing _before_ the ability checks for it. The
        eager calls are also what make the "tenth permanent enters and immediately
        dies to the legend rule / 0 toughness" ruling work: the grant lands at
        entry, before the SBA sweep removes the permanent.

    - **Instant/sorcery (on resolution).** `finalizeSpellResolution` calls the
      shared threshold check for a resolving non-permanent spell whose card
      declares the `ascend` keyword.

3. **Keyword.** The Mechanics Registry `ascend` row flips `planned` →
   `implemented`, `binding: "ascend"` (the literal `staticAbilities[]` string),
   so a card declaring `"ascend"` passes Guard A.

4. **Declarative condition.** A new frozen Effect Script predicate
   `{ hasCityBlessing: EffectPlayerRef }` gates an `if` on "you have the city's
   blessing" (Ocelot Pride #1461). It reads the designation through a new
   `SpellContext.hasCityBlessing(playerId)` primitive — a pure read of
   `cityBlessingIds`. Sits alongside the other player-scoped predicates
   (`targetIsAnother`, `picksMatchFilter`); it takes no binding/target/zone.

5. **Client surface.** `cityBlessingIds` is a top-level scalar-array field, so it
   crosses the wire automatically through `projectPublicState` / `projectFullState`
   (the `...state` spread). `useGameContext` forwards it; a new
   `PlayerCityBlessingTile` — the direct sibling of `PlayerMonarchTile` — renders
   the already-registered City's Blessing marker via `BoardDesignation`. Both
   players' tiles can show at once (non-exclusive).

## Consequences

- A designation shape now exists that is set-valued and monotonic — reusable for
  any future "for the rest of the game, you have X" player status.
- The threshold count is centralized (`countControlledPermanents`), so the
  permanent and spell forms can never drift.
- No Ascend card ships in this change; the first consumer (Ocelot Pride, #1461)
  rides the `hasCityBlessing` predicate free (per-Op reuse regime, ADR 0045/0046).
- The city's blessing is never revoked, matching CR 702.131b exactly — a player
  who Ascends then loses their board keeps the blessing.
- Every future battlefield-entry primitive must call `checkAscendCityBlessing`.
  The SBA-sweep call keeps such an omission from being a wrong game state at any
  stable point, but it will make a mid-resolution designation read stale — the
  bug class this record now documents.
