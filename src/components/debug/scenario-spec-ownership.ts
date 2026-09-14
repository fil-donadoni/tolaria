import type { ScenarioSpec } from "@convex/debugScenarioSpec";
import type {
    SeatFlagPairDraft,
    SeatPairDraft,
    SpecDraft,
} from "./scenario-draft";

/**
 * Who owns a SPEC-LEVEL field when the scenario editor saves (issue #3462),
 * and — since issue #3463 — what the form renders for it.
 *
 * `updateDebugScenario` patches the row's `spec` **wholesale**, so a field the
 * editor does not re-emit is deleted from the stored scenario. Before this
 * classification the form assembled a fresh spec from its own four inputs and
 * the other six fields — `life`, `poison`, `experience`, `companion`,
 * `rngSeed`, `markLastDrawn` — silently vanished on any edit of a curated row
 * (ADR 0044 golden rows are exactly the ones carrying them).
 *
 *  - `form-owned` — the form renders an input for it, so the form's value is
 *    authoritative INCLUDING its absence (clearing `turn` must clear it).
 *  - `preserved` — the form renders nothing for it, so the loaded value is
 *    carried through untouched.
 *
 * Issue #3463 moved the remaining six to `form-owned`: a knob a human cannot
 * type is a knob only a blade scenario or `specFromState` can produce, and with
 * thirteen widenings queued under PRD #3397 that gap was becoming the normal
 * state. `preserved` stays as the classification a future field can be given —
 * the escape hatch is what makes the table safe, not a category that must be
 * non-empty.
 *
 * The table is `satisfies Record<keyof ScenarioSpec, …>`: a spec field added
 * tomorrow reds `tsc` here until it is classified, which is what makes the
 * spec-widening sequence under PRD #3397 safe.
 *
 * `tsc` is only half of it: classifying a new field does NOT force
 * `normalizeScenarioSpec` (`convex/debugScenarioSpec.ts`) to read it off a raw
 * stored row, and a field normalize drops never reaches this assembler at all.
 * What catches THAT is the render-through-the-form suite in
 * `__tests__/scenario-spec-preservation.test.tsx`, which inflates the row the
 * way the editor does — do not trim it believing the `satisfies` covers it.
 */
export type ScenarioSpecFieldOwner = "form-owned" | "preserved";

