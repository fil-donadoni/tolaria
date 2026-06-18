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
    lightningBolt,
    mountain,
    plains,
    savannahLions,
} from "../../cards/sets/lea";

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
        const expanded = expandState(compactState(state));
        const got = expanded.players[1].battlefield[0];
        expect(got.isTapped).toBe(true);
        expect(got.isSummoningSick).toBe(true);
        expect(got.damageMarked).toBe(1);
        expect(got.counters).toEqual({ "+1/+1": 2 });
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
        lion.manaCommitted = true;
        lion.damageMarked = 2;
        lion.regenerationShields = 1;
        lion.chosenMana = { R: 1, G: 1 };
        lion.attachedTo = "host-id";
        lion.temporaryPTMods = [
            { power: 1, toughness: 0, duration: { phase: "end-of-turn" } },
        ];
        lion.temporaryPTSet = [
            { power: 0, duration: { phase: "end-of-turn" } },
            { power: 0, toughness: 2, duration: { phase: "end-of-turn" } },
        ];
        lion.sourceTappedPTMods = [
            { power: 2, toughness: -2, sourceId: "gear-1" },
        ];
        lion.untapLockedBy = ["gremlin-1"];
        lion.counters = { "+1/+1": 1, "+1/+0": 2 };
        lion.grantedStaticAbilities = [{ ability: "flying", auraId: "aura-1" }];
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
        lion.mustAttackThisTurn = true;
        lion.colorOverride = ["R"];
        lion.textChanges = [
            { kind: "land-type", from: "Forest", to: "Island" },
        ];
        lion.pileLabel = "left";
        lion.mustBlockAllThisTurn = true;
        lion.cantBlockThisTurn = true;
        lion.copiedFrom = "printed-clone-id";
        // CR 613.1f — "loses all abilities" suppression source list
        // (Titania's Song, #288).
        lion.abilitiesSuppressedBy = ["song-1", "song-2"];

        const expanded = expandState(compactState(state));
        const got = expanded.players[1].battlefield[0];
        expect(got.isTapped).toBe(true);
        expect(got.isToken).toBe(true);
        expect(got.isSummoningSick).toBe(true);
        expect(got.isAttacking).toBe(true);
        expect(got.isBlocking).toBe(true);
        expect(got.hasAttackedThisTurn).toBe(true);
        expect(got.hasBlockedThisTurn).toBe(true);
        expect(got.manaCommitted).toBe(true);
        expect(got.damageMarked).toBe(2);
        expect(got.regenerationShields).toBe(1);
        expect(got.chosenMana).toEqual({ R: 1, G: 1 });
        expect(got.attachedTo).toBe("host-id");
        expect(got.temporaryPTMods).toEqual([
            { power: 1, toughness: 0, duration: { phase: "end-of-turn" } },
        ]);
        expect(got.temporaryPTSet).toEqual([
            { power: 0, duration: { phase: "end-of-turn" } },
            { power: 0, toughness: 2, duration: { phase: "end-of-turn" } },
        ]);
        expect(got.sourceTappedPTMods).toEqual([
            { power: 2, toughness: -2, sourceId: "gear-1" },
        ]);
        expect(got.untapLockedBy).toEqual(["gremlin-1"]);
        expect(got.counters).toEqual({ "+1/+1": 1, "+1/+0": 2 });
        expect(got.grantedStaticAbilities).toEqual([
            { ability: "flying", auraId: "aura-1" },
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
        expect(got.copiedFrom).toBe("printed-clone-id");
        expect(got.abilitiesSuppressedBy).toEqual(["song-1", "song-2"]);
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
        state.drawLookReplacements = [{ playerId: "p1", x: 3 }];

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

    it("drawLookReplacements (Aladdin's Lamp)", () => {
        const state = freshState();
        state.drawLookReplacements = [{ playerId: "p1", x: 3 }];
        expect(roundTrip(state).drawLookReplacements).toEqual(
            state.drawLookReplacements
        );
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

    it("maxHandSizeOverride on PlayerState (CR 402.2)", () => {
        const state = freshState();
        state.players[0].maxHandSizeOverride = "unlimited";
        state.players[1].maxHandSizeOverride = 10;
        const got = roundTrip(state);
        expect(got.players[0].maxHandSizeOverride).toBe("unlimited");
        expect(got.players[1].maxHandSizeOverride).toBe(10);
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

    it("combatDamageImmunity", () => {
        const state = freshState();
        state.combatDamageImmunity = [
            { instanceId: "atk1", duration: { phase: "end-of-turn" } },
        ];
        expect(roundTrip(state).combatDamageImmunity).toEqual(
            state.combatDamageImmunity
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

    it("expands a pre-tuple library where entries are compact-card objects", () => {
        const state = freshState();
        const compact = compactState(state) as Record<string, unknown>;
        const players = compact.players as Array<Record<string, unknown>>;
        const lib = players[0].library as Array<[string, string]>;
        const [id, cardId] = lib[0];
        // Simulate old format: library entry stored as an object, not a tuple.
        players[0].library = [
            { id, card: { id: cardId } },
            ...lib.slice(1),
        ] as unknown[];
        const expanded = expandState(compact);
        const first = expanded.players[0].library[0];
        expect(first.id).toBe(id);
        expect(first.card.id).toBe(cardId);
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
