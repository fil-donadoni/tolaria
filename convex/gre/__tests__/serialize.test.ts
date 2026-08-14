import { describe, expect, it } from "vitest";
import {
    compactState,
    expandState,
    PERSISTED_OPTIONAL_KEYS,
    TRANSIENT_KEYS,
} from "../serialize";
import type { GameState } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import {
    animateArtifact,
    lightningBolt,
    mountain,
    plains,
    savannahLions,
} from "../../cards/sets/lea";
import { tokenDefinitionId } from "../../cards";
import type { TokenSpec } from "../../cards/types";
import { projectPublicState } from "../../gameProjections";

function freshState(): GameState {
    const p1 = makePlayer("p1", {
        library: [
            makeInstance(mountain.id, { controllerId: "p1", zone: "library" }),
            makeInstance(mountain.id, { controllerId: "p1", zone: "library" }),
            makeInstance(lightningBolt.id, {
                controllerId: "p1",
                zone: "library",
            }),
        ],
        hand: [
            makeInstance(lightningBolt.id, {
                controllerId: "p1",
                zone: "hand",
            }),
        ],
    });
    const p2 = makePlayer("p2", {
        library: [
            makeInstance(plains.id, { controllerId: "p2", zone: "library" }),
        ],
        battlefield: [
            makeInstance(savannahLions.id, {
                controllerId: "p2",
                ownerId: "p2",
                zone: "battlefield",
                isTapped: false,
            }),
        ],
    });
    return makeState({ players: [p1, p2] });
}

