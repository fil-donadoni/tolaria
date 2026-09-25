/**
 * Card Field Lifecycle — ONE exhaustive row per optional `CardInstanceState`
 * key (issue #4453, PRD #4447).
 *
 * A new optional field on a card instance costs the type member and one row
 * here. The row drives:
 *
 *  - the WIRE: `compactCard` / `expandCard` (`gre/serialize.ts`) loop over
 *    this table in key order — TABLE ORDER IS WIRE KEY ORDER, proven
 *    byte-identical against a fixture stored before the table existed
 *    (`__tests__/cardFieldLifecycle.test.ts`);
 *  - the persisted-key census: every key here is written by `compactCard`
 *    unless its codec is `transient`;
 *  - the three reset ladders — the cleanup step's per-turn clear
 *    (`finalizeCleanup`, `gre/phases.ts`), the battlefield-exit / re-entry
 *    clean (`resetBattlefieldTransientState`, `gre/state.ts`, CR 400.7) and
 *    the stack-exit clean (`resetStackTransientState`, `gre/state.ts`) —
 *    each of which deletes the keys listing its scope in `reset` AFTER its
 *    hand-kept steps have run.
 *
 * Exhaustive by construction: the `satisfies` clause below is a mapped type
 * over the optional keys, so a field added to `CardInstanceState` without a
 * row (or a row naming no field) reds `check:ts`.
 *
 * `codec` — how the wire carries the field:
 *  - `flag`      boolean; written as the literal `true` when truthy, read back
 *                as `true`;
 *  - `scalar`    written and read back when TRUTHY (a `0` is dropped — every
 *                such number means "none" at zero);
 *  - `defined`   written and read back when `!== undefined` (`0` and `{}`
 *                survive: a turn number, a `{}` mana-cost override);
 *  - `list`      array; written when `length > 0`, read back when present;
 *  - `record`    object; written when it has at least one key, read back
 *                when present;
 *  - `custom`    a hand-written pair in `gre/serialize.ts`
 *                (`CARD_FIELD_CUSTOM_CODECS`, exhaustive over the `custom`
 *                rows) — a definition diff, a legacy-shape coercion, a
 *                conditional restore;
 *  - `transient` never written, never read (none today; a future entry owes a
 *                one-line reason on its row).
 *
 * `reset` — the boundaries that CLEAR the field, out of the three ladders
 * above; `[]` = the field survives all three (it is ended elsewhere: by its
 * own mechanic, or by the departure-side `removePermanentTo`). A bare scope
 * puts the key in that ladder's generic `delete` loop; a `custom:<scope>`
 * entry documents a clear that ladder performs by hand (a revert helper
 * restoring a printed characteristic first, a conditional sweep) and is NOT
 * looped. The reset-scope test asserts a bare scope clears and an absent
 * scope survives; a `custom:` scope asserts nothing.
 *
 * No `CR` prose is repeated per row: the rule that justifies each clear
 * stays on the ladder that used to spell it out (`git log -S<field>` finds
 * it), and the wire justification stays on the type member.
 */
import type { CardInstanceState } from "./declarations";

/** The optional keys of `CardInstanceState` — the table's domain. */
export type OptionalCardInstanceKey = {
    [K in keyof CardInstanceState]-?: object extends Pick<CardInstanceState, K>
        ? K
        : never;
}[keyof CardInstanceState];

export type CardFieldCodec =
    | "flag"
    | "scalar"
    | "defined"
    | "list"
    | "record"
    | "custom"
    | "transient";

export type CardFieldResetScope = "turn" | "zone-change" | "stack";

export type CardFieldReset =
    | CardFieldResetScope
    | `custom:${CardFieldResetScope}`;

export type CardFieldLifecycleRow = {
    readonly codec: CardFieldCodec;
    readonly reset: readonly CardFieldReset[];
};

const NONE = [] as const;
const TURN = ["turn"] as const;
const ZONE = ["zone-change"] as const;
const STACK = ["stack"] as const;
const TURN_ZONE = ["turn", "zone-change"] as const;
const ZONE_STACK = ["zone-change", "stack"] as const;