export const SCENARIO_SPEC_FIELD_OWNER = {
    cards: "form-owned",
    phase: "form-owned",
    landCount: "form-owned",
    libraryCount: "form-owned",
    // CR 400.2 (issue #3452) — cards of unknown identity in a hand.
    // `form-owned` like every field since issue #3463: "the opponent is
    // holding three cards" is a position an admin must be able to type, not
    // only one a capture can produce.
    hiddenHand: "form-owned",
    turn: "form-owned",
    markLastDrawn: "form-owned",
    rngSeed: "form-owned",
    poison: "form-owned",
    life: "form-owned",
    experience: "form-owned",
    // CR 305.2 (issue #3446) — lands already played this turn. `form-owned`
    // like its per-seat siblings: an admin pinning a post-land-drop main phase
    // must be able to type it, not only capture it.
    landsPlayed: "form-owned",
    // CR 601.2i / 118.9 / 702.40a (issue #3449) — what has already been cast.
    // `form-owned` like every field since issue #3463.
    spellsCastThisTurn: "form-owned",
    spellsCastThisGame: "form-owned",
    stormCount: "form-owned",
    // CR 120.3a / 119.3 / 700.4 / 508.1a (issue #3453) — what has already
    // happened this turn. `form-owned` like the rest: an admin staging
    // "you've already gained life this turn" must be able to type it.
    damageDealtToPlayerThisTurn: "form-owned",
    artifactDamageToPlayerThisTurn: "form-owned",
    lifeGainedThisTurn: "form-owned",
    deathsThisTurn: "form-owned",
    creatureAttackedThisTurn: "form-owned",
    // CR 508.1c / 500.1 / 207.2c (issue #3450) — the per-seat turn history:
    // Arboria's qualifying-action flags, the seat's own turn count and
    // Revolt. `form-owned` like every field since issue #3463 — an Arboria
    // position an admin cannot type is one only a capture can produce.
    qualifyingActionThisTurn: "form-owned",
    qualifyingActionLastTurn: "form-owned",
    turnsTaken: "form-owned",
    revolt: "form-owned",
    // CR 102.1 / 117.1 / 117.4 (issue #3454) — the turn holder, the priority
    // holder and the banked passes. `form-owned` like everything else since
    // issue #3463: these are the first of PRD #3397's queued widenings, and a
    // knob only `specFromState` can produce is the gap #3463 closed.
    activePlayer: "form-owned",
    priority: "form-owned",
    passCount: "form-owned",
    // CR 508.1 / 509.1 (issue #3458) — the FIRST field classified `preserved`
    // since issue #3463 emptied that category, and deliberately: a declared
    // combat is not a scalar knob but a RECORD that cross-references the card
    // list (an attacker must be a creature on the active player's battlefield;
    // a blocker names its attackers by INDEX into the attacker list). None of
    // the form's input kinds — number / boolean / seat / per-seat / phase /
    // companion — has that shape, and a comma-joined text box for it would be
    // the untypeable knob #3463 closed wearing an input. It is captured
    // (`specFromState`) or hand-written in a blade entry, and carried through
    // untouched by any edit of the row — which is the whole job of this table.
    combat: "preserved",
    // CR 106.4 / 106.6 (issue #3460) — floating mana, `preserved` for the same
    // reason `combat` is: neither is a scalar knob. `manaPool` is a
    // DYNAMIC-KEY record — six numeric knobs per seat, one per mana type
    // (`MANA_COLORS` is closed, so a form COULD enumerate them; twelve inputs
    // for a field captured far more often than typed is the trade, not an
    // impossibility) — and `restrictedMana` is a list of units each carrying a
    // restriction and two riders, which no input kind has a shape for at all.
    // A text box for either would be the untypeable knob issue #3463 closed
    // wearing an input. Both are captured
    // (`specFromState`) or hand-written in a blade entry, and carried through
    // untouched by any edit of the row.
    manaPool: "preserved",
    restrictedMana: "preserved",
    // CR 611.2a / 613 (issue #3488) — the registry entries a resolved spell
    // left behind, `preserved` for the same reason `combat` is: a list of
    // records that CROSS-REFERENCES the card list by presented name, carrying
    // a layer, a sublayer, a payload union and a phase-boundary duration. No
    // input kind in this form has that shape, and a text box for it would be
    // the untypeable knob issue #3463 closed wearing an input. Captured
    // (`specFromState`) or hand-written in a blade entry, and carried through
    // untouched by any edit of the row — minus any entry whose permanents the
    // edit removed (`dropStaleContinuousEffects`).
    continuousEffects: "preserved",
    // CR 405.1 / 601.2 (issue #3513) — the objects in flight, `preserved` for
    // the same reason `combat` is: a list of records that CROSS-REFERENCES the
    // card list by presented name and seat, carries a full target list whose
    // INDEX is load-bearing, and lets one entry point at another BY INDEX in
    // its own array. No input kind in this form has that shape, and a text box
    // for it would be the untypeable knob issue #3463 closed wearing an input.
    // Captured (`specFromState`) or hand-written in a blade entry, and carried
    // through untouched by any edit of the row.
    stack: "preserved",
    companion: "form-owned",
} as const satisfies Record<keyof ScenarioSpec, ScenarioSpecFieldOwner>;

/** The spec keys the form cannot edit — derived from the table above, never
 *  hand-listed, so it cannot drift from the classification. Emptied by issue
 *  #3463 and re-opened by issue #3458's `combat`, which is what the machinery
 *  was kept for: a widening whose shape no input kind has still has to survive
 *  an edit of the row, and finding that out after one ate a golden row is the
 *  failure this exists to prevent. */
export type PreservedScenarioSpecKey = {
    [K in keyof ScenarioSpec]-?: (typeof SCENARIO_SPEC_FIELD_OWNER)[K] extends "preserved"
        ? K
        : never;
}[keyof ScenarioSpec];

/**
 * Widened read of the classification. The table is `as const` — that is what
 * lets `PreservedScenarioSpecKey` / `FormOwnedScenarioSpecKey` be derived at
 * the TYPE level — but it also means a direct `=== "preserved"` comparison reds
 * `tsc` ("no overlap") while no field carries that classification. Reading
 * through the union keeps the runtime checks honest without baking today's
 * classification into the comparison itself.
 */