describe("game_state serialize round-trip", () => {
    // CR 701.21a — a parked SacrificeSelection nests under the already-persisted
    // pendingCast key, so it must survive the compact/expand round trip intact.
    it("preserves a parked sacrificeSelection on pendingCast", () => {
        const state = freshState();
        const forestId = state.players[0].battlefield[0]?.id ?? "x";
        state.pendingCast = {
            playerId: "p1",
            cardInstanceId: "cast-inst",
            manaCost: {},
            sacrificeSelection: {
                playerId: "p1",
                reason: "Drought",
                requirements: [{ filter: { subtypes: ["Swamp"] }, count: 2 }],
                picked: [forestId],
            },
        } as unknown as NonNullable<GameState["pendingCast"]>;
        const expanded = expandState(compactState(state));
        expect(expanded.pendingCast?.sacrificeSelection).toEqual({
            playerId: "p1",
            reason: "Drought",
            requirements: [{ filter: { subtypes: ["Swamp"] }, count: 2 }],
            picked: [forestId],
        });
    });

    // CR 601.2g — a parked generic-spend choice nests under the already-persisted
    // pendingCast key, so it must survive the compact/expand round trip so a
    // save/load reloads mid-payment awaiting the same colour choice (issue #1444).
    it("preserves a parked manaSpendChoice on pendingCast", () => {
        const state = freshState();
        state.pendingCast = {
            playerId: "p1",
            cardInstanceId: "cast-inst",
            manaCost: { X: 1 },
            tappedLandIds: [],
            manaSpendChoice: { generic: 1, candidateColors: ["U", "G"] },
        } as unknown as NonNullable<GameState["pendingCast"]>;
        const expanded = expandState(compactState(state));
        expect(expanded.pendingCast?.manaSpendChoice).toEqual({
            generic: 1,
            candidateColors: ["U", "G"],
        });
    });

    // CR 601.2g — same parked choice, activation side (pendingActivation).
    it("preserves a parked manaSpendChoice on pendingActivation", () => {
        const state = freshState();
        state.pendingActivation = {
            playerId: "p1",
            cardInstanceId: "act-inst",
            abilityId: "a1",
            manaCost: { X: 2 },
            tappedLandIds: [],
            tapSource: false,
            sacrificeSource: false,
            manaSpendChoice: { generic: 2, candidateColors: ["U", "R", "G"] },
        } as unknown as NonNullable<GameState["pendingActivation"]>;
        const expanded = expandState(compactState(state));
        expect(expanded.pendingActivation?.manaSpendChoice).toEqual({
            generic: 2,
            candidateColors: ["U", "R", "G"],
        });
    });

    // CR 702.139 (ADR 0064) — the companion slot round-trips: `instance` is
    // compacted/expanded exactly like every other card, `used` survives
    // verbatim.
    it("preserves a player's companion slot (issue #1391)", () => {
        const state = freshState();
        state.players[0].companion = {
            instance: makeInstance(savannahLions.id, {
                controllerId: "p1",
                ownerId: "p1",
            }),
            used: false,
        };
        const expanded = expandState(compactState(state));
        const companion = expanded.players[0].companion;
        expect(companion).toBeDefined();
        expect(companion?.used).toBe(false);
        expect((companion?.instance.card as { id?: string }).id).toBe(
            savannahLions.id
        );
        expect(companion?.instance.types).toEqual(["Creature"]);
    });

    // CR 116.2 / 702.139a (ADR 0064) — the in-progress {3} companion-summon
    // payment (a plain-scalar sibling of pendingCast/pendingActivation)
    // round-trips via the generic optional-key loop.
    it("preserves a parked pendingCompanionPay (issue #1391)", () => {
        const state = freshState();
        state.pendingCompanionPay = {
            playerId: "p1",
            manaCost: { X: 3 },
            tappedLandIds: ["land-1", "land-2", "land-3"],
        };
        const expanded = expandState(compactState(state));
        expect(expanded.pendingCompanionPay).toEqual({
            playerId: "p1",
            manaCost: { X: 3 },
            tappedLandIds: ["land-1", "land-2", "land-3"],
        });
    });

    // CR 303.4f — an Aura held off every zone while its controller owes a
    // `choose-aura-host` pick must survive the DB round-trip, so a save/load
    // mid-choice reloads the staged Aura (a stable save point can fall here).
    it("preserves stagedAuraEntries mid aura-host choice", () => {
        const state = freshState();
        const aura = makeInstance(animateArtifact.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        state.stagedAuraEntries = [{ aura, controllerId: "p1" }];
        const expanded = expandState(compactState(state));
        expect(expanded.stagedAuraEntries).toEqual([
            { aura, controllerId: "p1" },
        ]);
    });

    it("re-expands a fresh state to a deeply-equal GameState", () => {
        const state = freshState();
        const compact = compactState(state);
        const expanded = expandState(compact);
        expect(expanded).toEqual(state);
    });

    it("preserves non-default battlefield flags", () => {
        const state = freshState();
        const lion = state.players[1].battlefield[0];
        lion.isTapped = true;
        lion.isSummoningSick = true;
        lion.damageMarked = 1;
        lion.counters = { "+1/+1": 2 };
        // CR 606.3 — the per-permanent "a loyalty ability was activated this
        // turn" lock must survive a save/load (issue #700).
        lion.loyaltyActivatedThisTurn = true;
        // CR 111 — token provenance link survives the DB round-trip.
        lion.createdBy = "source-instance-7";
        // CR 704.5m — the world-rule timestamp is a battlefield-only property
        // that must persist so a save/load preserves which World permanent is
        // the newest.
        lion.worldSeq = 3;
        const expanded = expandState(compactState(state));
        const got = expanded.players[1].battlefield[0];
        expect(got.isTapped).toBe(true);
        expect(got.isSummoningSick).toBe(true);
        expect(got.damageMarked).toBe(1);
        expect(got.counters).toEqual({ "+1/+1": 2 });
        expect(got.loyaltyActivatedThisTurn).toBe(true);
        expect(got.createdBy).toBe("source-instance-7");
        expect(got.worldSeq).toBe(3);
    });

    it("preserves a depletion counter on a tapped land (ICE depletion duals, CR 122.1)", () => {
        // The depletion-dual untap-lock (#663) stores its state entirely in the
        // existing per-instance `counters` map — no new GameState field. A
        // tapped land carrying one `depletion` counter must survive the DB
        // round-trip so a save/load reloads mid-depletion-cycle correctly (the
        // untap step reads the counter to decide whether the land untaps).
        const state = freshState();
        const land = state.players[1].battlefield[0];
        land.isTapped = true;
        land.counters = { depletion: 1 };
        const expanded = expandState(compactState(state));
        const got = expanded.players[1].battlefield[0];
        expect(got.isTapped).toBe(true);
        expect(got.counters).toEqual({ depletion: 1 });
    });

    it("preserves a timed subtype change (Orcish Farmer, CR 305.7 / 502.1, #671)", () => {
        // The timed land-type change is a per-instance field that must survive
        // the DB round-trip so a save/load mid-effect reverts at the right untap
        // step (the duration is replay-deterministic with its resolved playerId).
        const state = freshState();
        const land = state.players[1].battlefield[0];
        land.subtypes = ["Swamp"];
        land.temporarySubtypeChange = {
            subtypes: ["Swamp"],
            restoreSubtypes: ["Forest"],
            duration: { phase: "untap", playerId: "p2" },
        };
        const expanded = expandState(compactState(state));
        const got = expanded.players[1].battlefield[0];
        expect(got.subtypes).toEqual(["Swamp"]);
        expect(got.temporarySubtypeChange).toEqual({
            subtypes: ["Swamp"],
            restoreSubtypes: ["Forest"],
            duration: { phase: "untap", playerId: "p2" },
        });
        // Absent when no timed change is active.
        const empty = expandState(compactState(freshState()));
        expect(
            empty.players[1].battlefield[0].temporarySubtypeChange
        ).toBeUndefined();
    });

    it("preserves an EMPTY mana-cost override and the art pin (CR 707.2 / 111, issue #2339)", () => {
        // An Eternalize / Embalm token copy carries `manaCostOverride: {}` —
        // the EMPTY object IS the override ("it has no mana cost"), so a
        // truthiness/length test in the compactor would drop exactly the case
        // that matters and the token's mana value would silently revert to the
        // copied card's printed cost after a save/load.
        const state = freshState();
        const token = state.players[1].battlefield[0];
        token.manaCostOverride = {};
        token.imagePrintId = "6ef58164-4155-4e5b-8c16-f16f2ab65baa";
        const got = expandState(compactState(state)).players[1].battlefield[0];
        expect(got.manaCostOverride).toEqual({});
        expect(got.imagePrintId).toBe("6ef58164-4155-4e5b-8c16-f16f2ab65baa");
        // Absent for an ordinary permanent.
        const plain = expandState(compactState(freshState())).players[1]
            .battlefield[0];
        expect(plain.manaCostOverride).toBeUndefined();
        expect(plain.imagePrintId).toBeUndefined();
    });

    it("preserves a timed color override (Kavu Chameleon, CR 305.7 / 613.1d, issue #1065)", () => {
        // The timed colour override is a per-instance field that must survive
        // the DB round-trip so a save/load mid-turn reverts at the right
        // cleanup step (the duration is replay-deterministic).
        const state = freshState();
        const land = state.players[1].battlefield[0];
        land.colorOverride = ["G"];
        land.temporaryColorOverride = {
            colors: ["G"],
            restoreColorOverride: undefined,
            duration: { phase: "end-of-turn" },
        };
        const expanded = expandState(compactState(state));
        const got = expanded.players[1].battlefield[0];
        expect(got.colorOverride).toEqual(["G"]);
        expect(got.temporaryColorOverride).toEqual({
            colors: ["G"],
            duration: { phase: "end-of-turn" },
        });
        // Absent when no timed override is active.
        const empty = expandState(compactState(freshState()));
        expect(
            empty.players[1].battlefield[0].temporaryColorOverride
        ).toBeUndefined();
    });

    it("preserves a wind counter on a tapped permanent (Freyalise's Winds, CR 122.1 / 614.6)", () => {
        // Freyalise's Winds (#668) stores its untap-replacement state entirely
        // in the existing per-instance `counters` map (a `wind` counter) — no
        // new GameState field. A tapped permanent carrying a wind counter must
        // survive the DB round-trip so a save/load reloads correctly: the untap
        // step reads the counter (with Winds in play) to keep it tapped and shed
        // the counter.
        const state = freshState();
        const perm = state.players[1].battlefield[0];
        perm.isTapped = true;
        perm.counters = { wind: 1 };
        const expanded = expandState(compactState(state));
        const got = expanded.players[1].battlefield[0];
        expect(got.isTapped).toBe(true);
        expect(got.counters).toEqual({ wind: 1 });
    });

    it("preserves the per-turn draw tally (Sylvan Library, CR 121.1)", () => {
        const state = freshState();
        state.players[0].drawnThisTurn = ["card-a", "card-b", "card-c"];
        const expanded = expandState(compactState(state));
        expect(expanded.players[0].drawnThisTurn).toEqual([
            "card-a",
            "card-b",
            "card-c",
        ]);
        // Absent when empty (omitted rather than serialized as []).
        const empty = expandState(compactState(freshState()));
        expect(empty.players[0].drawnThisTurn).toBeUndefined();
    });

    it("preserves a player's energy counters (CR 122.1, issue #697)", () => {
        const state = freshState();
        state.players[0].energyCounters = 5;
        const expanded = expandState(compactState(state));
        expect(expanded.players[0].energyCounters).toBe(5);
        // Absent when zero (omitted rather than serialized as 0), like poison.
        const empty = expandState(compactState(freshState()));
        expect(empty.players[0].energyCounters).toBeUndefined();
    });

    it("preserves a non-zero mana pool", () => {
        const state = freshState();
        state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 3, G: 1, C: 0 };
        const expanded = expandState(compactState(state));
        expect(expanded.players[0].manaPool).toEqual({
            W: 0,
            U: 0,
            B: 0,
            R: 3,
            G: 1,
            C: 0,
        });
    });

    it("preserves restricted mana across the round trip (CR 106.6)", () => {
        const state = freshState();
        state.players[0].restrictedMana = [
            { color: "G", amount: 2, restriction: "creature-spell" },
            // artifact-spell restriction (Mishra's Workshop, #283).
            { color: "C", amount: 3, restriction: "artifact-spell" },
        ];
        const expanded = expandState(compactState(state));
        expect(expanded.players[0].restrictedMana).toEqual([
            { color: "G", amount: 2, restriction: "creature-spell" },
            { color: "C", amount: 3, restriction: "artifact-spell" },
        ]);
        // Absent when empty (omitted rather than serialized as []).
        const empty = expandState(compactState(freshState()));
        expect(empty.players[0].restrictedMana).toBeUndefined();
    });

    it("preserves stack items with cast metadata", () => {
        const state = freshState();
        const bolt = state.players[0].hand[0];
        state.stack = [
            {
                ...bolt,
                zone: "stack",
                castById: "p1",
                chosenX: 0,
                chosenModeId: "destroy",
                targets: [{ type: "player", id: "p2" }],
            },
        ];
        const expanded = expandState(compactState(state));
        expect(expanded.stack).toHaveLength(1);
        const top = expanded.stack[0];
        expect(top.castById).toBe("p1");
        expect(top.chosenX).toBe(0);
        expect(top.chosenModeId).toBe("destroy");
        expect(top.targets).toEqual([{ type: "player", id: "p2" }]);
    });

    it("preserves a stack item's notedManaSpent (noted-mana battery, #666, CR 106.10)", () => {
        // A noted-mana battery ability waiting on the stack must reload the
        // type/amount of mana spent on its activation after a DB round-trip, so
        // the resolve step still notes the right colour.
        const state = freshState();
        const amulet = state.players[0].hand[0];
        state.stack = [
            {
                ...amulet,
                zone: "stack",
                castById: "p1",
                abilityId: "jeweled-amulet-charge",
                notedManaSpent: { R: 1 },
            },
        ];
        const top = expandState(compactState(state)).stack[0];
        expect(top.notedManaSpent).toEqual({ R: 1 });
    });

    it("preserves a stack item's additionalSacrificeSnapshot incl. power (#670, CR 608.2h)", () => {
        // Freyalise Supplicant snapshots the sacrificed creature's effective
        // POWER at cost commit (the creature is gone by resolution). The whole
        // snapshot — mv, subtypes, AND the new `power` field — must survive a DB
        // round-trip so a suspended ability still deals floor(power/2).
        const state = freshState();
        const supplicant = state.players[0].hand[0];
        state.stack = [
            {
                ...supplicant,
                zone: "stack",
                castById: "p1",
                abilityId: "freyalise-supplicant-sacrifice-ping",
                additionalSacrificeSnapshot: {
                    cardInstanceId: "fuel",
                    mv: 3,
                    subtypes: ["Goblin"],
                    power: 4,
                },
            },
        ];
        const top = expandState(compactState(state)).stack[0];
        expect(top.additionalSacrificeSnapshot).toEqual({
            cardInstanceId: "fuel",
            mv: 3,
            subtypes: ["Goblin"],
            power: 4,
        });
    });

    it("preserves a stack item's divide-as-you-choose split (targetAmounts, #664)", () => {
        // CR 601.2d / 120.4 — a suspended divide spell must reload its
        // per-target split after a DB round-trip (Fire Covenant / Spoils of War).
        const state = freshState();
        const spell = state.players[0].hand[0];
        state.stack = [
            {
                ...spell,
                zone: "stack",
                castById: "p1",
                chosenX: 5,
                targets: [
                    { type: "permanent", id: "a" },
                    { type: "permanent", id: "b" },
                ],
                targetAmounts: { "permanent:a": 4, "permanent:b": 1 },
            },
        ];
        const top = expandState(compactState(state)).stack[0];
        expect(top.targetAmounts).toEqual({
            "permanent:a": 4,
            "permanent:b": 1,
        });
    });

    it("preserves a stack item's actingPlayerId (controlled cast, ADR 0037)", () => {
        const state = freshState();
        const spell = state.players[0].hand[0];
        state.stack = [
            {
                ...spell,
                zone: "stack",
                // Word of Command — chosen spell controlled by the opponent
                // (p2) but decided by the acting player (p1).
                castById: "p2",
                actingPlayerId: "p1",
            },
        ];
        const expanded = expandState(compactState(state));
        expect(expanded.stack[0].castById).toBe("p2");
        expect(expanded.stack[0].actingPlayerId).toBe("p1");
        // Absent on a normal cast (omitted rather than serialized).
        state.stack[0].actingPlayerId = undefined;
        const normal = expandState(compactState(state));
        expect(normal.stack[0].actingPlayerId).toBeUndefined();
    });

    it("preserves a stack item's dynamicCantBeCountered rider (CR 106.6/701.13, issue #1559)", () => {
        // State is saved at every stable point, including immediately after a
        // spell is cast and BEFORE the opponent gets priority to try to
        // counter it — so the per-cast "can't be countered" rider (Delighted
        // Halfling's restricted mana) must survive that round-trip or the
        // flag is silently gone by the time counter() reads it.
        const state = freshState();
        const spell = state.players[0].hand[0];
        state.stack = [
            {
                ...spell,
                zone: "stack",
                castById: "p1",
                dynamicCantBeCountered: true,
            },
        ];
        const expanded = expandState(compactState(state));
        expect(expanded.stack[0].dynamicCantBeCountered).toBe(true);
        // Absent on a normal cast (omitted rather than serialized).
        state.stack[0].dynamicCantBeCountered = undefined;
        const normal = expandState(compactState(state));
        expect(normal.stack[0].dynamicCantBeCountered).toBeUndefined();
    });

    it("preserves a fired inline delayed trigger's body on the stack item (ADR 0048, CR 603.7a)", () => {
        const state = freshState();
        const spell = state.players[0].hand[0];
        state.stack = [
            {
                ...spell,
                zone: "stack",
                castById: "p1",
                delayedTriggerId: "$inline-effects",
                // Payload keys drop the `$` sigil (Convex reserves leading
                // `$`); the ref VALUE inside the effects keeps it.
                delayedPayload: { it: "target-7" },
                delayedEffects: [{ op: "destroy", target: { ref: "$it" } }],
                delayedOracleText:
                    "At the beginning of the next end step, destroy it.",
            },
        ];
        const expanded = expandState(compactState(state));
        expect(expanded.stack[0].delayedTriggerId).toBe("$inline-effects");
        expect(expanded.stack[0].delayedPayload).toEqual({ it: "target-7" });
        expect(expanded.stack[0].delayedEffects).toEqual([
            { op: "destroy", target: { ref: "$it" } },
        ]);
        // The inline trigger's oracle text must survive a mid-suspension save,
        // else the client re-renders it as a full-card image after reload.
        expect(expanded.stack[0].delayedOracleText).toBe(
            "At the beginning of the next end step, destroy it."
        );
    });

    it("preserves the Monarch draw trigger's designationId on the stack item (CR 725, #1305)", () => {
        // The source-less inherent designation trigger keys its marker-card art
        // + name off `designationId`. It is a whitelisted StackItem field —
        // dropping it in the compactor made the client fall back to the empty
        // "Token"/"Delayed trigger" placeholder after every DB round-trip (the
        // in-memory GRE/wire tests never round-tripped, so they missed it).
        const state = freshState();
        const spell = state.players[0].hand[0];
        state.stack = [
            {
                ...spell,
                card: { id: "" },
                zone: "stack",
                castById: "p1",
                delayedTriggerId: "$inline-effects",
                delayedEffects: [
                    { op: "draw", player: "controller", count: 1 },
                ],
                delayedOracleText:
                    "At the beginning of the monarch's end step, that player draws a card.",
                designationId: "monarch",
                // Per-source themed marker (Forth Eorlingas' LTR printing).
                designationImagePrintId: "63455c28-3e53-45b1-8d0b-a5045dab1fb9",
            },
        ];
        const expanded = expandState(compactState(state));
        expect(expanded.stack[0].designationId).toBe("monarch");
        expect(expanded.stack[0].designationImagePrintId).toBe(
            "63455c28-3e53-45b1-8d0b-a5045dab1fb9"
        );
    });

    it("preserves monarchSourceCardId (themed crown provenance, #1305)", () => {
        const state = freshState();
        state.monarchId = "p1";
        state.monarchSourceCardId = "06c053d3-028e-4961-93a5-5b7bb5a8601c";
        const expanded = expandState(compactState(state));
        expect(expanded.monarchSourceCardId).toBe(
            "06c053d3-028e-4961-93a5-5b7bb5a8601c"
        );
    });

    it("preserves a stack item's exileOnResolve flag (Recall, CR 608.2)", () => {
        const state = freshState();
        const recall = state.players[0].hand[0];
        state.stack = [
            {
                ...recall,
                zone: "stack",
                castById: "p1",
                exileOnResolve: true,
            },
        ];
        const expanded = expandState(compactState(state));
        expect(expanded.stack[0].exileOnResolve).toBe(true);
    });

    it("preserves a stack item's actingPlayerId override (Word of Command, ADR 0037)", () => {
        // Acting Player (ADR 0037): a controlled cast carries an actingPlayerId
        // distinct from the controller (castById). It must survive the DB
        // round-trip so a suspended controlled resolution resumes correctly.
        const state = freshState();
        const woc = state.players[0].hand[0];
        state.stack = [
            {
                ...woc,
                zone: "stack",
                castById: "p2", // the controlled opponent owns the cast
                actingPlayerId: "p1", // WoC's controller answers the prompts
            },
        ];
        const expanded = expandState(compactState(state));
        expect(expanded.stack[0].actingPlayerId).toBe("p1");
        expect(expanded.stack[0].castById).toBe("p2");
    });

    it("library entries derive owner/controller/zone implicitly", () => {
        const state = freshState();
        const compact = compactState(state);
        const lib = (compact.players as Array<Record<string, unknown>>)[0]
            .library as Array<[string, string]>;
        expect(Array.isArray(lib[0])).toBe(true);
        expect(lib[0]).toHaveLength(2);
        const expanded = expandState(compact);
        for (const card of expanded.players[0].library) {
            expect(card.controllerId).toBe("p1");
            expect(card.ownerId).toBe("p1");
            expect(card.zone).toBe("library");
            expect(card.isTapped).toBe(false);
        }
    });

    // ADR 0026 / PRD #338 — persistent per-viewer card knowledge survives the
    // DB round trip on both library (3-tuple form) and hand cards.
    it("preserves knownTo on library and hand cards across the round trip", () => {
        const state = freshState();
        // Top library card known to p1 (e.g. scry-to-top / reorder).
        state.players[0].library[0].knownTo = ["p1"];
        // A hand card known to an opponent (e.g. Duress — future slice, but
        // the field must already round-trip).
        state.players[0].hand[0].knownTo = ["p2"];
        const expanded = expandState(compactState(state));
        expect(expanded.players[0].library[0].knownTo).toEqual(["p1"]);
        expect(expanded.players[0].hand[0].knownTo).toEqual(["p2"]);
        // An unknown library card stays compact (2-tuple) and has no knownTo.
        expect(expanded.players[0].library[1].knownTo).toBeUndefined();
    });

    // ADR 0026 slice 2 (#340) — a REVEALED library card carries every player in
    // knownTo; the multi-element array must survive the 3-tuple round trip.
    it("preserves a reveal-to-all knownTo (multiple viewers) across the round trip", () => {
        const state = freshState();
        state.players[0].library[0].knownTo = ["p1", "p2"];
        const expanded = expandState(compactState(state));
        expect(expanded.players[0].library[0].knownTo).toEqual(["p1", "p2"]);
    });

    // ADR 0026 slice 6 (#342) — a face-down exiled card (impulse-draw) is an
    // exile-zone card carrying a non-empty knownTo; the knowledge must survive
    // the DB round trip so the controller keeps seeing it after a reload.
    it("preserves knownTo on a face-down exiled card across the round trip", () => {
        const state = freshState();
        const exiled = makeInstance(lightningBolt.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "exile",
            knownTo: ["p1"],
        });
        state.players[0].exile.push(exiled);
        const expanded = expandState(compactState(state));
        const got = expanded.players[0].exile.find((c) => c.id === exiled.id)!;
        expect(got.knownTo).toEqual(["p1"]);
    });

    // Issue #791 / #1319 (CR 111 / 610.3) — the per-source exile provenance
    // link (Currency Converter's "exiled with this artifact", generalized as
    // the linked-exile tracking foundation) must survive a save/load so a
    // future retrieval ability still finds its linked cards after a reload.
    it("preserves exiledBySourceId on an exiled card across the round trip", () => {
        const state = freshState();
        const exiled = makeInstance(lightningBolt.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "exile",
        });
        exiled.exiledBySourceId = "some-permanent-id";
        state.players[0].exile.push(exiled);
        const expanded = expandState(compactState(state));
        const got = expanded.players[0].exile.find((c) => c.id === exiled.id)!;
        expect(got.exiledBySourceId).toBe("some-permanent-id");
    });

    it("keeps the compact library entry a 2-tuple when knownTo is empty", () => {
        const state = freshState();
        const compact = compactState(state);
        const lib = (compact.players as Array<Record<string, unknown>>)[0]
            .library as Array<unknown[]>;
        expect(lib[0]).toHaveLength(2);
    });

    // Exhaustive wire-format invariant: every non-default transient field on a
    // battlefield permanent must survive the compact → expand round trip.
    // Each property mirrored here is read by GRE rules / layer system /
    // triggers; dropping any of them would silently corrupt gameplay (e.g.
    // the Holy Armor / Firebreathing client regression — same class of bug
    // applied to the serialize boundary). Every new transient field added to
    // CardInstanceState must come with an assertion in this block.
    it("preserves every transient battlefield field across the round trip", () => {
        const state = freshState();
        const lion = state.players[1].battlefield[0];
        lion.isTapped = true;
        lion.isToken = true;
        lion.isSummoningSick = true;
        lion.isAttacking = true;
        lion.isBlocking = true;
        lion.hasAttackedThisTurn = true;
        lion.hasBlockedThisTurn = true;
        // #490 — per-creature "attacked during your last turn" history flag
        // (Giant Turtle, LEG).
        lion.attackedDuringLastTurn = true;
        // C5 (#384) — turn-scoped counter-trigger flags.
        lion.dealtDamageToOpponentThisTurn = true;
        lion.startedTurnUntapped = true;
        lion.manaCommitted = true;
        // #793 (CR 603.3) — irreversible-tap flag: the source's tap-for-mana
        // put a becomes-tapped trigger on the stack, so the standalone
        // untap-toggle is blocked. Must survive the DB round-trip between the
        // tap mutation and the later untap attempt.
        lion.tapTriggerCommitted = true;
        lion.damageMarked = 2;
        // CR 702.2b / 704.5h (#957) — "dealt deathtouch damage this turn" mark:
        // must survive a mid-turn save/load so the deathtouch SBA still fires.
        lion.dealtDeathtouchDamage = true;
        lion.regenerationShields = 1;
        lion.chosenMana = { R: 1, G: 1 };
        // #482 — charge counters removed to pay a Mana Battery's scaling cost,
        // snapshotted for untap refund.
        lion.manaCounterRemoval = { type: "charge", count: 2 };
        lion.attachedTo = "host-id";
        lion.temporaryPTMods = [
            { power: 1, toughness: 0, duration: { phase: "end-of-turn" } },
        ];
        lion.temporaryPTSet = [
            { power: 0, duration: { phase: "end-of-turn" } },
            { power: 0, toughness: 2, duration: { phase: "end-of-turn" } },
            // Indefinite set (#487, Wall of Tombstones): no duration field.
            { toughness: 4 },
        ];
        lion.sourceTappedPTMods = [
            { power: 2, toughness: -2, sourceId: "gear-1" },
        ];
        lion.untapLockedBy = ["gremlin-1"];
        lion.skipNextUntap = true;
        // FEM Vodalian War Machine — turn-scoped "attack as though no defender".
        lion.canAttackDespiteDefenderThisTurn = true;
        lion.cantBeBlockedBySubtypesThisTurn = ["Wall"];
        lion.counters = { "+1/+1": 1, "+1/+0": 2 };
        lion.grantedStaticAbilities = [
            { ability: "flying", auraId: "aura-1", seq: 3 },
            // CR 611.2a — duration-scoped keyword grant (Wall of Caltrops' EOT
            // banding, #495). Persists across the DB round-trip with its duration.
            { ability: "banding", duration: { phase: "end-of-turn" } },
            // CR 613.1f (issue #1715) — a grant a strictly-later stripper
            // outranked: recorded but never materialized. The flag has to
            // survive the round trip or the next unapply eats an occurrence
            // that belongs to another source.
            {
                ability: "trample",
                auraId: "aura-2",
                seq: 1,
                suppressed: true,
            },
        ];
        // CR 613.7 layer timestamp (issue #1715) — the source stamp every
        // layer-4/6 record above copies.
        lion.staticSeq = 4;
        // Layer-4 ADD grants (CR 305.7 — Yavimaya) carry the same stamp, and
        // are load-bearing for `composeMaterializedSubtypes` after a reload.
        lion.grantedSubtypesAdd = [
            { subtype: "Forest", auraId: "yavimaya-1", seq: 2 },
        ];
        // CR 611.2a — duration-scoped keyword removal (Shelkin Brownie / Tolaria, #381).
        lion.temporaryRemovedKeywords = [
            {
                keyword: "bands with other:legendary",
                duration: { phase: "end-of-turn" },
            },
            { keyword: "banding", duration: { phase: "end-of-turn" } },
        ];
        lion.grantedActivatedAbilities = [
            { sourceCardId: "src", abilityId: "ability", auraId: "aura-1" },
        ];
        // CR 113.1 — anthem-granted triggered ability reference (Energy Flux, #291).
        lion.grantedTriggeredAbilities = [
            {
                sourceCardId: "energy-flux",
                abilityId: "energy-flux-upkeep",
                auraId: "flux-1",
            },
        ];
        lion.damagedBySources = ["bolt-1", "bolt-2"];
        lion.controlChanges = [
            { auraId: "aura-1", previousControllerId: "p1" },
            {
                auraId: "aladdin-1",
                previousControllerId: "p2",
                condition: {
                    kind: "controller-controls-source",
                    controllerId: "p1",
                },
            },
        ];
        lion.exileOnDeath = true;
        lion.cantBeRegeneratedThisTurn = true;
        lion.mustAttackThisTurn = true;
        lion.colorOverride = ["R"];
        lion.textChanges = [
            { kind: "land-type", from: "Forest", to: "Island" },
        ];
        lion.pileLabel = "left";
        lion.mustBlockAllThisTurn = true;
        lion.cantBlockThisTurn = true;
        lion.cantBeBlockedThisTurn = true;
        lion.chosenPlayerId = "p2";
        // ADR 0050 — Illusionary Terrain's on-entry chosen basic-type pair must
        // survive the DB round-trip so the computed subtype swap reloads.
        lion.chosenSubtypes = ["Forest", "Island"];
        lion.copiedFrom = "printed-clone-id";
        // CR 613.1f — "loses all abilities" suppression source list
        // (Titania's Song, #288).
        lion.abilitiesSuppressedBy = [
            { sourceId: "song-1", seq: 1 },
            { sourceId: "song-2", seq: 2 },
        ];
        // CR 205.4a — supertype mutation markers (Melting / Arcum's
        // Weathervane, #661): source-keyed adds/removes must round-trip so the
        // live snow status survives a mid-game save/load.
        lion.grantedSupertypes = [
            { supertype: "Snow", sourceId: "indefinite" },
        ];
        lion.removedSupertypes = [{ supertype: "Snow", sourceId: "melt-1" }];
        // #666 (CR 106.10) — noted-mana battery: the artifact's last noted
        // type/amount must survive a save/load while it sits on the battlefield.
        lion.notedMana = { mana: { R: 1, U: 2 }, castableCardId: "noted-card" };
        // #666 (CR 601.3e) — Ice Cauldron's cast-from-exile permission flag.
        lion.castableFromExileBy = "p1";
        // #946 (CR 514.2 / 608.2g) — the turn-scoped impulse-play expiry marker
        // must survive a save/load so cleanup revokes it on the right turn.
        lion.castableFromExileUntilTurn = 7;
        // issue #1156 (CR 601.3e / 117.6) — the free-cast waiver riding the
        // exile permission above (Dauthi Voidwalker) must survive a save/load.
        lion.castFromExileWithoutPayingManaCost = true;
        // issue #1689 (CR 305.9) — the land-inclusive marker riding the exile
        // permission above (Headliner Scarlett et al.) must survive a save/load.
        lion.castableFromExileIncludesLand = true;
        // #698 (CR 702.35c) — the madness-exile marker on a discarded-and-exiled
        // card must survive a save/load so the cast window + cleanup sweep hold.
        lion.madnessExiled = true;
        // issue #1344 (CR 601.3e / 117.6-analog) — Malcolm, Alluring
        // Scoundrel's per-card cast-from-graveyard grant, mirroring the
        // exile grant's three fields above.
        lion.castableFromGraveyardBy = "p1";
        lion.castableFromGraveyardUntilTurn = 9;
        lion.castFromGraveyardWithoutPayingManaCost = true;
        // CR 712 / ADR 0067 (issue #1210) — transform face flag + the front
        // face's own definition id must survive a mid-game save/load so a
        // later flip back restores the right definition.
        lion.transformed = true;
        lion.transformedFrom = "front-def-id";
        // CR 702.33 / 614.1c (issue #1716) — one-shot "was this kicked" ETB
        // snapshot, gated on and cleared by resetBattlefieldTransientState
        // (issue #1753); must survive a mid-game save/load like every other
        // transient field in this block.
        lion.wasKicked = true;
        // CR 702.33 (ADR 0079, issue #1950) — `wasKicked`'s per-Kicker-id
        // twin, needed by a two-Kicker permanent's own ETB trigger (Nightscape
        // Battlemage) to re-check "if it was kicked with its {2}{U} kicker"
        // after a save/load, same lifecycle as `wasKicked` above.
        lion.kickerPayments = { "kicker-u": 1 };
        // CR 107.3 / 601.2b (issue #674) — the chosen-{X} ETB snapshot, the
        // sibling of `wasKicked` above. Ravenous's ETB trigger re-checks its
        // intervening-if AFTER the state has been persisted at a stable point,
        // so losing this across the round trip silently makes "if X is 5 or
        // greater" false for every X.
        lion.chosenXOnCast = 5;

        const expanded = expandState(compactState(state));
        const got = expanded.players[1].battlefield[0];
        expect(got.isTapped).toBe(true);
        expect(got.isToken).toBe(true);
        expect(got.isSummoningSick).toBe(true);
        expect(got.isAttacking).toBe(true);
        expect(got.isBlocking).toBe(true);
        expect(got.hasAttackedThisTurn).toBe(true);
        expect(got.hasBlockedThisTurn).toBe(true);
        expect(got.attackedDuringLastTurn).toBe(true);
        expect(got.dealtDamageToOpponentThisTurn).toBe(true);
        expect(got.startedTurnUntapped).toBe(true);
        expect(got.manaCommitted).toBe(true);
        expect(got.tapTriggerCommitted).toBe(true);
        expect(got.damageMarked).toBe(2);
        expect(got.dealtDeathtouchDamage).toBe(true);
        expect(got.regenerationShields).toBe(1);
        expect(got.chosenMana).toEqual({ R: 1, G: 1 });
        expect(got.manaCounterRemoval).toEqual({ type: "charge", count: 2 });
        expect(got.attachedTo).toBe("host-id");
        expect(got.temporaryPTMods).toEqual([
            { power: 1, toughness: 0, duration: { phase: "end-of-turn" } },
        ]);
        expect(got.temporaryPTSet).toEqual([
            { power: 0, duration: { phase: "end-of-turn" } },
            { power: 0, toughness: 2, duration: { phase: "end-of-turn" } },
            { toughness: 4 },
        ]);
        expect(got.sourceTappedPTMods).toEqual([
            { power: 2, toughness: -2, sourceId: "gear-1" },
        ]);
        expect(got.untapLockedBy).toEqual(["gremlin-1"]);
        expect(got.skipNextUntap).toBe(true);
        expect(got.canAttackDespiteDefenderThisTurn).toBe(true);
        expect(got.cantBeBlockedBySubtypesThisTurn).toEqual(["Wall"]);
        expect(got.counters).toEqual({ "+1/+1": 1, "+1/+0": 2 });
        expect(got.grantedStaticAbilities).toEqual([
            { ability: "flying", auraId: "aura-1", seq: 3 },
            { ability: "banding", duration: { phase: "end-of-turn" } },
            {
                ability: "trample",
                auraId: "aura-2",
                seq: 1,
                suppressed: true,
            },
        ]);
        expect(got.staticSeq).toBe(4);
        expect(got.grantedSubtypesAdd).toEqual([
            { subtype: "Forest", auraId: "yavimaya-1", seq: 2 },
        ]);
        expect(got.temporaryRemovedKeywords).toEqual([
            {
                keyword: "bands with other:legendary",
                duration: { phase: "end-of-turn" },
            },
            { keyword: "banding", duration: { phase: "end-of-turn" } },
        ]);
        expect(got.grantedActivatedAbilities).toEqual([
            { sourceCardId: "src", abilityId: "ability", auraId: "aura-1" },
        ]);
        expect(got.grantedTriggeredAbilities).toEqual([
            {
                sourceCardId: "energy-flux",
                abilityId: "energy-flux-upkeep",
                auraId: "flux-1",
            },
        ]);
        expect(got.damagedBySources).toEqual(["bolt-1", "bolt-2"]);
        expect(got.controlChanges).toEqual([
            { auraId: "aura-1", previousControllerId: "p1" },
            {
                auraId: "aladdin-1",
                previousControllerId: "p2",
                condition: {
                    kind: "controller-controls-source",
                    controllerId: "p1",
                },
            },
        ]);
        expect(got.exileOnDeath).toBe(true);
        expect(got.mustAttackThisTurn).toBe(true);
        expect(got.colorOverride).toEqual(["R"]);
        expect(got.textChanges).toEqual([
            { kind: "land-type", from: "Forest", to: "Island" },
        ]);
        expect(got.pileLabel).toBe("left");
        expect(got.mustBlockAllThisTurn).toBe(true);
        expect(got.cantBlockThisTurn).toBe(true);
        expect(got.cantBeBlockedThisTurn).toBe(true);
        expect(got.chosenPlayerId).toBe("p2");
        expect(got.chosenSubtypes).toEqual(["Forest", "Island"]);
        expect(got.copiedFrom).toBe("printed-clone-id");
        expect(got.abilitiesSuppressedBy).toEqual([
            { sourceId: "song-1", seq: 1 },
            { sourceId: "song-2", seq: 2 },
        ]);
        expect(got.grantedSupertypes).toEqual([
            { supertype: "Snow", sourceId: "indefinite" },
        ]);
        expect(got.removedSupertypes).toEqual([
            { supertype: "Snow", sourceId: "melt-1" },
        ]);
        expect(got.notedMana).toEqual({
            mana: { R: 1, U: 2 },
            castableCardId: "noted-card",
        });
        expect(got.castableFromExileBy).toBe("p1");
        expect(got.castableFromExileUntilTurn).toBe(7);
        expect(got.castFromExileWithoutPayingManaCost).toBe(true);
        expect(got.castableFromExileIncludesLand).toBe(true);
        expect(got.madnessExiled).toBe(true);
        expect(got.castableFromGraveyardBy).toBe("p1");
        expect(got.castableFromGraveyardUntilTurn).toBe(9);
        expect(got.castFromGraveyardWithoutPayingManaCost).toBe(true);
        expect(got.transformed).toBe(true);
        expect(got.transformedFrom).toBe("front-def-id");
        expect(got.wasKicked).toBe(true);
        expect(got.kickerPayments).toEqual({ "kicker-u": 1 });
        expect(got.chosenXOnCast).toBe(5);
    });

    it("preserves phasedOut bundles across the round trip (CR 702.26)", () => {
        const state = freshState();
        const host = makeInstance(savannahLions.id, {
            id: "host",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
            isTapped: true,
            counters: { "+1/+1": 1 },
        });
        const aura = makeInstance(plains.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            attachedTo: "host",
        });
        state.phasedOut = [
            {
                id: "bundle-1",
                cards: [host, aura],
                returnOn: { kind: "source-leaves", sourceId: "oubl" },
                onPhaseIn: { tap: true },
            },
        ];
        const expanded = expandState(compactState(state));
        expect(expanded.phasedOut).toHaveLength(1);
        const b = expanded.phasedOut![0];
        expect(b.id).toBe("bundle-1");
        expect(b.returnOn).toEqual({ kind: "source-leaves", sourceId: "oubl" });
        expect(b.onPhaseIn).toEqual({ tap: true });
        expect(b.cards).toHaveLength(2);
        const gotHost = b.cards.find((c) => c.id === "host")!;
        expect(gotHost.ownerId).toBe("p2");
        expect(gotHost.controllerId).toBe("p2");
        expect(gotHost.isTapped).toBe(true);
        expect(gotHost.counters).toEqual({ "+1/+1": 1 });
        const gotAura = b.cards.find((c) => c.id === "aura")!;
        expect(gotAura.ownerId).toBe("p1");
        expect(gotAura.attachedTo).toBe("host");
        // The fat definition is rehydrated from the slim `{ id }` reference.
        expect((gotHost.card as { id: string }).id).toBe(savannahLions.id);
    });

    it("preserves an untap-cycle bundle's phasedOutTurn (CR 702.26f)", () => {
        const state = freshState();
        const host = makeInstance(savannahLions.id, {
            id: "art",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        state.phasedOut = [
            {
                id: "bundle-uc",
                cards: [host],
                returnOn: { kind: "untap-cycle" },
                phasedOutTurn: 4,
            },
        ];
        const expanded = expandState(compactState(state));
        const b = expanded.phasedOut![0];
        expect(b.returnOn).toEqual({ kind: "untap-cycle" });
        // The skip-first-untap guard depends on this surviving the DB round trip.
        expect(b.phasedOutTurn).toBe(4);
    });

    it("preserves exileHeld bundles across the round trip (ADR 0028)", () => {
        const state = freshState();
        state.exileHeld = [
            {
                id: "bundle-1",
                sourceId: "coffin",
                hostId: "victim",
                hostOwnerId: "p2",
                attached: [{ id: "aura", ownerId: "p2" }],
                counters: { "+1/+1": 2 },
                returnTapped: true,
            },
        ];
        const expanded = expandState(compactState(state));
        // Pure metadata — no fat card to hydrate, so it round-trips verbatim.
        expect(expanded.exileHeld).toEqual(state.exileHeld);
    });

    it("preserves the Monarch designation across the round trip (CR 720, issue #1199)", () => {
        const state = freshState();
        state.monarchId = "p1";
        state.monarchReturnWatch = [
            { sourceId: "jailer-1", controllerId: "p1" },
        ];
        const expanded = expandState(compactState(state));
        expect(expanded.monarchId).toBe("p1");
        expect(expanded.monarchReturnWatch).toEqual(state.monarchReturnWatch);
    });

    it("preserves the City's Blessing designation across the round trip (CR 702.131, issue #1460)", () => {
        const state = freshState();
        // NON-exclusive: both players may hold it (unlike the monarch scalar).
        state.cityBlessingIds = ["p1", "p2"];
        const expanded = expandState(compactState(state));
        // Plain string array — round-trips verbatim through the generic
        // optional-key loop. MONOTONIC (CR 702.131b), so losing it across a DB
        // write would silently un-Ascend a player mid-game.
        expect(expanded.cityBlessingIds).toEqual(["p1", "p2"]);
    });

    it("preserves combatBlockRestrictions across the round trip", () => {
        const state = freshState();
        state.combatBlockRestrictions = [
            { attackerId: "atkA", allowedPileLabel: "left" },
            { attackerId: "atkB", allowedPileLabel: "right" },
        ];
        const expanded = expandState(compactState(state));
        expect(expanded.combatBlockRestrictions).toEqual(
            state.combatBlockRestrictions
        );
    });

    it("preserves the camouflageCombat flag across the round trip (#563)", () => {
        const state = freshState();
        state.camouflageCombat = true;
        const expanded = expandState(compactState(state));
        expect(expanded.camouflageCombat).toBe(true);
    });

    it("preserves the meleeCombat flag across the round trip (#669)", () => {
        // Melee's attacker-chooses-blocks routing must survive a mid-combat
        // stable-point save so the block declaration stays with the attacker.
        const state = freshState();
        state.meleeCombat = true;
        const expanded = expandState(compactState(state));
        expect(expanded.meleeCombat).toBe(true);
    });

    it("preserves a stack item's massRiderTargets across the round trip (#669)", () => {
        // Stench of Evil's per-land billing list must reload after a DB
        // round-trip when the spell is suspended on a may-pay, so the rider
        // bills the right controllers on resume.
        const state = freshState();
        const spell = state.players[0].hand[0];
        state.stack = [
            {
                ...spell,
                zone: "stack",
                castById: "p1",
                resolutionStep: 1,
                massRiderTargets: ["p1", "p2", "p2"],
            },
        ];
        const top = expandState(compactState(state)).stack[0];
        expect(top.massRiderTargets).toEqual(["p1", "p2", "p2"]);
    });

    it("preserves a suspended Effect Script's checkpoint + picks binding (#805, CR 608.3)", () => {
        // An Effect Script suspended at a `choice` Op must reload BOTH its
        // Op-index checkpoint (`resolutionStep`) and every persisted binding
        // (`collectedChoices` — the picks entry keyed `${step}:${bind}`, plus
        // any snapshot binding taken before the choice) after a DB round-trip,
        // so the resumed resolution restarts at the same Op with the same
        // bindings and never re-runs earlier (irreversible) Ops.
        const state = freshState();
        const spell = state.players[0].hand[0];
        state.stack = [
            {
                ...spell,
                zone: "stack",
                castById: "p1",
                resolutionStep: 1,
                collectedChoices: {
                    // Snapshot binding [power, toughness, controller].
                    "0:$gone": ["4", "4", "p2"],
                    // Picks binding — the chooser's submitted instance ids.
                    "1:$discards": ["h1", "h3"],
                },
            },
        ];
        const top = expandState(compactState(state)).stack[0];
        expect(top.resolutionStep).toBe(1);
        expect(top.collectedChoices).toEqual({
            "0:$gone": ["4", "4", "p2"],
            "1:$discards": ["h1", "h3"],
        });
    });

    it("compact form is materially smaller than raw JSON", () => {
        const state = freshState();
        const rawSize = JSON.stringify(state).length;
        const compactSize = JSON.stringify(compactState(state)).length;
        expect(compactSize).toBeLessThan(rawSize * 0.7);
    });

    it("pendingUntapStep survives round-trip (cursor must persist across mutations)", () => {
        const state = freshState();
        state.pendingUntapStep = { restrictionCursor: 2 };
        const got = expandState(compactState(state) as Record<string, unknown>);
        expect(got.pendingUntapStep).toEqual({ restrictionCursor: 2 });
    });

    it("pendingUntapStep omitted when undefined", () => {
        const state = freshState();
        state.pendingUntapStep = undefined;
        const compact = compactState(state);
        expect("pendingUntapStep" in compact).toBe(false);
    });
});