// prettier-ignore
export const CARD_FIELD_LIFECYCLE = {
    // Definition diff: written only when it differs from the printed value;
    // read back through the `"power" in compact` fallback. Restored by hand
    // by `revertAnimation` / `revertBestow` / the adventure and split reverts.
    power:                      { codec: "custom",  reset: ["custom:zone-change", "custom:stack"] },
    toughness:                  { codec: "custom",  reset: ["custom:zone-change", "custom:stack"] },
    isToken:                    { codec: "flag",    reset: NONE },
    // Cleared at the untap step for the active player (`gre/phases.ts`).
    isSummoningSick:            { codec: "flag",    reset: ["custom:turn", "zone-change"] },
    enteredOnTurn:              { codec: "defined", reset: ZONE },
    echoPending:                { codec: "flag",    reset: NONE },
    isAttacking:                { codec: "flag",    reset: ZONE },
    isBlocking:                 { codec: "flag",    reset: ZONE },
    hasAttackedThisTurn:        { codec: "flag",    reset: TURN_ZONE },
    hasBlockedThisTurn:         { codec: "flag",    reset: TURN_ZONE },
    // Rolled forward from `hasAttackedThisTurn` at cleanup, once per turn.
    attackedDuringLastTurn:     { codec: "flag",    reset: ["custom:turn"] },
    dealtDamageToOpponentThisTurn: { codec: "flag", reset: TURN_ZONE },
    // Re-stamped at every untap step.
    startedTurnUntapped:        { codec: "flag",    reset: ["custom:turn"] },
    chosenModeId:               { codec: "scalar",  reset: STACK },
    chosenName:                 { codec: "scalar",  reset: ZONE },
    manaCommitted:              { codec: "flag",    reset: ZONE },
    tapTriggerCommitted:        { codec: "flag",    reset: ZONE },
    damageMarked:               { codec: "scalar",  reset: TURN_ZONE },
    classLevel:                 { codec: "scalar",  reset: ZONE },
    // Legacy shape on expand (`loyaltyActivatedThisTurn`, issue #3339);
    // cleared at turn start, not at cleanup.
    loyaltyActivationsThisTurn: { codec: "custom",  reset: ["custom:turn"] },
    dealtDeathtouchDamage:      { codec: "flag",    reset: TURN_ZONE },
    regenerationShields:        { codec: "scalar",  reset: TURN_ZONE },
    chosenMana:                 { codec: "scalar",  reset: ZONE },
    manaCounterRemoval:         { codec: "scalar",  reset: ZONE },
    lifePaidThisTap:            { codec: "scalar",  reset: ZONE },
    manaPaidThisTap:            { codec: "scalar",  reset: ZONE },
    tapBonusMana:               { codec: "scalar",  reset: ZONE },
    grantedActivatedAbilities:  { codec: "list",    reset: ZONE },
    // Legacy shape on expand: bare source-id strings coerce to `seq: 0`.
    abilitiesSuppressedBy:      { codec: "custom",  reset: ZONE },
    grantedTriggeredAbilities:  { codec: "list",    reset: ZONE },
    grantedAttackRequirements:  { codec: "list",    reset: ZONE },
    // KEPT across a zone change, re-seated to the reset multiset (PRD #2064
    // S6b-part-2): `[]` is a meaningful base, hence `scalar` (presence).
    baseStaticAbilities:        { codec: "scalar",  reset: ["custom:zone-change"] },
    abilityLossHolds:           { codec: "list",    reset: ZONE },
    baseControllerId:           { codec: "scalar",  reset: ZONE },
    baseTypes:                  { codec: "scalar",  reset: ZONE },
    baseSubtypes:               { codec: "scalar",  reset: ZONE },
    textChangeHolds:            { codec: "list",    reset: ZONE },
    typeLineHolds:              { codec: "list",    reset: ZONE },
    subtypeAddHolds:            { codec: "list",    reset: ZONE },
    supertypeHolds:             { codec: "list",    reset: ZONE },
    damagedBySources:           { codec: "list",    reset: TURN_ZONE },
    // Ended by the departure side (`removePermanentTo`) and by `revertBestow`.
    attachedTo:                 { codec: "scalar",  reset: ["custom:zone-change", "custom:stack"] },
    controlChanges:             { codec: "list",    reset: ZONE },
    // Reverted (mutations undone) by `revertAnimation` before anything else.
    animation:                  { codec: "scalar",  reset: ["custom:zone-change"] },
    // Reverted by `revertTypeLine`, which restores the subtypes first.
    temporarySubtypeChange:     { codec: "scalar",  reset: ["custom:zone-change"] },
    indefiniteSubtypeSet:       { codec: "scalar",  reset: ["custom:zone-change"] },
    enterAttackingTarget:       { codec: "scalar",  reset: NONE },
    entersAsTypeLine:           { codec: "scalar",  reset: NONE },
    temporaryColorOverride:     { codec: "scalar",  reset: ZONE },
    sourceTappedPTMods:         { codec: "list",    reset: ZONE },
    untapLockedBy:              { codec: "list",    reset: ZONE },
    // Consumed at the untap step it skips.
    skipNextUntap:              { codec: "flag",    reset: ["custom:turn", "zone-change"] },
    // Cleared when the permanent untaps (untap step or otherwise).
    exertedThisTap:             { codec: "flag",    reset: ["custom:turn", "zone-change"] },
    canAttackDespiteDefenderThisTurn: { codec: "flag", reset: TURN_ZONE },
    counters:                   { codec: "record",  reset: ZONE },
    countersAtLeave:            { codec: "record",  reset: ZONE },
    capturedBindings:           { codec: "record",  reset: NONE },
    worldSeq:                   { codec: "defined", reset: NONE },
    staticSeq:                  { codec: "defined", reset: ZONE },
    // Both tallies clear at turn START (`gre/phases.ts`), not at cleanup.
    activationsThisTurn:        { codec: "record",  reset: ["custom:turn", "zone-change"] },
    triggersThisTurn:           { codec: "record",  reset: ["custom:turn", "zone-change"] },
    colorOverride:              { codec: "list",    reset: ZONE },
    grantedColors:              { codec: "list",    reset: ZONE },
    grantedSupertypes:          { codec: "list",    reset: ZONE },
    removedSupertypes:          { codec: "list",    reset: ZONE },
    copyExcept:                 { codec: "scalar",  reset: NONE },
    copiedFrom:                 { codec: "scalar",  reset: NONE },
    copyOptions:                { codec: "scalar",  reset: NONE },
    timedCopyEffects:           { codec: "scalar",  reset: NONE },
    // `{}` IS the override (Eternalize / Embalm), so presence, not truthiness.
    manaCostOverride:           { codec: "defined", reset: NONE },
    imagePrintId:               { codec: "scalar",  reset: NONE },
    exileOnDeath:               { codec: "flag",    reset: TURN_ZONE },
    damageLockThisTurn:         { codec: "flag",    reset: TURN_ZONE },
    exileOnLeave:               { codec: "flag",    reset: NONE },
    cantBeRegeneratedThisTurn:  { codec: "flag",    reset: TURN },
    mustAttackThisTurn:         { codec: "flag",    reset: TURN },
    canBlockAdditional:         { codec: "defined", reset: TURN },
    mustBlockAllThisTurn:       { codec: "flag",    reset: TURN },
    cantBlockThisTurn:          { codec: "flag",    reset: TURN },
    cantAttackThisTurn:         { codec: "flag",    reset: TURN },
    cantBeBlockedThisTurn:      { codec: "flag",    reset: TURN_ZONE },
    cantBeBlockedBySubtypesThisTurn: { codec: "list", reset: TURN_ZONE },
    chosenPlayerId:             { codec: "scalar",  reset: ZONE },
    chosenSubtypes:             { codec: "list",    reset: ZONE },
    pileLabel:                  { codec: "scalar",  reset: NONE },
    faceDown:                   { codec: "flag",    reset: NONE },
    // A retired producer is dropped on expand together with `knownTo`
    // (issue #3001).
    faceDownBy:                 { codec: "custom",  reset: NONE },
    faceDownOf:                 { codec: "scalar",  reset: NONE },
    // Identity reverted by `revertAdventureIdentity` / `revertSplitIdentity`
    // on stack exit — the printed card comes back with them.
    adventureOf:                { codec: "scalar",  reset: ["custom:stack"] },
    splitHalfOf:                { codec: "scalar",  reset: ["custom:stack"] },
    transformed:                { codec: "flag",    reset: NONE },
    transformedFrom:            { codec: "scalar",  reset: NONE },
    createdBy:                  { codec: "scalar",  reset: NONE },
    linkedTokenId:              { codec: "scalar",  reset: NONE },
    knownTo:                    { codec: "custom",  reset: NONE },
    notedMana:                  { codec: "scalar",  reset: NONE },
    // The impulse permission window: the whole family expires TOGETHER at
    // cleanup, conditionally on the turn it names (`gre/phases.ts`).
    castableFromExileBy:        { codec: "scalar",  reset: ["custom:turn"] },
    castableFromExileUntilOwnTurn: { codec: "defined", reset: ["custom:turn"] },
    castableFromExileUntilTurn: { codec: "defined", reset: ["custom:turn"] },
    castableFromExileFromTurn:  { codec: "defined", reset: ["custom:turn"] },
    warpExiled:                 { codec: "flag",    reset: ["custom:turn"] },
    warped:                     { codec: "flag",    reset: ZONE_STACK },
    transformedAtDelayedSeq:    { codec: "defined", reset: ZONE },
    transformCount:             { codec: "defined", reset: ZONE },
    castFromExileNotAsAdventure: { codec: "flag",   reset: ["custom:turn"] },
    castFromExileWithoutPayingManaCost: { codec: "flag", reset: ["custom:turn"] },
    castableFromExileIncludesLand: { codec: "flag", reset: ["custom:turn"] },
    castFromExileManaSubstitution: { codec: "scalar", reset: ["custom:turn"] },
    castFromExileCostIncrease:  { codec: "scalar",  reset: ["custom:turn"] },
    exiledBySourceId:           { codec: "scalar",  reset: ZONE },
    // The graveyard twin of the exile window (issue #1344).
    castableFromGraveyardBy:    { codec: "scalar",  reset: ["custom:turn"] },
    castableFromGraveyardUntilTurn: { codec: "defined", reset: ["custom:turn"] },
    castFromGraveyardExilesOnResolve: { codec: "flag", reset: NONE },
    castFromGraveyardWithoutPayingManaCost: { codec: "flag", reset: ["custom:turn"] },
    // Swept off every graveyard card at cleanup (`gre/phases.ts`).
    grantedFlashback:           { codec: "scalar",  reset: ["custom:turn"] },
    // `clearGrantedEnchantRestriction` on re-entry; `revertBestow` on both.
    grantedEnchantRestriction:  { codec: "scalar",  reset: ["custom:zone-change", "custom:stack"] },
    escaped:                    { codec: "flag",    reset: ZONE_STACK },
    madnessExiled:              { codec: "flag",    reset: NONE },
    madnessTriggerPending:      { codec: "flag",    reset: NONE },
    reboundExiled:              { codec: "flag",    reset: NONE },
    evoked:                     { codec: "flag",    reset: ZONE_STACK },
    dashed:                     { codec: "flag",    reset: ZONE_STACK },
    // Expand re-clears power/toughness (an Aura has none, CR 208.3);
    // `revertBestow` restores the printed line on both exits.
    bestowed:                   { codec: "custom",  reset: ["custom:zone-change", "custom:stack"] },
    overloaded:                 { codec: "flag",    reset: ZONE_STACK },
    castOffSorceryTiming:       { codec: "flag",    reset: ZONE_STACK },
    notedManaSpentOnCast:       { codec: "record",  reset: NONE },
    wasKicked:                  { codec: "flag",    reset: ZONE },
    kickerPayments:             { codec: "record",  reset: ZONE_STACK },
    unkickedCostPayments:       { codec: "record",  reset: ZONE_STACK },
    chosenXOnCast:              { codec: "defined", reset: ZONE },
} as const satisfies { readonly [K in OptionalCardInstanceKey]: CardFieldLifecycleRow };