export function scenarioSpecFieldOwner(
    key: keyof ScenarioSpec
): ScenarioSpecFieldOwner {
    return SCENARIO_SPEC_FIELD_OWNER[key];
}

export const PRESERVED_SCENARIO_SPEC_KEYS = (
    Object.keys(SCENARIO_SPEC_FIELD_OWNER) as (keyof ScenarioSpec)[]
).filter(
    (key): key is PreservedScenarioSpecKey =>
        scenarioSpecFieldOwner(key) === "preserved"
);

/** Mirror of the above: the keys the form MUST render an input for. */
export type FormOwnedScenarioSpecKey = {
    [K in keyof ScenarioSpec]-?: (typeof SCENARIO_SPEC_FIELD_OWNER)[K] extends "form-owned"
        ? K
        : never;
}[keyof ScenarioSpec];

export const FORM_OWNED_SCENARIO_SPEC_KEYS = (
    Object.keys(SCENARIO_SPEC_FIELD_OWNER) as (keyof ScenarioSpec)[]
).filter(
    (key): key is FormOwnedScenarioSpecKey =>
        scenarioSpecFieldOwner(key) === "form-owned"
);

/**
 * HOW each form-owned field is rendered. `form-owned` means "there is an input
 * for it", and this table is what makes that claim checkable rather than
 * remembered: the spec-field component renders from it, and
 * `__tests__/scenario-spec-fields.test.tsx` asserts every aria-label it derives
 * is in the document. Classify a new field `form-owned` and `tsc` demands a row
 * here; add the row and the test demands the input.
 *
 *  - `per-seat` renders the me/opp pair the spec's own shape already has
 *    (`poison` / `life` / `experience` / `landsPlayed` are all
 *    `{ me?, opp? }`).
 *  - `cards` is the card repeater (`DebugScenarioCardFields`), which carries
 *    its own per-row labels — no spec-level input of its own.
 */
/**
 * WHERE a form-owned field renders (issue #3494). The save form grew to ~28
 * spec inputs in one flat list, so the knobs used on nearly every scenario
 * (`phase`, `life`, the land/library counts) sat among ones used on almost
 * none (`stormCount`, the qualifying-action flags, `rngSeed`).
 *
 *  - `frequent` — rendered directly, always visible.
 *  - `other` — rendered under the collapsed "Other options" disclosure.
 *
 * Declared HERE rather than in the component for the same reason the rest of
 * this table is: `tsc` demands the axis on every row (the `satisfies` below),
 * so a newly classified field cannot silently land in the wrong group — it
 * cannot land in NO group at all, which is what a hardcoded list of "the
 * common ones" in the renderer would have allowed.
 */
export type ScenarioSpecFieldGroup = "frequent" | "other";

/**
 * WHICH HEADING a form-owned field renders under (issue #3512) — the second
 * placement axis, orthogonal to `group`. ~28 knobs with no headings ran turn
 * state, player resources and this-turn history together; a section is the
 * semantic answer to "where is `revolt`", and a group is only "how often".
 *
 * A section may span both groups: `passCount` is a turn-and-priority knob that
 * is rarely set, so it renders under "Turn & priority" inside "Other options"
 * while `phase` renders under the same heading above it.
 *
 * Required on every row by the same `satisfies` that requires `group`, so a
 * newly classified field cannot render under no heading; the renderer iterates
 * {@link SCENARIO_SPEC_SECTIONS} and never lists a field itself.
 */
export type ScenarioSpecFieldSection =
    | "cards"
    | "turn"
    | "players"
    | "setup"
    | "this-turn"
    | "history";

/** Each section's heading, in RENDER order — the key order IS the order. */
export const SCENARIO_SPEC_SECTION_TITLE = {
    cards: "Cards",
    turn: "Turn & priority",
    players: "Players",
    setup: "Zones & setup",
    "this-turn": "This turn",
    history: "Turn history",
} as const satisfies Record<ScenarioSpecFieldSection, string>;

export const SCENARIO_SPEC_SECTIONS = Object.keys(
    SCENARIO_SPEC_SECTION_TITLE
) as ScenarioSpecFieldSection[];

/** Every input shape carries its group AND its section — neither axis is
 *  optional. */
type WithPlacement<T> = T & {
    group: ScenarioSpecFieldGroup;
    section: ScenarioSpecFieldSection;
};

