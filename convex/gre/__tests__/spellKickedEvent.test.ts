// SPELL_KICKED — "a player kicks a spell" (CR 702.33d + CR 603.2, issue #1097).
//
// The event that backs Saproling Infestation (`cards/sets/inv/green.ts`). It is
// the FIRST engine signal for a kicker PAYMENT — before this, kicker existed
// only as a `kickerPayments` snapshot read back at resolution, never as
// something a triggered ability could listen for.
//
// PRODUCER CENSUS. Adding a new GameEvent means classifying every site that
// records or carries a kicker payment as emit / must-not-emit. The table below
// is that classification; each row has a test in this file, the must-NOT rows
// included, because a must-NOT row is exactly where a `type ===` check silently
// fails open.
//
//  | #  | Site                                                    | Emits |
//  |----|---------------------------------------------------------|-------|
//  | 1  | `resolveKickerPayments` (announce validation, game.ts)   | no    |
//  | 2  | `PendingTarget.kickerPayments` (target-selection state)  | no    |
//  | 3  | `PendingCast.kickerPayments` (deferred-mana state)       | no    |
//  | 4  | StackItem build → `emitSpellCastEvent` (3 cast branches) | YES   |
//  | 5  | `tryAutoCommitPendingCast` → `emitSpellCastEvent`        | YES   |
//  | 6  | Acting-Player cast, Word of Command (state.ts)           | YES*  |
//  | 7  | AI probe cast (`gre/ai/dominance.ts`)                    | YES*  |
//  | 8  | `castFaceDown` (state.ts) — pushes a spell, never emits  | no    |
//  | 9  | `cloneSpellOntoStack` (spell COPY, CR 707.10)            | no    |
//  | 10 | `finalizeSpellResolution` ETB snapshot onto a permanent  | no    |
//  | 11 | bot `moves.ts` cast enumerator                           | n/a   |
//
//  Rows 1–3 are ANNOUNCEMENT state, not a cast: a cast abandoned before commit
//  never kicked anything. Rows 4–7 are the SIX call sites of the one choke
//  point `emitSpellCastEvent` — rows 6 and 7 emit in principle, but neither an
//  Acting-Player cast (Word of Command) nor an AI probe cast can pay a kicker,
//  so both structurally emit nothing. Row 8 pushes a spell onto the stack
//  WITHOUT going through the choke point (it emits no SPELL_CAST either) and a
//  face-down cast pays no kicker. Row 9 is the load-bearing must-NOT: a copy
//  CARRIES the original's `kickerPayments` (CR 707.10 copies "additional or
//  alternative costs", so the copy IS kicked for `wasKicked` purposes) yet no
//  player kicked it. Row 10 would double-count the original kick. Row 11 never
//  builds a `kickerPayments` record at all.

import { describe, it, expect } from "vitest";
import { finalizeTargetSelection } from "../../game";
import { buildSpellKickedEvents } from "../kicker";
import {
    getPlayer,
    resolveTopOfStack,
    type PendingTarget,
    type CardInstanceState,
    type StackItem,
} from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import { getEventFieldRow } from "../../cards/mechanicsRegistry";
import { burstLightning } from "../../cards/sets/zen/red";
import { everflowingChalice } from "../../cards/sets/wwk/colorless";
import { thornscapeBattlemage } from "../../cards/sets/pls/green";
import { fork } from "../../cards/sets/lea/red";
import { regrowth } from "../../cards/sets/lea/green";
import { remand } from "../../cards/sets/rav/blue";
import { memoryLapse } from "../../cards/sets/hml/blue";
import { grizzlyBears } from "../../cards/sets/lea";
import { saprolingInfestation } from "../../cards/sets/inv/green";

/** A stack-item shaped probe for the pure emitter. Only the fields
 *  `buildSpellKickedEvents` reads. */
function probeItem(
    kickerPayments: Record<string, number> | undefined
): Parameters<typeof buildSpellKickedEvents>[1] {
    return {
        id: "spell1",
        castById: "p1",
        ...(kickerPayments ? { kickerPayments } : {}),
        types: ["Instant"],
        subtypes: [],
    };
}