// S2: Schema drift guard — every optional GameState key must be accounted for
// in PERSISTED_OPTIONAL_KEYS or TRANSIENT_KEYS.
const BASE_KEYS = new Set([
    "players",
    "stack",
    "turn",
    "activePlayerId",
    "priorityPlayerId",
    "passCount",
    "phase",
    "rngSeed",
    "rngCounter",
]);

describe("schema drift guard", () => {
    it("every optional GameState key is in PERSISTED_OPTIONAL_KEYS or TRANSIENT_KEYS", () => {
        const allKnown = new Set<string>([
            ...PERSISTED_OPTIONAL_KEYS,
            ...TRANSIENT_KEYS,
            ...BASE_KEYS,
        ]);
        // Build a state with every optional field populated so we can
        // enumerate the actual runtime keys.
        const state = freshState();
        state.pendingCast = {
            playerId: "p1",
            cardInstanceId: "c1",
            manaCost: { R: 1 },
            tappedLandIds: [],
            keepPriority: false,
        };
        state.pendingActivation = {
            playerId: "p1",
            cardInstanceId: "c1",
            abilityId: "a1",
            manaCost: { R: 1 },
            tappedLandIds: [],
            tapSource: true,
            sacrificeSource: false,
        };
        state.pendingCompanionPay = {
            playerId: "p1",
            manaCost: { X: 3 },
            tappedLandIds: [],
        };
        state.players[0].companion = {
            instance: makeInstance(savannahLions.id, {
                controllerId: "p1",
                ownerId: "p1",
            }),
            used: false,
        };
        state.pendingTarget = {
            playerId: "p1",
            cardInstanceId: "c1",
            targetType: "Creature",
            count: 1,
            selected: [],
        };
        state.pendingChoices = [
            {
                stackItemId: "s1",
                step: 0,
                choiceId: "c1",
                playerId: "p1",
                zoneOwnerId: "p1",
                kind: "untap-pick",
                zone: "battlefield",
                count: 1,
                prompt: "test",
            },
        ];
        state.autoPassPlayers = ["p1"];
        state.singleShotAutoPass = "p1";
        state.combat = {
            attackerIds: [],
            confirmed: false,
            blockerAssignments: {},
            blockersConfirmed: false,
        };
        state.nextGrantSeq = 1;
        state.mulligan = {
            mulligansTaken: [0, 0],
            declarations: [null, null],
            locked: [false, false],
            declaringPlayerId: "p1",
            bottoming: false,
        };
        state.gameOver = { winnerId: "p1", loserId: "p2", reason: "life" };
        state.extraTurns = ["p1"];
        state.preventionEffects = [
            {
                sourceInstanceId: "s1",
                playerId: "p1",
                duration: { phase: "end-of-turn" },
            },
        ];
        state.targetPreventionShields = [
            {
                targetType: "player",
                targetId: "p1",
                remaining: 1,
                duration: { phase: "end-of-turn" },
            },
        ];
        state.playerDamagePrevention = [
            {
                playerId: "p1",
                match: { sourceInstanceId: "s1" },
                mode: "half-down",
                remaining: 1,
                duration: { phase: "end-of-turn" },
            },
            {
                playerId: "p2",
                match: { sourceStaticAbility: "flying" },
                mode: "all",
                remaining: 999,
                duration: { phase: "end-of-turn" },
            },
        ];
        state.delayedTriggers = [
            {
                id: "dt-1",
                sourceCardId: "src-1",
                triggerId: "trig-1",
                controller: "p1",
                timing: "next-end-step",
                payload: { targetId: "p2" },
            },
        ];
        state.nextDelayedSeq = 1;
        state.nextTokenSeq = 1;
        state.nextInstanceId = 80;
        state.pendingEvents = [
            {
                type: "CREATURE_DIED",
                creatureInstanceId: "c1",
                creatureControllerId: "p1",
                creatureTypes: ["Creature"],
                damagedBySources: [],
                creaturePower: 2,
                creatureToughness: 2,
                combatPartnerIds: ["c2"],
            },
        ];
        state.deathsThisTurn = 1;
        state.pendingUntapStep = { restrictionCursor: 1 };
        state.pendingCleanupDiscard = { playerId: "p1" };
        state.damageDealtToPlayerThisTurn = { p1: 3 };
        state.damageRedirections = [
            {
                kind: "prevent-from-source-gain-life",
                sourceInstanceId: "s1",
                playerId: "p1",
                duration: { phase: "end-of-turn" },
            },
        ];
        state.playerPreferences = { p1: { libraryOfLengRouting: "graveyard" } };
        state.landPlayLocked = true;
        state.preventAllCombatDamageThisTurn = true;
        state.combatBlockRestrictions = [
            { attackerId: "atkA", allowedPileLabel: "left" },
        ];
        state.destroyReplacementShields = [
            {
                targetInstanceId: "land1",
                remaining: 1,
                duration: { phase: "end-of-turn" },
            },
        ];
        state.combatDamageImmunity = [
            { instanceId: "atk1", duration: { phase: "end-of-turn" } },
        ];
        state.damageTriggeredLifegain = [
            {
                instanceId: "wall1",
                controllerId: "p1",
                duration: { phase: "end-of-turn" },
            },
        ];
        state.drawLookReplacements = [{ playerId: "p1", x: 3 }];
        state.landManaReplacedToBlueThisTurn = ["p1"];
        state.abilityResolutionCounts = { "src-1:ability-1": 1 };
        state.monarchId = "p1";
        state.monarchReturnWatch = [
            { sourceId: "jailer-1", controllerId: "p1" },
        ];

        const stateKeys = new Set(Object.keys(state));
        const missing = [...stateKeys].filter((k) => !allKnown.has(k));
        expect(
            missing,
            `GameState keys missing from PERSISTED_OPTIONAL_KEYS and TRANSIENT_KEYS`
        ).toEqual([]);
    });
});