export type ScenarioSpecFieldInput = WithPlacement<
    | { kind: "cards" }
    | { kind: "number"; label: string; min?: number }
    | { kind: "phase"; label: string }
    | { kind: "boolean"; label: string }
    | { kind: "per-seat"; label: string; min?: number }
    /** Issue #3450 — the BOOLEAN per-seat pair: two checkboxes, no `min`, no
     *  blank state. Its own kind rather than a flag on `per-seat` because the
     *  renderer narrows on `kind` to decide what input to emit, and the draft
     *  it reads is `{ me: boolean; opp: boolean }`. */
    | { kind: "per-seat-flag"; label: string }
    /** CR 102.1 / 117.1 (issue #3454) — ONE seat, not a me/opp pair: the turn
     *  holder and the priority holder each name a single side, and `""` (the
     *  spec's own absent) is a real selectable value. */
    | { kind: "seat"; label: string }
    | { kind: "companion"; label: string }
>;

export const SCENARIO_SPEC_FIELD_INPUT = {
    cards: { kind: "cards", group: "frequent", section: "cards" },

    phase: {
        kind: "phase",
        label: "phase",
        group: "frequent",
        section: "turn",
    },
    turn: {
        kind: "number",
        label: "turn",
        min: 1,
        group: "frequent",
        section: "turn",
    },
    activePlayer: {
        kind: "seat",
        label: "active player",
        group: "frequent",
        section: "turn",
    },
    priority: {
        kind: "seat",
        label: "priority",
        group: "frequent",
        section: "turn",
    },
    passCount: {
        kind: "number",
        label: "passes",
        min: 0,
        group: "other",
        section: "turn",
    },

    life: {
        kind: "per-seat",
        label: "life",
        group: "frequent",
        section: "players",
    },
    hiddenHand: {
        kind: "per-seat",
        label: "hidden hand",
        min: 0,
        group: "frequent",
        section: "players",
    },
    poison: {
        kind: "per-seat",
        label: "poison",
        min: 0,
        group: "other",
        section: "players",
    },
    experience: {
        kind: "per-seat",
        label: "experience",
        min: 0,
        group: "other",
        section: "players",
    },

    landCount: {
        kind: "number",
        label: "lands",
        min: 0,
        group: "frequent",
        section: "setup",
    },
    libraryCount: {
        kind: "number",
        label: "library",
        min: 0,
        group: "frequent",
        section: "setup",
    },
    rngSeed: {
        kind: "number",
        label: "rng seed",
        group: "other",
        section: "setup",
    },
    markLastDrawn: {
        kind: "boolean",
        label: "mark last drawn",
        group: "other",
        section: "setup",
    },
    companion: {
        kind: "companion",
        label: "companion",
        group: "other",
        section: "setup",
    },

    landsPlayed: {
        kind: "per-seat",
        label: "lands played",
        min: 0,
        group: "other",
        section: "this-turn",
    },
    spellsCastThisTurn: {
        kind: "per-seat",
        label: "spells cast this turn",
        min: 0,
        group: "other",
        section: "this-turn",
    },
    stormCount: {
        kind: "number",
        label: "storm count",
        min: 0,
        group: "other",
        section: "this-turn",
    },
    damageDealtToPlayerThisTurn: {
        kind: "per-seat",
        label: "damage taken this turn",
        min: 0,
        group: "other",
        section: "this-turn",
    },
    artifactDamageToPlayerThisTurn: {
        kind: "per-seat",
        label: "artifact damage taken this turn",
        min: 0,
        group: "other",
        section: "this-turn",
    },
    lifeGainedThisTurn: {
        kind: "per-seat",
        label: "life gained this turn",
        min: 0,
        group: "other",
        section: "this-turn",
    },
    deathsThisTurn: {
        kind: "number",
        label: "creatures died",
        min: 0,
        group: "other",
        section: "this-turn",
    },
    creatureAttackedThisTurn: {
        kind: "boolean",
        label: "a creature attacked this turn",
        group: "other",
        section: "this-turn",
    },

    spellsCastThisGame: {
        kind: "per-seat",
        label: "spells cast this game",
        min: 0,
        group: "other",
        section: "history",
    },
    qualifyingActionThisTurn: {
        kind: "per-seat-flag",
        label: "qualifying action this turn",
        group: "other",
        section: "history",
    },
    qualifyingActionLastTurn: {
        kind: "per-seat-flag",
        label: "qualifying action last turn",
        group: "other",
        section: "history",
    },
    turnsTaken: {
        kind: "per-seat",
        label: "turns taken",
        min: 0,
        group: "other",
        section: "history",
    },
    revolt: {
        kind: "per-seat-flag",
        label: "revolt",
        group: "other",
        section: "history",
    },
} as const satisfies {
    [K in FormOwnedScenarioSpecKey]: ScenarioSpecFieldInputFor<K>;
};