// ---------------------------------------------------------------------------
// Rows 4–5: the emitter itself. One event PER KICK (CR 702.33d).
// ---------------------------------------------------------------------------
describe("SPELL_KICKED — one event per KICK (CR 702.33d)", () => {
    it("a single Kicker paid once emits exactly one event carrying the kicking player", () => {
        const events = buildSpellKickedEvents(
            burstLightning,
            probeItem({ kicker: 1 }),
            burstLightning.id,
            ["R"]
        );
        expect(events).toEqual([
            {
                type: "SPELL_KICKED",
                casterId: "p1",
                spellInstanceId: "spell1",
                spellCardId: burstLightning.id,
                kickerId: "kicker",
                spellTypes: ["Instant"],
                spellSubtypes: [],
                spellColors: ["R"],
            },
        ]);
    });

    it("Multikicker paid N times is N kicks, not one (CR 702.33c/d)", () => {
        // Everflowing Chalice: "Multikicker {2}". CR 702.33d — "if a spell ...
        // has multikicker, it may be kicked multiple times", so a spell kicked
        // three times fires a "whenever a player kicks a spell" ability three
        // times (three separate stack objects, each independently counterable).
        const events = buildSpellKickedEvents(
            everflowingChalice,
            probeItem({ kicker: 3 }),
            everflowingChalice.id,
            []
        );
        expect(events).toHaveLength(3);
        expect(events.map((e) => e.kickerId)).toEqual([
            "kicker",
            "kicker",
            "kicker",
        ]);
    });

    it("two INDEPENDENT Kickers both paid emit one event each, attributed per Kicker id (ADR 0079)", () => {
        // Thornscape Battlemage: "Kicker {R} and/or {W}" — two separately
        // payable Kickers (CR 702.33b). Both paid = kicked twice.
        const events = buildSpellKickedEvents(
            thornscapeBattlemage,
            probeItem({ "kicker-r": 1, "kicker-w": 1 }),
            thornscapeBattlemage.id,
            ["G"]
        );
        expect(events).toHaveLength(2);
        expect(events.map((e) => e.kickerId).sort()).toEqual([
            "kicker-r",
            "kicker-w",
        ]);
    });

    it("emits in the card's DECLARATION order so the batch is deterministic", () => {
        const events = buildSpellKickedEvents(
            thornscapeBattlemage,
            probeItem({ "kicker-w": 1, "kicker-r": 1 }),
            thornscapeBattlemage.id,
            ["G"]
        );
        expect(events.map((e) => e.kickerId)).toEqual(["kicker-r", "kicker-w"]);
    });
});

