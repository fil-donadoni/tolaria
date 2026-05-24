import { describe, expect, it } from "vitest";
import { compactState, expandState } from "../serialize";
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
    winterOrb,
} from "../../cards/sets/lea";
import { untapStep } from "../phases";

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
        lion.counters = { "+1/+1": 1, "+1/+0": 2 };
        lion.grantedStaticAbilities = [{ ability: "flying", auraId: "aura-1" }];
        lion.grantedActivatedAbilities = [
            { sourceCardId: "src", abilityId: "ability", auraId: "aura-1" },
        ];
        lion.damagedBySources = ["bolt-1", "bolt-2"];
        lion.controlChanges = [
            { auraId: "aura-1", previousControllerId: "p1" },
        ];

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
        expect(got.counters).toEqual({ "+1/+1": 1, "+1/+0": 2 });
        expect(got.grantedStaticAbilities).toEqual([
            { ability: "flying", auraId: "aura-1" },
        ]);
        expect(got.grantedActivatedAbilities).toEqual([
            { sourceCardId: "src", abilityId: "ability", auraId: "aura-1" },
        ]);
        expect(got.damagedBySources).toEqual(["bolt-1", "bolt-2"]);
        expect(got.controlChanges).toEqual([
            { auraId: "aura-1", previousControllerId: "p1" },
        ]);
    });

    it("compact form is materially smaller than raw JSON", () => {
        const state = freshState();
        const rawSize = JSON.stringify(state).length;
        const compactSize = JSON.stringify(compactState(state)).length;
        expect(compactSize).toBeLessThan(rawSize * 0.7);
    });

    it("pendingUntapStep survives compact → expand round-trip (#32)", () => {
        const state = freshState();
        state.pendingUntapStep = { restrictionCursor: 2 };
        const expanded = expandState(compactState(state));
        expect(expanded.pendingUntapStep).toEqual({ restrictionCursor: 2 });
    });

    it("pendingUntapStep: undefined round-trips as undefined", () => {
        const state = freshState();
        state.pendingUntapStep = undefined;
        const expanded = expandState(compactState(state));
        expect(expanded.pendingUntapStep).toBeUndefined();
    });

    it("compactState and expandState key arrays are symmetric", () => {
        const rich = freshState();
        rich.pendingUntapStep = { restrictionCursor: 1 };
        rich.pendingChoices = [];
        rich.autoPassPlayers = [];
        rich.combat = {
            attackerIds: [],
            confirmed: false,
            blockerAssignments: {},
            blockersConfirmed: false,
            damageAssignments: {},
        };
        const richCompact = compactState(rich);
        const richExpanded = expandState(richCompact);
        // pendingUntapStep must survive.
        expect(richExpanded.pendingUntapStep).toEqual({
            restrictionCursor: 1,
        });
    });
});

describe("pendingUntapStep serialize regression — Winter Orb (#32)", () => {
    it("untap-pick prompt cursor survives compact → expand → re-entry (no duplicate prompt)", () => {
        const orb = makeInstance(winterOrb.id, { id: "orb" });
        const land1 = makeInstance(plains.id, { id: "l1", isTapped: true });
        const land2 = makeInstance(plains.id, { id: "l2", isTapped: true });
        const land3 = makeInstance(plains.id, { id: "l3", isTapped: true });
        const state = makeState({
            phase: "UNTAP",
            players: [
                makePlayer("p1", {
                    battlefield: [orb, land1, land2, land3],
                }),
                makePlayer("p2"),
            ],
        });
        untapStep(state);

        // Step 1: exactly 1 prompt enqueued.
        expect(state.pendingChoices).toHaveLength(1);
        expect(state.pendingChoices![0].kind).toBe("untap-pick");
        expect(state.pendingUntapStep).toEqual({ restrictionCursor: 1 });

        // Step 2: simulate saveGameState → getLatestGameState round-trip.
        const roundTripped = expandState(compactState(state));

        // Cursor must survive.
        expect(roundTripped.pendingUntapStep).toEqual({
            restrictionCursor: 1,
        });

        // Step 3: simulate selectResolutionChoice → finalizeUntapPick.
        // Pick land1, then resume dispatcher.
        const queue = roundTripped.pendingChoices!;
        queue[0].selected.push("l1");
        const chooser = roundTripped.players.find(
            (p) => p.id === queue[0].zoneOwnerId
        )!;
        for (const id of queue[0].selected) {
            const c = chooser.battlefield.find((x) => x.id === id);
            if (c) c.isTapped = false;
        }
        queue.shift();
        roundTripped.pendingChoices = queue.length > 0 ? queue : undefined;
        untapStep(roundTripped);

        // No more prompts — dispatcher finished (cursor was preserved).
        expect(roundTripped.pendingChoices ?? []).toEqual([]);
        expect(roundTripped.pendingUntapStep).toBeUndefined();

        // Only land1 untapped; land2 + land3 still tapped.
        const bf = roundTripped.players[0].battlefield;
        expect(bf.find((c) => c.id === "l1")?.isTapped).toBe(false);
        expect(bf.find((c) => c.id === "l2")?.isTapped).toBe(true);
        expect(bf.find((c) => c.id === "l3")?.isTapped).toBe(true);
    });

    it("skip-untap (empty selection) through serialize round-trip closes prompt immediately", () => {
        const orb = makeInstance(winterOrb.id, { id: "orb" });
        const land1 = makeInstance(plains.id, { id: "l1", isTapped: true });
        const land2 = makeInstance(plains.id, { id: "l2", isTapped: true });
        const state = makeState({
            phase: "UNTAP",
            players: [
                makePlayer("p1", {
                    battlefield: [orb, land1, land2],
                }),
                makePlayer("p2"),
            ],
        });
        untapStep(state);
        expect(state.pendingChoices).toHaveLength(1);

        // Round-trip through serializer.
        const roundTripped = expandState(compactState(state));

        // Skip: empty selection, dequeue, resume dispatcher.
        roundTripped.pendingChoices!.shift();
        roundTripped.pendingChoices =
            (roundTripped.pendingChoices?.length ?? 0) > 0
                ? roundTripped.pendingChoices
                : undefined;
        untapStep(roundTripped);

        // No duplicate prompt (cursor survived → dispatcher skips restriction 0).
        expect(roundTripped.pendingChoices ?? []).toEqual([]);
        // Both lands still tapped (skip = zero untaps).
        const bf = roundTripped.players[0].battlefield;
        expect(bf.find((c) => c.id === "l1")?.isTapped).toBe(true);
        expect(bf.find((c) => c.id === "l2")?.isTapped).toBe(true);
    });
});