/** Widened read of a field's group, for the same reason
 *  {@link scenarioSpecFieldOwner} exists: the table is `as const`, so a direct
 *  comparison against one member would red `tsc` the day every row carried the
 *  other. */
export function scenarioSpecFieldGroup(
    key: FormOwnedScenarioSpecKey
): ScenarioSpecFieldGroup {
    return SCENARIO_SPEC_FIELD_INPUT[key].group;
}

/** Widened read of a field's section — see {@link scenarioSpecFieldGroup}. */
export function scenarioSpecFieldSection(
    key: FormOwnedScenarioSpecKey
): ScenarioSpecFieldSection {
    return SCENARIO_SPEC_FIELD_INPUT[key].section;
}

/** The form-owned keys in one group, in declaration order — what the renderer
 *  loops over, so "which fields are frequent" is answered by the table and
 *  never by the component (issue #3494). */
export function formOwnedKeysInGroup(
    group: ScenarioSpecFieldGroup
): FormOwnedScenarioSpecKey[] {
    return FORM_OWNED_SCENARIO_SPEC_KEYS.filter(
        (key) => scenarioSpecFieldGroup(key) === group
    );
}

/** Whether a field's row is a me/opp pair — the rows a section's `me` / `opp`
 *  column header stands for (issue #3512). */
export function isPerSeatSpecField(key: FormOwnedScenarioSpecKey): boolean {
    const kind = SCENARIO_SPEC_FIELD_INPUT[key].kind;
    return kind === "per-seat" || kind === "per-seat-flag";
}

/** One section as a group renders it: its heading and its spec-level rows. */
export type SpecFieldSectionRows = {
    section: ScenarioSpecFieldSection;
    title: string;
    keys: FormOwnedScenarioSpecKey[];
};

/**
 * The sections one group renders, each with its spec-level rows in the table's
 * declaration order (issue #3512). A section with no row in this group is
 * omitted, so a heading never stands over nothing — `cards` in particular
 * never appears here, because the card repeater is not a spec-level row.
 */
export function specFieldSectionsInGroup(
    group: ScenarioSpecFieldGroup
): SpecFieldSectionRows[] {
    const keys = (
        Object.keys(SCENARIO_SPEC_FIELD_INPUT) as FormOwnedScenarioSpecKey[]
    ).filter(
        (key) =>
            scenarioSpecFieldGroup(key) === group &&
            SCENARIO_SPEC_FIELD_INPUT[key].kind !== "cards"
    );
    return SCENARIO_SPEC_SECTIONS.map((section) => ({
        section,
        title: SCENARIO_SPEC_SECTION_TITLE[section],
        keys: keys.filter((key) => scenarioSpecFieldSection(key) === section),
    })).filter((rows) => rows.keys.length > 0);
}

/**
 * The kind a field's row MAY declare, derived from the type of its `SpecDraft`
 * field. Without this the table and the draft are two hand-kept mirrors, and a
 * row that kinds `life` as a plain `number` would typecheck while the component
 * rendered a single input against a `{ me, opp }` object — the rendering loop
 * narrows on `kind` and reads the draft field on the strength of it.
 */
type ScenarioSpecFieldInputFor<K extends FormOwnedScenarioSpecKey> =
    WithPlacement<
        K extends keyof SpecDraft
            ? ScenarioSpecFieldInputForValue<SpecDraft[K]>
            : { kind: "cards" }
    >;

type ScenarioSpecFieldInputForValue<V> = V extends SeatPairDraft
    ? { kind: "per-seat"; label: string; min?: number }
    : // Before the plain-boolean branch: a per-seat FLAG pair is two
      // checkboxes, and `SeatFlagPairDraft` is an object, not a boolean
      // (issue #3450).
      V extends SeatFlagPairDraft
      ? { kind: "per-seat-flag"; label: string }
      : V extends boolean
        ? { kind: "boolean"; label: string }
        : // Before the generic string branch: a draft field narrowed to the seat
          // union is a `<select>`, never a free-text number (issue #3454).
          V extends "" | "me" | "opp"
          ? { kind: "seat"; label: string }
          : V extends string
            ?
                  | { kind: "number"; label: string; min?: number }
                  | { kind: "phase"; label: string }
            : { kind: "companion"; label: string };

