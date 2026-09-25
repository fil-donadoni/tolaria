/**
 * Card Field Lifecycle (issue #4453, PRD #4447): the wire format of a card
 * instance, proven against a fixture STORED BEFORE the lifecycle table
 * replaced the hand-written `compactCard` / `expandCard` branches.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { grizzlyBears } from "../../cards/sets/lea/green";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { finalizeCleanup } from "../phases";
import { compactState, expandState } from "../serialize";
import {
    resetBattlefieldTransientState,
    resetStackTransientState,
} from "../state";
import type { CardInstanceState, GameState, StackItem } from "../state";
import type {
    CardFieldReset,
    CardFieldResetScope,
    OptionalCardInstanceKey,
} from "../state/cardFieldLifecycle";
import {
    CARD_FIELD_KEYS,
    CARD_FIELD_LIFECYCLE,
} from "../state/cardFieldLifecycle";
import { everyRoundTrippableCardField } from "./fixtures/everyOptionalCardField";

const FIXTURE_PATH = fileURLToPath(
    new URL("./fixtures/cardFieldLifecycle.compact.json.txt", import.meta.url)
);

/** A state whose three card seams — a battlefield permanent, a bestowed Aura
 *  and a stack item — each carry every optional field the seam can emit. */
function cardFieldLifecycleFixtureState(): GameState {
    const every = makeInstance(grizzlyBears.id, {
        id: "cf-every",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        ...everyRoundTrippableCardField(),
    });
    // CR 702.103b / 208.3 — a bestowed object is an Aura with no P/T; the
    // marker is the one field the "every field" instance cannot carry.
    const bestowed = makeInstance(grizzlyBears.id, {
        id: "cf-bestowed",
        controllerId: "p2",
        ownerId: "p2",
        zone: "battlefield",
        types: ["Enchantment"],
        subtypes: ["Aura"],
        power: undefined,
        toughness: undefined,
        bestowed: true,
        attachedTo: "cf-every",
    });
    const spell: StackItem = {
        ...makeInstance(grizzlyBears.id, {
            id: "cf-stack",
            controllerId: "p2",
            ownerId: "p1",
            zone: "stack",
            ...everyRoundTrippableCardField(),
        }),
        castById: "p2",
        targets: [],
    };
    const p1 = makePlayer("p1", { battlefield: [every] });
    const p2 = makePlayer("p2", { battlefield: [bestowed] });
    return makeState({ players: [p1, p2], stack: [spell] });
}

describe("Card Field Lifecycle — wire format (issue #4453)", () => {
    // Byte-identical, not deep-equal: key ORDER is part of the stored
    // document, and a table-driven `compactCard` that emitted the same keys in
    // a different order would still be a wire change. Stored as `.json.txt`
    // so no formatter ever reflows it. Regenerate ONLY for a deliberate wire
    // migration: `TOLARIA_WRITE_CARD_FIELD_FIXTURE=1`.
    it("compactState output is byte-identical to the fixture stored before the lifecycle table", () => {
        const got =
            JSON.stringify(
                compactState(cardFieldLifecycleFixtureState()),
                null,
                2
            ) + "\n";
        if (process.env.TOLARIA_WRITE_CARD_FIELD_FIXTURE === "1") {
            writeFileSync(FIXTURE_PATH, got);
        }
        expect(got).toBe(readFileSync(FIXTURE_PATH, "utf8"));
    });
});