// S3: Round-trip smoke tests — one per optional field in PERSISTED_OPTIONAL_KEYS.
// Numeric fields that default to 0 (deathsThisTurn, nextGrantSeq, nextDelayedSeq,
// nextTokenSeq) are tested with non-zero values — compactState's isPlainEmpty
// skips 0 but that's safe because the engine treats missing-as-0.
describe("optional field round-trip smoke tests", () => {
    function roundTrip(state: GameState): GameState {
        return expandState(compactState(state) as Record<string, unknown>);
    }

    it("pendingCast", () => {
        const state = freshState();
        state.pendingCast = {
            playerId: "p1",
            cardInstanceId: "c1",
            manaCost: { R: 1 },
            tappedLandIds: ["l1"],
            keepPriority: true,
        };
        expect(roundTrip(state).pendingCast).toEqual(state.pendingCast);
    });

    it("spellsCastThisGame (issue #790 — lifetime per-player spell tally, never reset)", () => {
        const state = freshState();
        state.players[0].spellsCastThisGame = 3;
        expect(roundTrip(state).players[0].spellsCastThisGame).toBe(3);
        const empty = roundTrip(freshState());
        expect(empty.players[0].spellsCastThisGame).toBeUndefined();
    });

    it("drawLookReplacements (Aladdin's Lamp)", () => {
        const state = freshState();
        state.drawLookReplacements = [{ playerId: "p1", x: 3 }];
        expect(roundTrip(state).drawLookReplacements).toEqual(
            state.drawLookReplacements
        );
    });

    it("expectedInput (ADR 0047 — authoritative Expected Input)", () => {
        const state = freshState();
        // A non-default variant so the round-trip proves the whole shape
        // survives the DB, not just the `priority` default makeState sets.
        state.expectedInput = {
            kind: "choice",
            playerId: "p2",
            stackItemId: "s1",
            choiceId: "p2",
            choiceKind: "may-pay",
        };
        expect(roundTrip(state).expectedInput).toEqual(state.expectedInput);
    });

    it("pendingActivation", () => {
        const state = freshState();
        state.pendingActivation = {
            playerId: "p1",
            cardInstanceId: "c1",
            abilityId: "a1",
            manaCost: { R: 1 },
            tappedLandIds: [],
            tapSource: true,
            sacrificeSource: false,
        };
        expect(roundTrip(state).pendingActivation).toEqual(
            state.pendingActivation
        );
    });

    it("pendingTarget", () => {
        const state = freshState();
        state.pendingTarget = {
            playerId: "p1",
            cardInstanceId: "c1",
            targetType: "Creature",
            count: 1,
            selected: [{ type: "permanent", id: "t1" }],
        };
        expect(roundTrip(state).pendingTarget).toEqual(state.pendingTarget);
    });

    it("pendingChoices", () => {
        const state = freshState();
        state.pendingChoices = [
            {
                stackItemId: "s1",
                step: 0,
                choiceId: "c1",
                playerId: "p1",
                zoneOwnerId: "p1",
                kind: "untap-pick",
                zone: "battlefield",
                count: { min: 0, max: 1 },
                prompt: "test",
            },
        ];
        expect(roundTrip(state).pendingChoices).toEqual(state.pendingChoices);
    });

    it("pendingChoices with a may-pay permanent leg (ADR 0079, #1933)", () => {
        // The `permanent` cost leg and the denormalized `permanentAction` the
        // client's pick prompt reads must both survive the DB round-trip —
        // `pendingChoices` rides the generic optional-key loop as raw JSON, so
        // a nested leg reshape is exactly what could silently drop here.
        const state = freshState();
        state.pendingChoices = [
            {
                stackItemId: "s1",
                step: 0,
                choiceId: "c1",
                playerId: "p1",
                kind: "may-pay",
                zone: "battlefield",
                count: 1,
                prompt: "Return a Forest?",
                cost: {
                    permanent: {
                        action: "return",
                        filter: { subtypes: "Forest" },
                        count: 1,
                    },
                    life: 1,
                },
                permanentAction: "return",
                candidateIds: ["l1", "l2"],
            },
        ];
        expect(roundTrip(state).pendingChoices).toEqual(state.pendingChoices);
    });

    it("pendingChoices with option-pick options (#289)", () => {
        const state = freshState();
        state.pendingChoices = [
            {
                stackItemId: "s1",
                step: 0,
                choiceId: "shapeshifter-entry-number",
                playerId: "p1",
                kind: "option-pick",
                count: 1,
                options: [
                    { id: "0", label: "0/7" },
                    { id: "3", label: "3/4" },
                    { id: "7", label: "7/0" },
                ],
                prompt: "Choose a number between 0 and 7.",
            },
        ];
        expect(roundTrip(state).pendingChoices).toEqual(state.pendingChoices);
    });

    it("pendingChoices with name-card choice (#489, CR 202.3)", () => {
        const state = freshState();
        state.pendingChoices = [
            {
                stackItemId: "sphinx",
                step: 0,
                choiceId: "petra-name",
                playerId: "p1",
                kind: "name-card",
                count: 1,
                prompt: "Name a card.",
                chosenName: "Tundra Wolves",
            },
        ];
        expect(roundTrip(state).pendingChoices).toEqual(state.pendingChoices);
    });

    it("pendingChoices with random-reveal outcome (#301, CR 705 / ADR 0023)", () => {
        const state = freshState();
        state.pendingChoices = [
            {
                stackItemId: "bottle",
                step: 0,
                choiceId: "bottle-of-suleiman-flip",
                playerId: "p1",
                kind: "random-reveal",
                count: 1,
                prompt: "Flip a coin",
                randomKind: "coin",
                sides: 2,
                result: 1,
                realized: {
                    face: "WIN",
                    consequence: "Create a 5/5 flying Djinn",
                },
            },
        ];
        expect(roundTrip(state).pendingChoices).toEqual(state.pendingChoices);
    });

    it("autoPassPlayers", () => {
        const state = freshState();
        state.autoPassPlayers = ["p1", "p2"];
        expect(roundTrip(state).autoPassPlayers).toEqual(["p1", "p2"]);
    });

    it("singleShotAutoPass", () => {
        const state = freshState();
        state.singleShotAutoPass = "p1";
        expect(roundTrip(state).singleShotAutoPass).toBe("p1");
    });

    it("queuedEndTurn", () => {
        const state = freshState();
        state.queuedEndTurn = ["p1", "p2"];
        expect(roundTrip(state).queuedEndTurn).toEqual(["p1", "p2"]);
    });

    it("combat", () => {
        const state = freshState();
        state.combat = {
            attackerIds: ["a1"],
            confirmed: true,
            blockerAssignments: { b1: ["a1"] },
            blockersConfirmed: true,
        };
        expect(roundTrip(state).combat).toEqual(state.combat);
    });

    it("combat.blockedAttackerIds (CR 509.1h, issue #172)", () => {
        const state = freshState();
        state.combat = {
            attackerIds: ["a1", "a2"],
            confirmed: true,
            blockerAssignments: { b1: ["a1"] },
            blockedAttackerIds: ["a1"],
            blockersConfirmed: true,
        };
        expect(roundTrip(state).combat?.blockedAttackerIds).toEqual(["a1"]);
    });

    it("nextGrantSeq", () => {
        const state = freshState();
        state.nextGrantSeq = 5;
        expect(roundTrip(state).nextGrantSeq).toBe(5);
    });

    it("mulligan", () => {
        const state = freshState();
        state.mulligan = {
            mulligansTaken: [1, 0],
            declarations: ["keep", null],
            locked: [true, false],
            declaringPlayerId: "p2",
            bottoming: false,
        };
        expect(roundTrip(state).mulligan).toEqual(state.mulligan);
    });

    it("gameOver", () => {
        const state = freshState();
        state.gameOver = { winnerId: "p1", loserId: "p2", reason: "decked" };
        expect(roundTrip(state).gameOver).toEqual(state.gameOver);
    });

    it("extraTurns", () => {
        const state = freshState();
        state.extraTurns = ["p1", "p2"];
        expect(roundTrip(state).extraTurns).toEqual(["p1", "p2"]);
    });

    it("preventionEffects", () => {
        const state = freshState();
        state.preventionEffects = [
            {
                sourceInstanceId: "s1",
                playerId: "p1",
                duration: { phase: "end-of-turn" },
            },
        ];
        expect(roundTrip(state).preventionEffects).toEqual(
            state.preventionEffects
        );
    });

    it("targetPreventionShields", () => {
        const state = freshState();
        state.targetPreventionShields = [
            {
                targetType: "permanent",
                targetId: "c1",
                remaining: 3,
                duration: { phase: "end-of-turn" },
            },
        ];
        expect(roundTrip(state).targetPreventionShields).toEqual(
            state.targetPreventionShields
        );
    });

    it("preventionTallies (Sacred Boon readback)", () => {
        const state = freshState();
        state.targetPreventionShields = [
            {
                targetType: "permanent",
                targetId: "c1",
                remaining: 1,
                duration: { phase: "end-of-turn" },
                tallyId: "sacred-boon-1",
            },
        ];
        state.preventionTallies = { "sacred-boon-1": 2 };
        const rt = roundTrip(state);
        expect(rt.preventionTallies).toEqual({ "sacred-boon-1": 2 });
        expect(rt.targetPreventionShields).toEqual(
            state.targetPreventionShields
        );
    });

    it("playerDamagePrevention (Dark Sphere / Scarecrow shields)", () => {
        const state = freshState();
        state.playerDamagePrevention = [
            {
                playerId: "p1",
                match: { sourceInstanceId: "threat" },
                mode: "half-down",
                remaining: 1,
                duration: { phase: "end-of-turn" },
            },
            {
                playerId: "p2",
                match: { sourceStaticAbility: "flying" },
                mode: "all",
                remaining: 999,
                duration: { phase: "end-of-turn" },
            },
        ];
        expect(roundTrip(state).playerDamagePrevention).toEqual(
            state.playerDamagePrevention
        );
    });

    it("delayedTriggers", () => {
        const state = freshState();
        state.delayedTriggers = [
            {
                id: "dt-1",
                sourceCardId: "src-1",
                triggerId: "trig-1",
                controller: "p1",
                timing: "next-end-step",
                payload: { targetId: "p2" },
            },
            {
                id: "dt-2",
                sourceCardId: "nafs-asp",
                triggerId: "nafs-asp-draw-step",
                controller: "p1",
                timing: "next-draw-step",
                payload: { playerId: "p2" },
                targetPlayerId: "p2",
            },
        ];
        expect(roundTrip(state).delayedTriggers).toEqual(state.delayedTriggers);
    });

    it("delayedTriggers — next-upkeep timing (#660)", () => {
        const state = freshState();
        state.delayedTriggers = [
            {
                id: "dt-upkeep-1",
                sourceCardId: "blessed-wine",
                triggerId: "next-upkeep-cantrip",
                controller: "p1",
                timing: "next-upkeep",
                payload: {},
            },
        ];
        expect(roundTrip(state).delayedTriggers).toEqual(state.delayedTriggers);
    });

    it("delayedTriggers — inline Effect Script body + oracle text (ADR 0048, CR 603.7a)", () => {
        const state = freshState();
        state.delayedTriggers = [
            {
                id: "dt-inline-1",
                sourceCardId: "rocket-launcher",
                triggerId: "$inline-effects",
                controller: "p1",
                timing: "next-end-step",
                payload: { $self: "launcher-3" },
                effects: [{ op: "destroy", target: { ref: "$self" } }],
                oracleText:
                    "Destroy Rocket Launcher at the beginning of the next end step.",
            },
        ];
        expect(roundTrip(state).delayedTriggers).toEqual(state.delayedTriggers);
    });

    it("delayedTriggers — list-valued (string[]) capture payload (ADR 0049, issue #866)", () => {
        // A list-valued capture (Venomous Breath) freezes N partner ids into
        // the payload as a `string[]`; the value must survive the DB round-trip
        // byte-for-byte so a save/load mid-combat reloads the frozen set (the
        // body's forEach re-iterates the identical members on the wire).
        const state = freshState();
        state.delayedTriggers = [
            {
                id: "dt-list-1",
                sourceCardId: "venomous-breath",
                triggerId: "$inline-effects",
                controller: "p1",
                timing: "next-end-of-combat",
                payload: { $partners: ["blkA", "blkB", "blkC"] },
                effects: [
                    {
                        op: "forEach",
                        select: { set: "bound", ref: "$partners" },
                        effects: [{ op: "destroy", target: { ref: "$each" } }],
                    },
                ],
                oracleText:
                    "Destroy all creatures that blocked or were blocked by it.",
            },
        ];
        expect(roundTrip(state).delayedTriggers).toEqual(state.delayedTriggers);
    });

    it("delayedTriggers — instance leave-watch (watchInstanceId, CR 603.7a, issue #731)", () => {
        // A `leaves-battlefield` delayed trigger keys its firing to one watched
        // instance via `watchInstanceId`; that field must survive the DB
        // round-trip so a save/load mid-turn reloads the pending watch (else
        // the guard would never be sacrificed on the watched creature's
        // departure — a silent field loss).
        const state = freshState();
        state.delayedTriggers = [
            {
                id: "dt-leave-1",
                sourceCardId: "kjeldoran-elite-guard",
                triggerId: "$inline-effects",
                controller: "p1",
                timing: "leaves-battlefield",
                watchInstanceId: "target1",
                // Payload keys drop the `$` binding sigil (Convex reserves a
                // leading `$` on field names); the ref VALUE keeps it.
                payload: { guard: "guard1" },
                effects: [{ op: "sacrifice", target: { ref: "$guard" } }],
                oracleText:
                    "When that creature leaves the battlefield this turn, sacrifice Kjeldoran Elite Guard.",
            },
        ];
        expect(roundTrip(state).delayedTriggers).toEqual(state.delayedTriggers);
    });

    it("nextDelayedSeq", () => {
        const state = freshState();
        state.nextDelayedSeq = 3;
        expect(roundTrip(state).nextDelayedSeq).toBe(3);
    });

    it("nextTokenSeq", () => {
        const state = freshState();
        state.nextTokenSeq = 7;
        expect(roundTrip(state).nextTokenSeq).toBe(7);
    });

    it("nextWorldSeq (CR 704.5m world-rule timestamp counter)", () => {
        const state = freshState();
        state.nextWorldSeq = 4;
        expect(roundTrip(state).nextWorldSeq).toBe(4);
    });

    it("pendingEvents", () => {
        const state = freshState();
        state.pendingEvents = [
            {
                type: "CREATURE_DIED",
                creatureInstanceId: "c1",
                creatureControllerId: "p1",
                creatureTypes: ["Creature"],
                damagedBySources: [],
                creaturePower: 2,
                creatureToughness: 2,
                combatPartnerIds: ["c2"],
            },
        ];
        expect(roundTrip(state).pendingEvents).toEqual(state.pendingEvents);
    });

    it("deathsThisTurn", () => {
        const state = freshState();
        state.deathsThisTurn = 2;
        expect(roundTrip(state).deathsThisTurn).toBe(2);
    });

    // CR 119.3 per-turn life-gain tally (issue #1457) — "if you gained life
    // this turn" is read at any later stable point in the SAME turn, so the
    // map must survive the DB round-trip intact.
    it("lifeGainedThisTurn", () => {
        const state = freshState();
        state.lifeGainedThisTurn = { p1: 7, p2: 3 };
        expect(roundTrip(state).lifeGainedThisTurn).toEqual({ p1: 7, p2: 3 });
    });

    it("pendingUntapStep", () => {
        const state = freshState();
        state.pendingUntapStep = { restrictionCursor: 4 };
        expect(roundTrip(state).pendingUntapStep).toEqual({
            restrictionCursor: 4,
        });
    });

    it("pendingCleanupDiscard (CR 514.1)", () => {
        const state = freshState();
        state.pendingCleanupDiscard = { playerId: "p2" };
        expect(roundTrip(state).pendingCleanupDiscard).toEqual({
            playerId: "p2",
        });
    });

    it("pendingExtraCleanupStep (CR 514.3a)", () => {
        const state = freshState();
        state.pendingExtraCleanupStep = true;
        expect(roundTrip(state).pendingExtraCleanupStep).toBe(true);
    });

    it("maxHandSizeOverride on PlayerState (CR 402.2)", () => {
        const state = freshState();
        state.players[0].maxHandSizeOverride = "unlimited";
        state.players[1].maxHandSizeOverride = 10;
        const got = roundTrip(state);
        expect(got.players[0].maxHandSizeOverride).toBe("unlimited");
        expect(got.players[1].maxHandSizeOverride).toBe(10);
    });

    it("poisonCounters on PlayerState (CR 122)", () => {
        const state = freshState();
        state.players[1].poisonCounters = 9;
        const got = roundTrip(state);
        expect(got.players[0].poisonCounters).toBeUndefined();
        expect(got.players[1].poisonCounters).toBe(9);
    });

    it("Arboria qualifying-action history on PlayerState (CR 508.1c)", () => {
        const state = freshState();
        state.players[0].qualifyingActionThisTurn = true;
        state.players[1].qualifyingActionLastTurn = true;
        const got = roundTrip(state);
        expect(got.players[0].qualifyingActionThisTurn).toBe(true);
        expect(got.players[0].qualifyingActionLastTurn).toBeUndefined();
        expect(got.players[1].qualifyingActionLastTurn).toBe(true);
        expect(got.players[1].qualifyingActionThisTurn).toBeUndefined();
    });

    it("lastDrawnCardId on PlayerState (Jandor's Ring discard cost)", () => {
        const state = freshState();
        state.players[0].lastDrawnCardId = "drawn-instance-id";
        const got = roundTrip(state);
        expect(got.players[0].lastDrawnCardId).toBe("drawn-instance-id");
        expect(got.players[1].lastDrawnCardId).toBeUndefined();
    });

    it("damageDealtToPlayerThisTurn", () => {
        const state = freshState();
        state.damageDealtToPlayerThisTurn = { p1: 5, p2: 3 };
        expect(roundTrip(state).damageDealtToPlayerThisTurn).toEqual({
            p1: 5,
            p2: 3,
        });
    });

    it("artifactDamageToPlayerThisTurn", () => {
        const state = freshState();
        state.artifactDamageToPlayerThisTurn = { p1: 4, p2: 2 };
        expect(roundTrip(state).artifactDamageToPlayerThisTurn).toEqual({
            p1: 4,
            p2: 2,
        });
    });

    it("damageRedirections", () => {
        const state = freshState();
        state.damageRedirections = [
            {
                kind: "prevent-from-source-gain-life",
                sourceInstanceId: "s1",
                playerId: "p1",
                duration: { phase: "end-of-turn" },
            },
        ];
        expect(roundTrip(state).damageRedirections).toEqual(
            state.damageRedirections
        );
    });

    it("damageRedirections — from-source-to-permanent-redirect with a PERMANENT destination (Mirrorwood Treefolk, issue #1939)", () => {
        const state = freshState();
        state.damageRedirections = [
            {
                kind: "from-source-to-permanent-redirect",
                targetInstanceId: "mwt1",
                redirectTo: { type: "permanent", id: "bear1" },
                remaining: 1,
                duration: { phase: "end-of-turn" },
            },
        ];
        expect(roundTrip(state).damageRedirections).toEqual(
            state.damageRedirections
        );
    });

    it("destroyReplacementShields", () => {
        const state = freshState();
        state.destroyReplacementShields = [
            {
                targetInstanceId: "land1",
                remaining: 1,
                duration: { phase: "end-of-turn" },
            },
        ];
        expect(roundTrip(state).destroyReplacementShields).toEqual(
            state.destroyReplacementShields
        );
    });

    it("graveyardBoundRedirectThisTurn (issue #1145 — Yawgmoth's Will)", () => {
        const state = freshState();
        state.graveyardBoundRedirectThisTurn = [
            { ownerId: "p1", tagCounters: { void: 1 } },
        ];
        expect(roundTrip(state).graveyardBoundRedirectThisTurn).toEqual(
            state.graveyardBoundRedirectThisTurn
        );
    });

    it("graveyardPlayPermissionThisTurn (issue #1149 — Yawgmoth's Will)", () => {
        const state = freshState();
        state.graveyardPlayPermissionThisTurn = [
            {
                playerId: "p1",
                zones: ["land", "spell"],
                maxManaValue: undefined,
            },
        ];
        expect(roundTrip(state).graveyardPlayPermissionThisTurn).toEqual(
            state.graveyardPlayPermissionThisTurn
        );
    });

    it("graveyardPermanentCastUsedThisTurn (issue #1392 — Lurrus of the Dream-Den)", () => {
        const state = freshState();
        state.graveyardPermanentCastUsedThisTurn = ["p1", "p2"];
        expect(roundTrip(state).graveyardPermanentCastUsedThisTurn).toEqual(
            state.graveyardPermanentCastUsedThisTurn
        );
    });

    it("combatDamageImmunity", () => {
        const state = freshState();
        state.combatDamageImmunity = [
            { instanceId: "atk1", duration: { phase: "end-of-turn" } },
        ];
        expect(roundTrip(state).combatDamageImmunity).toEqual(
            state.combatDamageImmunity
        );
    });

    it("damageTriggeredLifegain", () => {
        const state = freshState();
        state.damageTriggeredLifegain = [
            {
                instanceId: "wall1",
                controllerId: "p1",
                duration: { phase: "end-of-turn" },
            },
        ];
        expect(roundTrip(state).damageTriggeredLifegain).toEqual(
            state.damageTriggeredLifegain
        );
    });

    it("playerPreferences", () => {
        const state = freshState();
        state.playerPreferences = { p1: { libraryOfLengRouting: "graveyard" } };
        expect(roundTrip(state).playerPreferences).toEqual(
            state.playerPreferences
        );
    });

    it("nextInstanceId", () => {
        const state = freshState();
        state.nextInstanceId = 42;
        expect(roundTrip(state).nextInstanceId).toBe(42);
    });

    it("preventAllCombatDamageThisTurn", () => {
        const state = freshState();
        state.preventAllCombatDamageThisTurn = true;
        expect(roundTrip(state).preventAllCombatDamageThisTurn).toBe(true);
    });

    it("sourcePreventionShields (CR 615 / 510.1c — Farrel's Mantle, Falling Timber, Radiant Kavu)", () => {
        const state = freshState();
        // A representative NON-EMPTY value exercising every arm of the shield
        // shape: an id-scoped combat-only entry (Farrel's Mantle / Falling
        // Timber), a filter-scoped combat-only entry (Radiant Kavu) and an
        // id-scoped ALL-damage entry (Rith's Charm).
        state.sourcePreventionShields = [
            { sourceIds: ["inst-a", "inst-b"], combatOnly: true },
            {
                match: { colors: ["U", "B"], cardType: "Creature" },
                combatOnly: true,
            },
            { sourceIds: ["inst-c"] },
        ];
        expect(roundTrip(state).sourcePreventionShields).toEqual([
            { sourceIds: ["inst-a", "inst-b"], combatOnly: true },
            {
                match: { colors: ["U", "B"], cardType: "Creature" },
                combatOnly: true,
            },
            { sourceIds: ["inst-c"] },
        ]);
    });

    it("cannotCastSpellsThisTurn (Xantid Swarm, CR 601.3a / 514.2)", () => {
        const state = freshState();
        state.cannotCastSpellsThisTurn = [
            { playerId: "p2", cardTypes: ["Instant", "Sorcery"] },
        ];
        expect(roundTrip(state).cannotCastSpellsThisTurn).toEqual([
            { playerId: "p2", cardTypes: ["Instant", "Sorcery"] },
        ]);
    });

    it("cannotActivateAbilitiesThisTurn (Abeyance, CR 602.1 / 514.2, issue #1124)", () => {
        const state = freshState();
        state.cannotActivateAbilitiesThisTurn = ["p2"];
        expect(roundTrip(state).cannotActivateAbilitiesThisTurn).toEqual([
            "p2",
        ]);
    });

    it("skipDrawStepThisTurn (Elfhame Sanctuary, CR 504.1, issue #1097)", () => {
        const state = freshState();
        state.skipDrawStepThisTurn = ["p1"];
        expect(roundTrip(state).skipDrawStepThisTurn).toEqual(["p1"]);
    });

    it("creatureAttackedThisTurn (Keldon Twilight, CR 506.3 / 603.4, issue #1944)", () => {
        const state = freshState();
        state.creatureAttackedThisTurn = true;
        expect(roundTrip(state).creatureAttackedThisTurn).toBe(true);
    });

    it("controlChangedThisTurn (control continuity, issue #1944)", () => {
        const state = freshState();
        state.controlChangedThisTurn = ["stolen-1", "stolen-2"];
        expect(roundTrip(state).controlChangedThisTurn).toEqual([
            "stolen-1",
            "stolen-2",
        ]);
    });

    it("combatDamageRedirectToPermanent (Kjeldoran Royal Guard, CR 614.6)", () => {
        const state = freshState();
        state.combatDamageRedirectToPermanent = [
            { playerId: "p2", toPermanentId: "guard" },
        ];
        expect(roundTrip(state).combatDamageRedirectToPermanent).toEqual([
            { playerId: "p2", toPermanentId: "guard" },
        ]);
    });

    it("gazeOfPainActiveThisTurn (Gaze of Pain, CR 603.7a)", () => {
        const state = freshState();
        state.gazeOfPainActiveThisTurn = ["p1"];
        expect(roundTrip(state).gazeOfPainActiveThisTurn).toEqual(["p1"]);
    });

    it("landManaReplacedToBlueThisTurn (Deep Water)", () => {
        const state = freshState();
        state.landManaReplacedToBlueThisTurn = ["p1"];
        expect(roundTrip(state).landManaReplacedToBlueThisTurn).toEqual(["p1"]);
    });

    it("highTideThisTurn (FEM High Tide — additive, stacks)", () => {
        const state = freshState();
        // Two High Tides → two entries (each contributes one extra {U}).
        state.highTideThisTurn = ["p1", "p1"];
        expect(roundTrip(state).highTideThisTurn).toEqual(["p1", "p1"]);
    });

    it("landManaRidersThisTurn (Chaos Moon — parametrized riders)", () => {
        const state = freshState();
        state.landManaRidersThisTurn = [
            { subtype: "Mountain", color: "R", mode: "additional" },
            { subtype: "Mountain", color: "C", mode: "override" },
        ];
        expect(roundTrip(state).landManaRidersThisTurn).toEqual([
            { subtype: "Mountain", color: "R", mode: "additional" },
            { subtype: "Mountain", color: "C", mode: "override" },
        ]);
    });

    it("landPlayLocked (Worms of the Earth)", () => {
        const state = freshState();
        state.landPlayLocked = true;
        expect(roundTrip(state).landPlayLocked).toBe(true);
    });

    it("abilityResolutionCounts (issue #1189 — Omnath / Scythecat Cub escalating tallies)", () => {
        const state = freshState();
        // Two independent keys — a different source AND a different ability
        // on the same source both get their own entry.
        state.abilityResolutionCounts = {
            "omnath-1:omnath-landfall": 2,
            "omnath-1:omnath-etb": 1,
        };
        expect(roundTrip(state).abilityResolutionCounts).toEqual({
            "omnath-1:omnath-landfall": 2,
            "omnath-1:omnath-etb": 1,
        });
    });
});