/** The table's keys, in wire order. */
export const CARD_FIELD_KEYS = Object.keys(
    CARD_FIELD_LIFECYCLE
) as readonly OptionalCardInstanceKey[];

/** The keys whose `codec` is `custom` — the domain of
 *  `CARD_FIELD_CUSTOM_CODECS` in `gre/serialize.ts`. */
export type CustomCardFieldKey = {
    [K in OptionalCardInstanceKey]: (typeof CARD_FIELD_LIFECYCLE)[K]["codec"] extends "custom"
        ? K
        : never;
}[OptionalCardInstanceKey];

/** Optional `CardInstanceState` keys that round-trip through `compactCard` /
 *  `expandCard` — every row whose codec is not `transient`. The card-level
 *  counterpart of `PERSISTED_OPTIONAL_KEYS` (`gre/serialize.ts`), derived
 *  rather than hand-kept. */
export const CARD_PERSISTED_OPTIONAL_KEYS: readonly OptionalCardInstanceKey[] =
    CARD_FIELD_KEYS.filter(
        (key) =>
            (CARD_FIELD_LIFECYCLE[key].codec as CardFieldCodec) !== "transient"
    );

const RESET_KEYS: {
    readonly [S in CardFieldResetScope]: readonly OptionalCardInstanceKey[];
} = {
    turn: CARD_FIELD_KEYS.filter((key) =>
        (CARD_FIELD_LIFECYCLE[key].reset as readonly CardFieldReset[]).includes(
            "turn"
        )
    ),
    "zone-change": CARD_FIELD_KEYS.filter((key) =>
        (CARD_FIELD_LIFECYCLE[key].reset as readonly CardFieldReset[]).includes(
            "zone-change"
        )
    ),
    stack: CARD_FIELD_KEYS.filter((key) =>
        (CARD_FIELD_LIFECYCLE[key].reset as readonly CardFieldReset[]).includes(
            "stack"
        )
    ),
};

/** The keys a ladder's generic loop deletes at `scope`. */
export function cardFieldsResetAt(
    scope: CardFieldResetScope
): readonly OptionalCardInstanceKey[] {
    return RESET_KEYS[scope];
}

/** Delete every key declared `reset: [scope]` from `card` — the generic half
 *  of a reset ladder, run AFTER the ladder's hand-kept steps (a revert helper
 *  may still need to read a field this loop removes). */
export function clearCardFieldsAt(
    card: CardInstanceState,
    scope: CardFieldResetScope
): void {
    for (const key of RESET_KEYS[scope]) delete card[key];
}