describe("Card Field Lifecycle — round trip (issue #4453)", () => {
    // Through JSON on purpose: the in-memory `expandState(compactState(s))`
    // keeps an explicit `undefined` alive, a real `gameStates` row does not
    // (`docs/findings/2388-expandcard-restores-printed-pt-over-a-cleared-one.md`).
    function wireRoundTrip(state: GameState): GameState {
        return expandState(
            JSON.parse(JSON.stringify(compactState(state))) as Record<
                string,
                unknown
            >
        );
    }

    function pickTable(card: CardInstanceState): Record<string, unknown> {
        const picked: Record<string, unknown> = {};
        for (const key of CARD_FIELD_KEYS) {
            if (card[key] !== undefined) picked[key] = card[key];
        }
        return picked;
    }

    it("a battlefield permanent carrying every optional field expands deep-equal to its input", () => {
        const state = cardFieldLifecycleFixtureState();
        const input = state.players[0].battlefield[0];
        const got = wireRoundTrip(state).players[0].battlefield[0];
        expect(pickTable(got)).toEqual(pickTable(input));
        expect(got.id).toBe(input.id);
        expect(got.zone).toBe("battlefield");
    });

    it("a stack item carrying every optional field expands deep-equal to its input", () => {
        const state = cardFieldLifecycleFixtureState();
        const input = state.stack[0];
        const got = wireRoundTrip(state).stack[0];
        expect(pickTable(got)).toEqual(pickTable(input));
        expect(got.castById).toBe("p2");
    });

    // CR 702.103b / 208.3 — the one shape the "every field" instance cannot
    // take: a bestowed Aura has no P/T, and the `bestowed` codec re-clears
    // the printed pair the definition fallback would otherwise restore.
    it("a bestowed permanent comes back bestowed and without power/toughness", () => {
        const state = cardFieldLifecycleFixtureState();
        const got = wireRoundTrip(state).players[1].battlefield[0];
        expect(got.bestowed).toBe(true);
        expect(got.power).toBeUndefined();
        expect(got.toughness).toBeUndefined();
        expect(got.attachedTo).toBe("cf-every");
    });

    it("the fixture sets every optional key of the table (so the round trip proves each codec)", () => {
        const every = everyRoundTrippableCardField() as Record<string, unknown>;
        const unset = CARD_FIELD_KEYS.filter(
            (key) => key !== "bestowed" && every[key] === undefined
        );
        expect(unset).toEqual([]);
    });
});