describe("backward compatibility", () => {
    it("expands an old-format blob with deck field and UUID instance IDs", () => {
        const state = freshState();
        const compact = compactState(state) as Record<string, unknown>;
        // Simulate old format: inject deck into each player
        const players = compact.players as Array<Record<string, unknown>>;
        players[0].deck = {
            id: "preset-1",
            name: "Test Deck",
            format: "standard",
            cards: [],
        };
        players[1].deck = {
            id: "preset-2",
            name: "Test Deck 2",
            format: "standard",
            cards: [],
        };
        // Simulate old UUID-style instance IDs in library tuples
        const lib = players[0].library as Array<[string, string]>;
        if (lib.length > 0) {
            lib[0] = ["550e8400-e29b-41d4-a716-446655440000", lib[0][1]];
        }
        const expanded = expandState(compact);
        // deck should not appear on PlayerState
        expect("deck" in expanded.players[0]).toBe(false);
        // UUID-style ID should still work (it's a valid string)
        if (expanded.players[0].library.length > 0) {
            expect(expanded.players[0].library[0].id).toBe(
                "550e8400-e29b-41d4-a716-446655440000"
            );
        }
    });

    it("expands a pre-tuple library where entries are compact-card objects (legacy v1: no `v` field, raw-string card.id)", () => {
        const state = freshState();
        const rawLib = state.players[0].library;
        const expectedCardId = rawLib[0].card.id;

        // issue #1780 — hand-build the REAL pre-tuple legacy shape: no `v`
        // field, no `cardPool`, no `tokenSpecs`, and `card.id` is the raw
        // string everywhere — exactly what `compactState` used to emit
        // before this change. A v2 envelope (`v: 2` + `cardPool`) wrapping an
        // object-shaped library entry is a hybrid `compactState` can never
        // produce and no production row can ever contain, so it must not
        // appear in this fixture (mirrors the "still expands a legacy v1
        // row" fixture below).
        const legacy = {
            players: state.players.map((p, i) => ({
                id: p.id,
                name: p.name,
                bgColor: p.bgColor,
                life: p.life,
                hand: [],
                // Simulate old format: the first entry of p1's library stored
                // as an object (not a tuple) with a raw-string `card.id`; the
                // rest as legacy `[instanceId, rawCardId]` tuples.
                library:
                    i === 0
                        ? [
                              {
                                  id: rawLib[0].id,
                                  card: { id: expectedCardId },
                              },
                              ...rawLib
                                  .slice(1)
                                  .map((c) => [c.id, c.card.id] as const),
                          ]
                        : p.library.map((c) => [c.id, c.card.id] as const),
                graveyard: [],
                exile: [],
                battlefield: [],
                manaPool: {},
            })),
            stack: [],
            turn: state.turn,
            activePlayerId: state.activePlayerId,
            priorityPlayerId: state.priorityPlayerId,
            passCount: state.passCount,
            phase: state.phase,
            rngSeed: state.rngSeed,
            rngCounter: state.rngCounter,
        };

        const expanded = expandState(
            legacy as unknown as Record<string, unknown>
        );
        const first = expanded.players[0].library[0];
        expect(first.id).toBe(rawLib[0].id);
        expect(first.card.id).toBe(expectedCardId);
        expect(first.zone).toBe("library");
        expect(first.ownerId).toBe(expanded.players[0].id);
    });
});