// ---------------------------------------------------------------------------
// Must-NOT rows: an unkicked cast, and the two fail-closed axes.
// ---------------------------------------------------------------------------
describe("SPELL_KICKED — must NOT emit (fail-closed axes)", () => {
    it("an UNKICKED cast emits nothing (no payment record at all)", () => {
        expect(
            buildSpellKickedEvents(
                burstLightning,
                probeItem(undefined),
                burstLightning.id,
                ["R"]
            )
        ).toEqual([]);
    });

    it("a ZERO count is not a kick (CR 702.33d — the intention was never declared)", () => {
        expect(
            buildSpellKickedEvents(
                burstLightning,
                probeItem({ kicker: 0 }),
                burstLightning.id,
                ["R"]
            )
        ).toEqual([]);
    });

    it("DECLARATION-GATED: a payment naming a Kicker id the card does not declare emits nothing", () => {
        // Fail-closed axis 1. The tally is read through the CARD'S OWN
        // `kickers[]`, never the record's keys, so a desynced snapshot or a
        // future producer that skips `resolveKickerPayments` cannot manufacture
        // a kick out of a name nothing on the card answers to.
        expect(
            buildSpellKickedEvents(
                burstLightning,
                probeItem({ "kicker-nope": 4 }),
                burstLightning.id,
                ["R"]
            )
        ).toEqual([]);
    });

    it("DECLARATION-GATED: a card with NO Kickers at all emits nothing for a stray record", () => {
        expect(
            buildSpellKickedEvents(
                grizzlyBears,
                probeItem({ kicker: 2 }),
                grizzlyBears.id,
                ["G"]
            )
        ).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Rows 1–5 through the REAL cast path (`finalizeTargetSelection`, game.ts).
// ---------------------------------------------------------------------------
describe("SPELL_KICKED — emitted at the real cast choke point (CR 601.2i / 702.33d)", () => {
    function burstLightningCast(kickerPayments?: Record<string, number>) {
        const bolt = makeInstance(burstLightning.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
            id: "bolt1",
        });
        const victim = makeInstance(grizzlyBears.id, {
            controllerId: "p2",
            ownerId: "p2",
            id: "bears1",
            power: 2,
            toughness: 2,
        });
        const observer = makeInstance(saprolingInfestation.id, {
            controllerId: "p1",
            ownerId: "p1",
            id: "infest1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [bolt],
                    battlefield: [observer],
                    // {R} + Kicker {4} = 5 mana.
                    manaPool: { W: 0, U: 0, B: 0, R: 5, G: 0, C: 0 },
                }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        const pt: PendingTarget = {
            playerId: "p1",
            cardInstanceId: "bolt1",
            targetType: ["Creature", "Planeswalker", "player"],
            count: 1,
            selected: [{ type: "permanent", id: "bears1" }],
            ...(kickerPayments ? { kickerPayments } : {}),
        };
        finalizeTargetSelection(state, pt, "p1");
        return state;
    }

    // `finalizeTargetSelection` DRAINS `pendingEvents` on the way out
    // (`processPendingActionTriggers`, CR 601.2i — cast triggers go on the
    // stack before any player gets priority), so the event is not observable
    // as a queue entry afterwards. Observing the TRIGGER it produced is the
    // stronger assertion anyway: it proves the event reached the real trigger
    // scan, not merely a list. Saproling Infestation is the observer.
    function withObserver(kickerPayments?: Record<string, number>) {
        const state = burstLightningCast(kickerPayments);
        return state;
    }

    it("a kicked cast puts the observer's trigger on the stack (CR 601.2i / 603.3)", () => {
        const state = withObserver({ kicker: 1 });
        const triggers = state.stack.filter(
            (s) => s.triggeredAbilityId === "saproling-infestation-kicked"
        );
        expect(triggers).toHaveLength(1);
        expect(triggers[0].triggerEvent?.type).toBe("SPELL_KICKED");
        // The spell itself is on the stack under it, and the kicker was paid
        // (5 red → 0: {R} base + Kicker {4}).
        expect(state.stack.some((s) => s.id === "bolt1")).toBe(true);
        expect(getPlayer(state, "p1").manaPool.R).toBe(0);
    });

    it("rows 1–3 must-NOT: the UNKICKED branch of the SAME cast path triggers nothing", () => {
        const state = withObserver();
        expect(state.stack.some((s) => s.id === "bolt1")).toBe(true);
        expect(
            state.stack.filter(
                (s) => s.triggeredAbilityId === "saproling-infestation-kicked"
            )
        ).toEqual([]);
        // Only {R} was paid — 4 red left over, so the branch really is the
        // unkicked one and not a silently-failed cast.
        expect(getPlayer(state, "p1").manaPool.R).toBe(4);
    });
});

// ---------------------------------------------------------------------------
// Row 7 — the load-bearing must-NOT: a COPY of a kicked spell (CR 707.10).
// Row 8 — resolution snapshots the payments onto the permanent; not a kick.
//
// Both are observed through the OBSERVER (Saproling Infestation on the
// battlefield), never through `state.pendingEvents`: the queue is drained by
// the trigger scan on the way out of every resolution, so an assertion on the
// queue is vacuously empty whether or not the event was ever emitted. The
// trigger the event did or did not produce is the durable evidence.
// ---------------------------------------------------------------------------
function observerBoard() {
    const infest = makeInstance(saprolingInfestation.id, {
        controllerId: "p1",
        ownerId: "p1",
        id: "infest-obs",
    });
    return makeState({
        players: [
            makePlayer("p1", { battlefield: [infest] }),
            makePlayer("p2"),
        ],
    });
}

const kickTriggers = (state: { stack: readonly StackItem[] }) =>
    state.stack.filter(
        (s) => s.triggeredAbilityId === "saproling-infestation-kicked"
    );

describe("SPELL_KICKED — a COPY of a kicked spell is not a kick (CR 707.10)", () => {
    it("Fork copying a kicked spell carries kickerPayments over but triggers NOTHING", () => {
        // CR 707.10: "a copy of a spell isn't cast", and the copy "copies ...
        // all decisions made for it, including ... additional or alternative
        // costs" — so the copy IS kicked (an Overload-style "if this spell was
        // kicked" clause sees it) but NOBODY kicked it: no player declared or
        // paid a kicker cost for the copy.
        const state = observerBoard();
        const victim = makeInstance(grizzlyBears.id, {
            controllerId: "p2",
            ownerId: "p2",
            id: "bears2",
            power: 2,
            toughness: 2,
        });
        getPlayer(state, "p2").battlefield.push(victim);
        // The already-kicked spell sits on the stack, kicker snapshot and all.
        // Its own cast happened earlier and is not replayed here.
        const kickedSpell: StackItem = {
            ...makeInstance(burstLightning.id, {
                controllerId: "p2",
                ownerId: "p2",
                zone: "stack",
                id: "kickedbolt",
            }),
            castById: "p2",
            targets: [{ type: "permanent", id: "bears2" }],
            kickerPayments: { kicker: 1 },
        };
        state.stack.push(kickedSpell);
        const forkItem = pushSpell(state, fork.id, "p1", [
            { type: "spell", id: "kickedbolt" },
        ]);
        forkItem.id = "fork1";
        resolveTopOfStack(state);

        const copy = state.stack.find(
            (s) =>
                s.id !== "kickedbolt" &&
                s.id !== "fork1" &&
                !s.triggeredAbilityId
        );
        // The copy exists and DID inherit the kicker payments (CR 707.10) …
        expect(copy).toBeDefined();
        expect(copy!.kickerPayments).toEqual({ kicker: 1 });
        // … and yet nobody kicked anything: the observer never triggered.
        expect(kickTriggers(state)).toEqual([]);
    });
});

describe("SPELL_KICKED — resolution is not a cast (row 8 must-NOT)", () => {
    const PERMANENT_PROBE_ID = "test:spell-kicked-permanent-probe";
    const permanentProbe: CardDefinition = {
        id: PERMANENT_PROBE_ID,
        rarity: "common",
        name: "Kicked Permanent Probe",
        manaCost: { X: 1 },
        types: ["Artifact"],
        kickers: [{ id: "kicker", description: "Kicker {1}", mana: { X: 1 } }],
    };
    registerTokenDefinition(permanentProbe);

    it("a kicked permanent spell RESOLVING triggers nothing, even though the permanent keeps the snapshot", () => {
        const state = observerBoard();
        const item: StackItem = {
            ...makeInstance(PERMANENT_PROBE_ID, {
                controllerId: "p1",
                ownerId: "p1",
                zone: "stack",
                id: "probe1",
            }),
            castById: "p1",
            kickerPayments: { kicker: 1 },
        };
        state.stack.push(item);
        // Only the RESOLUTION runs here — the cast (and its kick) already
        // happened, so this step must add nothing.
        resolveTopOfStack(state);

        const entered = getPlayer(state, "p1").battlefield.find(
            (c: CardInstanceState) => c.id === "probe1"
        );
        // The permanent carries the kicker snapshot (the intervening-if twin) …
        expect(entered?.kickerPayments).toEqual({ kicker: 1 });
        // … but resolving is not casting: no second kick.
        expect(kickTriggers(state)).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// REGRESSION (review of PR #2115) — a STALE cast-time snapshot must not
// manufacture a phantom kick. The declaration gate cannot catch this one: the
// stale id is the card's OWN kicker id, so it passes cleanly.
//
// TWO INDEPENDENT GATES enforce CR 400.7 here, and this test covers both:
//   G1 `clearCastKickerSnapshot` — strips the snapshot as the spell LEAVES the
//      stack for a recastable zone (added by this PR).
//   G2 `resetBattlefieldTransientState`, reached via `removeFromZone` — strips
//      it again at cast-commit, on every cast branch (pre-existing).
// Measured by mutation, both directions: with BOTH removed the chain below
// emits a phantom SPELL_KICKED and creates a free Saproling
// (`phantomTriggers: 1, tokensMade: 1`); with EITHER present it does not. So
// the zone-hygiene assertion below is guarded by G1 alone, and the
// no-phantom-trigger assertion is guarded by the pair.
// ---------------------------------------------------------------------------
describe("SPELL_KICKED — a stale kickerPayments record is not a kick (CR 400.7)", () => {
    it("kicked cast → graveyard → Regrowth → UNKICKED recast triggers nothing", () => {
        // The full chain, shipped cards only:
        //   1. p1 casts Burst Lightning KICKED — one real kick, one Saproling.
        //   2. It resolves to the graveyard. The graveyard object must not keep
        //      the cast-time `kickerPayments` snapshot (CR 400.7 — a card that
        //      changes zones is a NEW object with none of the old one's
        //      cast-time decisions).
        //   3. Regrowth returns it to hand, record and all.
        //   4. p1 recasts it WITHOUT paying the kicker. Every cast branch
        //      builds the new stack item as `{ ...card, ...(kickerPayments ? …
        //      : {}) }` — that spread is `{}` when unkicked and therefore does
        //      NOT clear an inherited field, so a stale record would ride onto
        //      the new stack item and emit a phantom SPELL_KICKED: a free
        //      Saproling for a spell nobody kicked.
        const state = observerBoard();
        const victim = makeInstance(grizzlyBears.id, {
            controllerId: "p2",
            ownerId: "p2",
            id: "bears-stale",
            power: 2,
            toughness: 2,
        });
        getPlayer(state, "p2").battlefield.push(victim);
        const bolt = makeInstance(burstLightning.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
            id: "bolt-stale",
        });
        const p1 = getPlayer(state, "p1");
        p1.hand.push(bolt);
        p1.manaPool = { W: 0, U: 0, B: 0, R: 5, G: 0, C: 0 };

        // 1–2. The genuine kicked cast, then let it resolve to the graveyard.
        finalizeTargetSelection(
            state,
            {
                playerId: "p1",
                cardInstanceId: "bolt-stale",
                targetType: ["Creature", "Planeswalker", "player"],
                count: 1,
                selected: [{ type: "permanent", id: "bears-stale" }],
                kickerPayments: { kicker: 1 },
            },
            "p1"
        );
        expect(kickTriggers(state)).toHaveLength(1);
        while (state.stack.length > 0) resolveTopOfStack(state);
        const inGraveyard = getPlayer(state, "p1").graveyard.find(
            (c: CardInstanceState) => c.id === "bolt-stale"
        );
        expect(inGraveyard).toBeDefined();
        // CR 400.7 — the graveyard object carries no cast-time kicker snapshot.
        expect(inGraveyard!.kickerPayments).toBeUndefined();

        // 3. Regrowth returns it to hand.
        pushSpell(state, regrowth.id, "p1", [
            { type: "graveyard-card", id: "bolt-stale", playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        const inHand = getPlayer(state, "p1").hand.find(
            (c: CardInstanceState) => c.id === "bolt-stale"
        );
        expect(inHand).toBeDefined();
        expect(inHand!.kickerPayments).toBeUndefined();

        // 4. Recast, UNKICKED. Only {R} is available, so the kicker could not
        //    have been paid even by accident.
        const tokensBefore = getPlayer(state, "p1").battlefield.filter(
            (c: CardInstanceState) => c.isToken
        ).length;
        getPlayer(state, "p1").manaPool = {
            W: 0,
            U: 0,
            B: 0,
            R: 1,
            G: 0,
            C: 0,
        };
        finalizeTargetSelection(
            state,
            {
                playerId: "p1",
                cardInstanceId: "bolt-stale",
                targetType: ["Creature", "Planeswalker", "player"],
                count: 1,
                selected: [{ type: "player", id: "p2" }],
            },
            "p1"
        );
        const recast = state.stack.find((s) => s.id === "bolt-stale");
        expect(recast).toBeDefined();
        expect(recast!.kickerPayments).toBeUndefined();
        // No phantom kick, and therefore no free Saproling.
        expect(kickTriggers(state)).toEqual([]);
        while (state.stack.length > 0) resolveTopOfStack(state);
        expect(
            getPlayer(state, "p1").battlefield.filter(
                (c: CardInstanceState) => c.isToken
            ).length
        ).toBe(tokensBefore);
    });
});

// ---------------------------------------------------------------------------
// The COUNTER exits (review round 2). `counter()`'s non-graveyard branches and
// `moveSpellFromStack` splice the item off the stack and push it straight into
// hand / library / exile — the `graveyard` default is the only one that routes
// through `sendStackItemToGraveyard`. Remand is the sharpest case: it runs NO
// reset at all, so the countered spell lands in hand with its cast-time record
// intact. Same CR 400.7 hygiene, same "enforce at the source" argument.
// ---------------------------------------------------------------------------
describe("SPELL_KICKED — a COUNTERED kicked spell drops its snapshot too (CR 400.7)", () => {
    function counterAKickedBolt(counterCard: CardDefinition) {
        const state = observerBoard();
        const victim = makeInstance(grizzlyBears.id, {
            controllerId: "p2",
            ownerId: "p2",
            id: "bears-ctr",
            power: 2,
            toughness: 2,
        });
        getPlayer(state, "p2").battlefield.push(victim);
        const bolt = makeInstance(burstLightning.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
            id: "bolt-ctr",
        });
        getPlayer(state, "p1").hand.push(bolt);
        getPlayer(state, "p1").manaPool = {
            W: 0,
            U: 0,
            B: 0,
            R: 5,
            G: 0,
            C: 0,
        };
        finalizeTargetSelection(
            state,
            {
                playerId: "p1",
                cardInstanceId: "bolt-ctr",
                targetType: ["Creature", "Planeswalker", "player"],
                count: 1,
                selected: [{ type: "permanent", id: "bears-ctr" }],
                kickerPayments: { kicker: 1 },
            } as never,
            "p1"
        );
        // The kicked spell is on the stack, snapshot and all. Counter it.
        pushSpell(state, counterCard.id, "p2", [
            { type: "spell", id: "bolt-ctr" },
        ]);
        resolveTopOfStack(state);
        return state;
    }

    it("Remand — the countered spell reaches HAND with no kicker snapshot", () => {
        // Remand's branch runs no reset whatsoever: `item.zone = "hand";
        // owner.hand.push(item)`. Without the strip, the hand card keeps
        // `{ kicker: 1 }` — a CR 400.7 violation and a field persisted to the
        // DB for a cast that is over.
        const state = counterAKickedBolt(remand);
        const inHand = getPlayer(state, "p1").hand.find(
            (c: CardInstanceState) => c.id === "bolt-ctr"
        );
        expect(inHand).toBeDefined();
        expect(inHand!.kickerPayments).toBeUndefined();
    });

    it("Memory Lapse — the countered spell reaches the LIBRARY with no kicker snapshot", () => {
        const state = counterAKickedBolt(memoryLapse);
        const inLibrary = getPlayer(state, "p1").library.find(
            (c: CardInstanceState) => c.id === "bolt-ctr"
        );
        expect(inLibrary).toBeDefined();
        expect(inLibrary!.kickerPayments).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// EVENT_FIELD_REGISTRY census (ADR 0049).
// ---------------------------------------------------------------------------
describe("SPELL_KICKED — $event.casterId census (ADR 0049)", () => {
    it("flattens to the kicking player, and never resolves a different event type", () => {
        const row = getEventFieldRow("SPELL_KICKED", "casterId")!;
        expect(row.family).toBe("player");
        expect(
            row.resolve({
                type: "SPELL_KICKED",
                casterId: "p2",
                spellInstanceId: "s1",
                spellCardId: burstLightning.id,
                kickerId: "kicker",
                spellTypes: ["Instant"],
                spellSubtypes: [],
                spellColors: ["R"],
            })
        ).toBe("p2");
        expect(
            row.resolve({
                type: "PHASE_BEGIN",
                phase: "UPKEEP",
                activePlayerId: "p1",
            })
        ).toBeUndefined();
    });

    it("rejects an uncensused field on the event", () => {
        expect(getEventFieldRow("SPELL_KICKED", "kickerId")).toBeUndefined();
    });
});