describe("Card Field Lifecycle — reset scopes (issue #4453)", () => {
    /** Every optional field, with the timed records pointed at a boundary the
     *  cleanup step does not tick (`upkeep`), so what survives `finalizeCleanup`
     *  is decided by the table's `reset` column alone. */
    function everyFieldSurvivingDurations(): ReturnType<
        typeof everyRoundTrippableCardField
    > {
        const every = everyRoundTrippableCardField();
        const upkeep = { phase: "upkeep" as const };
        return {
            ...every,
            animation: { ...every.animation, duration: upkeep },
            temporarySubtypeChange: {
                ...every.temporarySubtypeChange,
                duration: upkeep,
            },
            temporaryColorOverride: {
                ...every.temporaryColorOverride,
                duration: upkeep,
            },
            timedCopyEffects: {
                ...every.timedCopyEffects,
                effects: every.timedCopyEffects.effects.map((e) => ({
                    ...e,
                    duration: upkeep,
                })),
            },
        };
    }

    function resets(key: OptionalCardInstanceKey): readonly CardFieldReset[] {
        return CARD_FIELD_LIFECYCLE[key].reset;
    }

    /** Layer-2-to-6 DERIVED output (PRD #2064): recomposed from the Continuous
     *  Effects Registry by `syncLayer6` / `syncLayers2to5` at every phase
     *  boundary, so the cleanup step rewrites them from a registry this fixture
     *  leaves empty. The table's `reset` column speaks about the three ladders;
     *  the registry sync speaks for these four. */
    const REGISTRY_DERIVED: ReadonlySet<OptionalCardInstanceKey> = new Set([
        "abilitiesSuppressedBy",
        "grantedColors",
        "grantedSupertypes",
        "removedSupertypes",
    ]);

    /** Assert the ladder for `scope`: every bare `scope` row is gone, every
     *  row naming neither `scope` nor `custom:scope` is untouched. Rows with
     *  `custom:scope` are the ladder's hand-kept steps and assert nothing. */
    function expectLadder(
        before: Record<string, unknown>,
        after: CardInstanceState,
        scope: CardFieldResetScope,
        ignore: ReadonlySet<OptionalCardInstanceKey> = new Set()
    ): void {
        const shouldClear: string[] = [];
        const shouldSurvive: string[] = [];
        for (const key of CARD_FIELD_KEYS) {
            const r = resets(key);
            if (r.includes(scope)) shouldClear.push(key);
            else if (!r.includes(`custom:${scope}`) && !ignore.has(key)) {
                shouldSurvive.push(key);
            }
        }
        expect(shouldClear.length).toBeGreaterThan(0);
        const leaked = shouldClear.filter(
            (key) => after[key as OptionalCardInstanceKey] !== undefined
        );
        expect(leaked, `still set after ${scope} reset`).toEqual([]);
        const lost = shouldSurvive.filter(
            (key) =>
                JSON.stringify(after[key as OptionalCardInstanceKey]) !==
                JSON.stringify(before[key])
        );
        expect(lost, `changed by the ${scope} reset`).toEqual([]);
    }

    /** The every-field permanent beside the creature its `attachedTo` /
     *  `grantedEnchantRestriction` pair names, so the cleanup step's SBA sweep
     *  (CR 704.5m — an Aura attached illegally goes to the graveyard) keeps it
     *  on the battlefield. */
    function everyFieldOnBattlefield(
        every: ReturnType<typeof everyFieldSurvivingDurations>
    ): {
        card: CardInstanceState;
        state: GameState;
    } {
        const host = makeInstance(grizzlyBears.id, {
            id: "cf-host",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const card = makeInstance(grizzlyBears.id, {
            id: "cf-turn",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            ...every,
            attachedTo: host.id,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, card] }),
                makePlayer("p2"),
            ],
            phase: "CLEANUP",
        });
        return { card, state };
    }

    function findCard(state: GameState, id: string): CardInstanceState {
        for (const p of state.players) {
            for (const zone of [
                p.battlefield,
                p.graveyard,
                p.exile,
                p.hand,
                p.library,
            ]) {
                const hit = zone.find((c) => c.id === id);
                if (hit) return hit;
            }
        }
        throw new Error(`${id} left every zone`);
    }

    it("`turn` rows clear at the cleanup step; the others survive it", () => {
        const every = everyFieldSurvivingDurations();
        const { state } = everyFieldOnBattlefield(every);
        finalizeCleanup(state);
        const after = findCard(state, "cf-turn");
        expect(after.zone).toBe("battlefield");
        expectLadder(
            { ...every, attachedTo: "cf-host" },
            after,
            "turn",
            REGISTRY_DERIVED
        );
    });

    it("`zone-change` rows clear on the battlefield reset; the others survive it", () => {
        const every = everyFieldSurvivingDurations();
        const card = makeInstance(grizzlyBears.id, {
            id: "cf-zone",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            ...every,
            // Layer-4 output mutated in place, with its base recorded: the
            // ladder re-seats `types` FROM `baseTypes` before the generic
            // clear deletes the base — a loop run too early reads nothing.
            types: ["Artifact", "Creature"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [card] }),
                makePlayer("p2"),
            ],
        });
        resetBattlefieldTransientState(card, state);
        expectLadder(every, card, "zone-change");
        expect(card.types).toEqual(every.baseTypes);
        expect(card.subtypes).toEqual(every.baseSubtypes);
    });

    it("`stack` rows clear on the stack exit; the others survive it", () => {
        const every = everyFieldSurvivingDurations();
        const item: StackItem = {
            ...makeInstance(grizzlyBears.id, {
                id: "cf-stack-reset",
                controllerId: "p1",
                ownerId: "p1",
                zone: "stack",
                ...every,
            }),
            castById: "p1",
            targets: [],
        };
        resetStackTransientState(item);
        expectLadder(every, item as CardInstanceState, "stack");
    });

    // CR 702.103b / 400.7 — the bestowed shape the every-field fixture cannot
    // carry: `revertBestow` recomposes layers 2-5 for the object, so it must
    // run AFTER the generic clear has removed the old object's ledgers (the
    // hand-written ladder's order) — or a `subtypeAddHolds` row would be
    // replayed onto the object that leaves.
    it("a bestowed permanent leaves un-bestowed, its ledgers gone and not replayed", () => {
        const card = makeInstance(grizzlyBears.id, {
            id: "cf-bestowed-zone",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            types: ["Enchantment"],
            subtypes: ["Aura", "Zombie"],
            power: undefined,
            toughness: undefined,
            bestowed: true,
            attachedTo: "cf-host",
            baseTypes: ["Creature"],
            baseSubtypes: ["Bear"],
            subtypeAddHolds: [{ subtype: "Zombie", seq: 1 }],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [card] }),
                makePlayer("p2"),
            ],
        });
        resetBattlefieldTransientState(card, state);
        expect(card.bestowed).toBeUndefined();
        expect(card.subtypeAddHolds).toBeUndefined();
        // (`baseTypes` is re-captured fresh by the recomposition — the same
        // as before the table; only the LEDGER must be gone.)
        expect(card.subtypes).not.toContain("Zombie");
        expect(card.types).toEqual(["Creature"]);
    });

    // The bare scopes, FROZEN as the key sets the hand-written ladders
    // deleted before the table existed (origin/staging at issue #4453:
    // `finalizeCleanup` 18, `resetBattlefieldTransientState` 64,
    // `resetStackTransientState` 9). The ladder tests above cannot catch a
    // row moved INTO a scope (the loop then clears it), so the sets are
    // pinned here: widening a scope is a CR 400.7 / 514.2 decision that
    // edits this list on purpose, never a side effect.
    const FROZEN_SCOPES: Record<CardFieldResetScope, readonly string[]> = {
        turn: [
            "canAttackDespiteDefenderThisTurn",
            "canBlockAdditional",
            "cantAttackThisTurn",
            "cantBeBlockedBySubtypesThisTurn",
            "cantBeBlockedThisTurn",
            "cantBeRegeneratedThisTurn",
            "cantBlockThisTurn",
            "damageLockThisTurn",
            "damageMarked",
            "damagedBySources",
            "dealtDamageToOpponentThisTurn",
            "dealtDeathtouchDamage",
            "exileOnDeath",
            "hasAttackedThisTurn",
            "hasBlockedThisTurn",
            "mustAttackThisTurn",
            "mustBlockAllThisTurn",
            "regenerationShields",
        ],
        "zone-change": [
            "abilitiesSuppressedBy",
            "abilityLossHolds",
            "activationsThisTurn",
            "baseControllerId",
            "baseSubtypes",
            "baseTypes",
            "cantBeBlockedBySubtypesThisTurn",
            "cantBeBlockedThisTurn",
            "castOffSorceryTiming",
            "chosenMana",
            "chosenName",
            "chosenPlayerId",
            "chosenSubtypes",
            "chosenXOnCast",
            "classLevel",
            "colorOverride",
            "controlChanges",
            "counters",
            "countersAtLeave",
            "damageLockThisTurn",
            "damageMarked",
            "damagedBySources",
            "dashed",
            "dealtDeathtouchDamage",
            "enteredOnTurn",
            "escaped",
            "evoked",
            "exertedThisTap",
            "exileOnDeath",
            "exiledBySourceId",
            "grantedActivatedAbilities",
            "grantedAttackRequirements",
            "grantedColors",
            "grantedSupertypes",
            "grantedTriggeredAbilities",
            "hasAttackedThisTurn",
            "hasBlockedThisTurn",
            "isAttacking",
            "isBlocking",
            "isSummoningSick",
            "kickerPayments",
            "lifePaidThisTap",
            "manaCommitted",
            "manaCounterRemoval",
            "manaPaidThisTap",
            "overloaded",
            "regenerationShields",
            "removedSupertypes",
            "skipNextUntap",
            "sourceTappedPTMods",
            "staticSeq",
            "subtypeAddHolds",
            "supertypeHolds",
            "tapTriggerCommitted",
            "temporaryColorOverride",
            "textChangeHolds",
            "transformCount",
            "transformedAtDelayedSeq",
            "triggersThisTurn",
            "typeLineHolds",
            "unkickedCostPayments",
            "untapLockedBy",
            "warped",
            "wasKicked",
        ],
        stack: [
            "castOffSorceryTiming",
            "chosenModeId",
            "dashed",
            "escaped",
            "evoked",
            "kickerPayments",
            "overloaded",
            "unkickedCostPayments",
            "warped",
        ],
    };

    it.each(["turn", "zone-change", "stack"] as const)(
        "the `%s` scope is exactly the key set the hand-written ladder cleared",
        (scope) => {
            const bare = CARD_FIELD_KEYS.filter((key) =>
                resets(key).includes(scope)
            ).sort();
            expect(bare).toEqual(FROZEN_SCOPES[scope]);
        }
    );

    it("the `none` rows — surviving all three ladders — are the frozen remainder", () => {
        const none = CARD_FIELD_KEYS.filter(
            (key) => resets(key).length === 0
        ).sort();
        expect(none).toEqual([
            "capturedBindings",
            "castFromGraveyardExilesOnResolve",
            "copiedFrom",
            "copyExcept",
            "copyOptions",
            "createdBy",
            "echoPending",
            "enterAttackingTarget",
            "entersAsTypeLine",
            "exileOnLeave",
            "faceDown",
            "faceDownBy",
            "faceDownOf",
            "imagePrintId",
            "isToken",
            "knownTo",
            "linkedTokenId",
            "madnessExiled",
            "madnessTriggerPending",
            "manaCostOverride",
            "notedMana",
            "notedManaSpentOnCast",
            "pileLabel",
            "reboundExiled",
            "tapBonusMana",
            "timedCopyEffects",
            "transformed",
            "transformedFrom",
            "worldSeq",
        ]);
    });
});
