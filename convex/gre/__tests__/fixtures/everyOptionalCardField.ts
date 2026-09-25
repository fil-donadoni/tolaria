/**
 * One value for EVERY optional `CardInstanceState` key (issue #4453).
 *
 * The return type is a mapped type over the optional keys with `-?`, so
 * adding an optional field to `CardInstanceState` without a value here reds
 * `check:ts` — the fixture can never silently fall behind the type it covers.
 * Every value is chosen so `compactCard` EMITS it: truthy scalars, non-zero
 * numbers, non-empty arrays and records, a live `faceDownBy` producer (a
 * retired one is dropped on expand together with `knownTo`, issue #3001).
 *
 * `bestowed` is the one row a caller usually strips: a bestowed object is an
 * Aura with no power or toughness (CR 208.3), and `expandCard` re-clears both
 * when it sees the marker — so "every field, bestowed included" cannot
 * round-trip to itself by construction. `cardFieldLifecycle.test.ts` covers
 * the bestowed shape as its own case.
 */
import type { CardInstanceState } from "../../state/declarations";

/** The optional keys of `CardInstanceState` — the domain of the Card Field
 *  Lifecycle table. */
export type OptionalCardInstanceKey = {
    [K in keyof CardInstanceState]-?: object extends Pick<CardInstanceState, K>
        ? K
        : never;
}[keyof CardInstanceState];

export type EveryOptionalCardField = {
    [K in OptionalCardInstanceKey]-?: NonNullable<CardInstanceState[K]>;
};