/** The two seats every per-seat spec field is shaped by. */
export const SCENARIO_SEATS = ["me", "opp"] as const;
export type ScenarioSeat = (typeof SCENARIO_SEATS)[number];

/**
 * The aria-labels a form-owned field renders, derived from its input shape —
 * the SINGLE authority, read by the component that renders the inputs and by
 * the test that proves they are rendered. A hand-written list on either side
 * would just be the same omission made twice.
 */
export function scenarioSpecFieldLabels(
    key: FormOwnedScenarioSpecKey
): string[] {
    const input: ScenarioSpecFieldInput = SCENARIO_SPEC_FIELD_INPUT[key];
    switch (input.kind) {
        case "cards":
            return [];
        case "per-seat":
        case "per-seat-flag":
            return SCENARIO_SEATS.map((seat) => `${input.label} ${seat}`);
        case "companion":
            return [
                `${input.label} name`,
                `${input.label} owner`,
                `${input.label} used`,
            ];
        default:
            return [input.label];
    }
}

/** Copy one key across two specs keeping the key/value correlation the type
 *  checker needs — a computed-property `Object.assign` would erase it, and the
 *  whole point here is that `tsc` polices the copy. */
function carry<K extends PreservedScenarioSpecKey>(
    target: ScenarioSpec,
    source: ScenarioSpec,
    key: K
): void {
    const value = source[key];
    if (value !== undefined) target[key] = value;
}

/**
 * Assemble the spec to persist: the form's own value for every form-owned
 * field, plus every `preserved` field the loaded row carried. `loaded` is
 * `null` when creating a new scenario — nothing to preserve.
 */
export function assembleScenarioSpec(
    formOwned: ScenarioSpec,
    loaded: ScenarioSpec | null
): ScenarioSpec {
    const spec: ScenarioSpec = { ...formOwned };
    if (!loaded) return spec;
    for (const key of PRESERVED_SCENARIO_SPEC_KEYS) carry(spec, loaded, key);
    dropStaleCombat(spec);
    dropStaleContinuousEffects(spec);
    dropStaleStack(spec);
    return spec;
}

/** The identity a battlefield card entry PRESENTS as — what a `combat`
 *  reference has to match (CR 707.2: a copy presents the copied name). */
function presentedEntryName(card: ScenarioSpec["cards"][number]): string {
    return card.copyOf ?? card.name;
}

/**
 * CR 508.1a / 509.1a (issue #3458 review) — drop a carried `combat` whose names
 * no longer name anything on the assembled battlefield.
 *
 * `cards` is form-owned and `combat` is preserved, so an admin renaming a card
 * would otherwise save a row referencing a permanent that is not there any
 * more — and `buildStateFromScenario` THROWS on an unresolvable combatant
 * rather than rebuilding a combat one attacker short, so the golden row would
 * simply stop loading. Dropping the record loses the captured combat, which is
 * a real loss and the reason the field warns rather than silently reshaping
 * itself; loading nothing at all is the worse one.
 */
function dropStaleCombat(spec: ScenarioSpec): void {
    if (!spec.combat) return;
    const onBattlefield = new Set(
        spec.cards
            .filter((card) => (card.zone ?? "battlefield") === "battlefield")
            .map(presentedEntryName)
    );
    const referenced = [
        ...(spec.combat.attackers ?? []),
        ...(spec.combat.blockers ?? []).map((entry) => entry.blocker),
        ...(spec.combat.attackedThisTurn?.me ?? []),
        ...(spec.combat.attackedThisTurn?.opp ?? []),
        ...(spec.combat.blockedThisTurn?.me ?? []),
        ...(spec.combat.blockedThisTurn?.opp ?? []),
    ];
    if (referenced.some((name) => !onBattlefield.has(name))) {
        delete spec.combat;
    }
}