describe("blob size regression guard", () => {
    it("compact form is under 5 KB for a representative game state", () => {
        const state = freshState();
        const compactSize = JSON.stringify(compactState(state)).length;
        expect(compactSize).toBeLessThan(5000);
    });
});

// Issue #1780 (T5, PRD #1776) — token spec interning + cardId string table.
// Both live entirely at the compact-form boundary: `GameState` itself never
// gains a `tokenSpecs`/`cardPool` field (no schema-drift-guard entry needed),
// and `expandState` hands back byte-identical `card.id` strings either way.
describe("token spec interning + cardId string table (issue #1780)", () => {
    const clueSpec: TokenSpec = {
        name: "Clue",
        types: ["Artifact"],
        subtypes: ["Clue"],
        staticAbilities: [],
    };
    const clueId = tokenDefinitionId(clueSpec);

    it("writes v2 with a cardPool and interns a repeated token spec once", () => {
        const state = freshState();
        const clue1 = makeInstance(clueId, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isToken: true,
        });
        const clue2 = makeInstance(clueId, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isToken: true,
        });
        state.players[0].battlefield.push(clue1, clue2);

        const compact = compactState(state) as Record<string, unknown>;
        expect(compact.v).toBe(2);
        expect(Array.isArray(compact.cardPool)).toBe(true);

        const tokenSpecs = compact.tokenSpecs as Record<string, string>;
        expect(tokenSpecs).toBeDefined();
        // Both Clue instances share exactly ONE interned entry.
        const entries = Object.values(tokenSpecs);
        expect(entries).toEqual([clueId]);

        // The raw (long) spec string appears exactly once in the whole
        // document — inside tokenSpecs — never repeated per instance.
        const compactJson = JSON.stringify(compact);
        const occurrences = compactJson.split(clueId).length - 1;
        expect(occurrences).toBe(1);
    });

    it("round-trips a token-heavy battlefield exactly (5 duplicate tokens across 2 zones)", () => {
        const state = freshState();
        const battlefieldClues = Array.from({ length: 3 }, () =>
            makeInstance(clueId, {
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
                isToken: true,
            })
        );
        const graveyardClues = Array.from({ length: 2 }, () =>
            makeInstance(clueId, {
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
                isToken: true,
            })
        );
        state.players[0].battlefield.push(...battlefieldClues);
        state.players[0].graveyard.push(...graveyardClues);

        const rawSize = JSON.stringify(state).length;
        const compact = compactState(state) as Record<string, unknown>;
        const compactSize = JSON.stringify(compact).length;
        expect(compactSize).toBeLessThan(rawSize * 0.5);

        const expanded = expandState(compact);
        expect(expanded).toEqual(state);
    });

    it("round-trips a 60-card library of the same card exactly and shrinks materially", () => {
        const state = freshState();
        const bigLibrary = Array.from({ length: 60 }, () =>
            makeInstance(mountain.id, { controllerId: "p2", zone: "library" })
        );
        state.players[1].library = bigLibrary;

        const rawSize = JSON.stringify(state).length;
        const compact = compactState(state) as Record<string, unknown>;
        const compactSize = JSON.stringify(compact).length;
        expect(compactSize).toBeLessThan(rawSize * 0.5);

        // The 36-char Scryfall id string appears exactly once — in cardPool
        // — never once per copy.
        const occurrences =
            JSON.stringify(compact).split(mountain.id).length - 1;
        expect(occurrences).toBe(1);

        expect(expandState(compact)).toEqual(state);
    });

    it("still expands a legacy v1 row (no `v` field, raw string card ids, no cardPool)", () => {
        const state = freshState();
        const clue = makeInstance(clueId, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isToken: true,
        });
        state.players[0].battlefield.push(clue);

        // Hand-build the pre-#1780 shape: exactly what `compactState` used
        // to emit — `card.id` is the raw string everywhere, no `v`, no
        // `cardPool`, no `tokenSpecs`.
        const legacy = {
            players: state.players.map((p) => ({
                id: p.id,
                name: p.name,
                bgColor: p.bgColor,
                life: p.life,
                hand: [],
                library: p.library.map((c) => [c.id, c.card.id] as const),
                graveyard: [],
                exile: [],
                battlefield: p.battlefield.map((c) => ({
                    id: c.id,
                    card: { id: c.card.id },
                    ownerId: c.ownerId,
                    isToken: c.isToken || undefined,
                })),
                manaPool: {},
            })),
            stack: [],
            turn: state.turn,
            activePlayerId: state.activePlayerId,
            priorityPlayerId: state.priorityPlayerId,
            passCount: state.passCount,
            phase: state.phase,
            rngSeed: state.rngSeed,
            rngCounter: state.rngCounter,
        };

        const expanded = expandState(
            legacy as unknown as Record<string, unknown>
        );
        const found = expanded.players[0].battlefield.find(
            (c) => c.id === clue.id
        );
        expect(found).toBeDefined();
        expect(found?.card.id).toBe(clueId);
        expect(found?.isToken).toBe(true);
    });

    it("wire format: projectPublicState is unchanged by the v2 round-trip", () => {
        const state = freshState();
        const clue = makeInstance(clueId, {
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
            isToken: true,
        });
        state.players[1].battlefield.push(clue);

        const directProjection = projectPublicState(state, 1, "p1");
        const roundTripped = expandState(
            compactState(state) as Record<string, unknown>
        );
        const roundTrippedProjection = projectPublicState(
            roundTripped,
            1,
            "p1"
        );
        expect(roundTrippedProjection).toEqual(directProjection);
    });
});