export function everyOptionalCardField(): EveryOptionalCardField {
    return {
        isToken: true,
        power: 5,
        toughness: 6,
        chosenMana: { G: 1 },
        manaCounterRemoval: { type: "charge", count: 1 },
        lifePaidThisTap: 2,
        exertedThisTap: true,
        manaPaidThisTap: { R: 1 },
        tapBonusMana: { C: 1 },
        chosenModeId: "mode-a",
        chosenName: "Lightning Bolt",
        manaCommitted: true,
        tapTriggerCommitted: true,
        isSummoningSick: true,
        enteredOnTurn: 3,
        echoPending: true,
        isAttacking: true,
        isBlocking: true,
        hasAttackedThisTurn: true,
        hasBlockedThisTurn: true,
        attackedDuringLastTurn: true,
        dealtDamageToOpponentThisTurn: true,
        startedTurnUntapped: true,
        grantedActivatedAbilities: [
            {
                sourceCardId: "src-1",
                abilityId: "ab-1",
                origin: "grant-template",
                seq: 4,
            },
        ],
        grantedTriggeredAbilities: [
            { sourceCardId: "src-2", abilityId: "tr-1", seq: 5 },
        ],
        abilitiesSuppressedBy: [{ sourceId: "src-3", seq: 6 }],
        abilityLossHolds: [{ sourceId: "src-4", seq: 7 }],
        baseStaticAbilities: ["flying"],
        damageMarked: 1,
        loyaltyActivationsThisTurn: 1,
        dealtDeathtouchDamage: true,
        regenerationShields: 1,
        damagedBySources: ["src-5"],
        attachedTo: "host-1",
        grantedEnchantRestriction: { types: ["Creature"] },
        controlChanges: [
            {
                auraId: "aura-1",
                previousControllerId: "p1",
                controllerId: "p2",
                seq: 8,
            },
        ],
        animation: {
            seq: 9,
            savedPower: 2,
            savedToughness: 2,
            setPower: 0,
            setToughness: 0,
            addedCreatureType: true,
            addedTypes: ["Artifact"],
            addedSubtype: "Golem",
            duration: { phase: "end-of-turn" },
            colors: ["G"],
            grantedAbilities: ["haste"],
        },
        temporarySubtypeChange: {
            subtypes: ["Elf"],
            restoreSubtypes: ["Bear"],
            duration: { phase: "end-of-turn" },
            seq: 10,
            family: "creature",
        },
        entersAsTypeLine: { types: ["Enchantment"], subtypes: [] },
        indefiniteSubtypeSet: {
            restoreSubtypes: ["Bear"],
            seq: 11,
            subtypes: ["Spirit"],
        },
        sourceTappedPTMods: [{ power: 1, toughness: 1, sourceId: "src-6" }],
        untapLockedBy: ["src-7"],
        skipNextUntap: true,
        canAttackDespiteDefenderThisTurn: true,
        counters: { "+1/+1": 2 },
        classLevel: 2,
        countersAtLeave: { "+1/+1": 1 },
        capturedBindings: { exiled: ["inst-x"] },
        worldSeq: 12,
        staticSeq: 13,
        activationsThisTurn: { "ab-1": 1 },
        triggersThisTurn: { "tr-1": 1 },
        exileOnDeath: true,
        damageLockThisTurn: true,
        exileOnLeave: true,
        cantBeRegeneratedThisTurn: true,
        mustAttackThisTurn: true,
        grantedAttackRequirements: [{ seq: 14 }],
        grantedColors: [{ color: "U", sourceId: "src-8" }],
        grantedSupertypes: [{ supertype: "Snow", sourceId: "src-9" }],
        removedSupertypes: [{ supertype: "Legendary", sourceId: "src-10" }],
        baseControllerId: "p1",
        baseTypes: ["Creature"],
        baseSubtypes: ["Bear"],
        textChangeHolds: [
            {
                change: { kind: "land-type", from: "Island", to: "Swamp" },
                seq: 15,
            },
        ],
        typeLineHolds: [{ types: ["Artifact"], seq: 16 }],
        subtypeAddHolds: [{ subtype: "Zombie", seq: 17 }],
        supertypeHolds: [{ add: ["Snow"], remove: ["Legendary"], seq: 18 }],
        faceDown: true,
        faceDownOf: "def-front",
        adventureOf: "def-adv",
        splitHalfOf: "def-split",
        faceDownBy: "morph",
        transformed: true,
        transformedFrom: "def-tf",
        transformedAtDelayedSeq: 19,
        transformCount: 2,
        pileLabel: "A",
        canBlockAdditional: 1,
        mustBlockAllThisTurn: true,
        cantBlockThisTurn: true,
        cantAttackThisTurn: true,
        cantBeBlockedThisTurn: true,
        cantBeBlockedBySubtypesThisTurn: ["Wall"],
        chosenPlayerId: "p2",
        chosenSubtypes: ["Elf", "Goblin"],
        colorOverride: ["B"],
        manaCostOverride: {},
        imagePrintId: "print-1",
        temporaryColorOverride: {
            colors: ["R"],
            restoreColorOverride: ["B"],
            duration: { phase: "end-of-turn" },
        },
        copiedFrom: "def-orig",
        copyExcept: { basePower: 1, baseToughness: 1 },
        copyOptions: { copyColor: true },
        timedCopyEffects: {
            underlying: null,
            effects: [
                {
                    sourceDefId: "def-c",
                    opts: {},
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
        createdBy: "src-11",
        linkedTokenId: "tok-1",
        knownTo: ["p1"],
        notedMana: { mana: { U: 1 }, castableCardId: "def-n" },
        castableFromExileBy: "p1",
        castableFromExileIncludesLand: true,
        castFromExileManaSubstitution: "any-color",
        castFromExileCostIncrease: { generic: 2 },
        castableFromExileUntilTurn: 20,
        castableFromExileUntilOwnTurn: 21,
        castableFromExileFromTurn: 22,
        castFromExileWithoutPayingManaCost: true,
        castFromExileNotAsAdventure: true,
        castableFromGraveyardBy: "p1",
        castableFromGraveyardUntilTurn: 23,
        castFromGraveyardWithoutPayingManaCost: true,
        castFromGraveyardExilesOnResolve: true,
        exiledBySourceId: "src-12",
        grantedFlashback: { R: 1 },
        escaped: true,
        madnessExiled: true,
        madnessTriggerPending: true,
        reboundExiled: true,
        evoked: true,
        overloaded: true,
        dashed: true,
        warped: true,
        warpExiled: true,
        enterAttackingTarget: "p2",
        bestowed: true,
        castOffSorceryTiming: true,
        notedManaSpentOnCast: { G: 2 },
        wasKicked: true,
        kickerPayments: { kicker: 1 },
        unkickedCostPayments: { offspring: 1 },
        chosenXOnCast: 3,
    };
}

/** `everyOptionalCardField()` minus `bestowed` — the shape that round-trips to
 *  itself (see the module comment). */
export function everyRoundTrippableCardField(): Omit<
    EveryOptionalCardField,
    "bestowed"
> {
    const every: Partial<EveryOptionalCardField> = everyOptionalCardField();
    delete every.bestowed;
    return every as Omit<EveryOptionalCardField, "bestowed">;
}