/**
 * CR 405.1 / 601.2c (issue #3513) — drop a carried `stack` whose references no
 * longer name anything on the assembled board.
 *
 * The `dropStaleCombat` hazard exactly, on the field with the most references:
 * an `ability` entry names its SOURCE permanent and every `permanent` /
 * `graveyard-card` target names a card in a seat's zone, all by presented name
 * and position (`nth`), and `seedDeclaredStack` THROWS on one it cannot find —
 * so an admin who renamed a creature would save a golden row that simply stops
 * loading.
 *
 * The WHOLE array, like a combat and unlike the registry entries: the stack is
 * one position whose order and whose index references (`{ kind: "stack" }`)
 * only mean anything together, so dropping one entry would renumber the rest
 * and silently re-point every reference above it.
 */
function dropStaleStack(spec: ScenarioSpec): void {
    if (!spec.stack) return;
    // BY SEAT, ZONE and COUNT, the `dropStaleContinuousEffects` shape: a
    // reference carries `nth`, so the name must still be present at least
    // `nth + 1` times in that seat's own zone — a `count` the admin lowered is
    // a throw at load that a presence-only check waves through.
    const available = new Map<string, number>();
    for (const card of spec.cards) {
        const key = `${card.owner}:${card.zone ?? "battlefield"}:${presentedEntryName(card)}`;
        available.set(key, (available.get(key) ?? 0) + (card.count ?? 1));
    }
    const has = (
        seat: "me" | "opp",
        zone: "battlefield" | "graveyard",
        name: string,
        nth: number
    ) => (available.get(`${seat}:${zone}:${name}`) ?? 0) > nth;

    const resolves = spec.stack.every((item) => {
        if (
            item.kind === "ability" &&
            !has(
                item.sourceSeat ?? item.controller,
                "battlefield",
                item.name,
                item.sourceNth ?? 0
            )
        ) {
            return false;
        }
        return (item.targets ?? []).every((target) => {
            if (target.kind === "permanent") {
                return has(
                    target.seat,
                    "battlefield",
                    target.name,
                    target.nth ?? 0
                );
            }
            if (target.kind === "graveyard-card") {
                return has(
                    target.seat,
                    "graveyard",
                    target.name,
                    target.nth ?? 0
                );
            }
            return true;
        });
    });
    if (!resolves) delete spec.stack;
}

/**
 * CR 611.2a (issue #3488) — drop any carried continuous-effect entry whose
 * affected permanents are no longer on the assembled battlefield.
 *
 * The `dropStaleCombat` hazard exactly: `cards` is form-owned and
 * `continuousEffects` is preserved, so an admin removing a creature would save
 * an entry naming a permanent that is not there, and `buildStateFromScenario`
 * THROWS on one it cannot resolve — the golden row would simply stop loading.
 *
 * PER ENTRY, unlike the combat record: a combat is ONE declaration whose
 * attacker list and blocker indexes only mean anything together, while each
 * registry entry is an independent continuous effect. Dropping one loses that
 * effect and nothing else, so dropping the whole list would discard pumps the
 * edit never touched.
 */
function dropStaleContinuousEffects(spec: ScenarioSpec): void {
    if (!spec.continuousEffects) return;
    // PER SEAT and BY COUNT, unlike `dropStaleCombat`'s flat name set: the
    // builder resolves an entry's names against ONE battlefield
    // (`entry.affected.me` on "me"'s) and consumes one instance per name, so a
    // card the admin moved to the other seat, or a `count` they lowered, is a
    // throw at load that a presence-only check waves through.
    const available = new Map<string, number>();
    for (const card of spec.cards) {
        if ((card.zone ?? "battlefield") !== "battlefield") continue;
        const key = `${card.owner}:${presentedEntryName(card)}`;
        available.set(key, (available.get(key) ?? 0) + (card.count ?? 1));
    }
    const resolves = (
        entry: ScenarioSpec["continuousEffects"] extends (infer E)[] | undefined
            ? E
            : never
    ) => {
        const needed = new Map<string, number>();
        for (const seat of ["me", "opp"] as const) {
            for (const name of entry.affected[seat] ?? []) {
                const key = `${seat}:${name}`;
                needed.set(key, (needed.get(key) ?? 0) + 1);
            }
        }
        return [...needed].every(
            ([key, count]) => (available.get(key) ?? 0) >= count
        );
    };
    const kept = spec.continuousEffects.filter(resolves);
    if (kept.length === spec.continuousEffects.length) return;
    if (kept.length === 0) delete spec.continuousEffects;
    else spec.continuousEffects = kept;
}
