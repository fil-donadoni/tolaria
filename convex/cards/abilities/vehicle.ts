// Vehicles (CR 301.7) and the Crew keyword ability (CR 702.122).
//
// CR 301.7  — "Some artifacts have the subtype 'Vehicle.' Most Vehicles have a
//              crew ability which allows them to become artifact creatures."
// CR 301.7a — "Each Vehicle has a printed power and toughness, but it has these
//              characteristics only if it's also a creature."
// CR 301.7b — "If a Vehicle becomes a creature, it immediately has its printed
//              power and toughness."
// CR 702.122a — "Crew is an activated ability of Vehicle cards. 'Crew N' means
//              'Tap any number of other untapped creatures you control with
//              total power N or greater: This permanent becomes an artifact
//              creature until end of turn.'"
// CR 702.122b — "A creature 'crews a Vehicle' when it's tapped to pay the cost
//              to activate a Vehicle's crew ability."
//
// Modelling — everything routes through pre-existing engine machinery, no
// Vehicle-shaped special case anywhere in the GRE:
//
//  - the COST is `cost.tapOtherFilter` with the `totalPower` shape
//    (`gre/tapOtherCost.ts`) — the same pending picker, mutation and commit
//    gate Hand of Justice's fixed-cardinal "tap three untapped white creatures"
//    already used. The activating player CHOOSES which creatures to tap
//    (never auto-picked), and the picker auto-commits the moment the running
//    total reaches N (tapping more is never beneficial).
//  - `tapOtherCandidates` already excludes the source and every tapped
//    permanent, which is exactly CR 702.122a's "other untapped creatures you
//    control". Note SUMMONING SICKNESS is deliberately NOT a gate: tapping a
//    creature to crew is not a {T} symbol in that creature's own cost
//    (CR 302.6 applies only to the latter), so a creature that entered this
//    turn crews perfectly well.
//  - the EFFECT is the `animate` Op (CR 208.2/611.1, layer 4 type-add +
//    layer 7a base P/T) with the Vehicle's PRINTED power/toughness and
//    `duration: { phase: "end-of-turn" }` (CR 514.2 cleanup reverts it, via
//    `tickAllDurations`). The Vehicle keeps "Artifact" and its subtypes, so it
//    ends up an artifact creature — CR 702.122a — and crewing an ALREADY
//    crewed Vehicle is a legal no-op (`animateAsCreature`'s one-animation
//    guard), also CR-correct.

import type {
    ActivatedAbility,
    CardDefinition,
    CardSupertype,
    ManaCost,
    Rarity,
    StaticEffect,
    TriggeredAbility,
} from "../types";

/** Slug used to namespace a Vehicle's generated ability ids. */
function slugify(name: string): string {
    return (
        name
            .toLowerCase()
            // Apostrophes are DROPPED, not turned into a separator, so
            // "Smuggler's Copter" slugs to `smugglers-copter` (the id convention
            // every hand-written ability id in the catalogue already follows).
            .replace(/['’]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
    );
}

/** The board-visible keyword reminder string a Vehicle carries in
 *  `staticAbilities[]` (CR 702.122). Parametrized, so the Mechanics Registry
 *  matches it via `bindingPattern` (`/^crew \d+$/`) exactly like "rampage N" /
 *  "ward {2}". */
export function crewKeyword(n: number): string {
    return `crew ${n}`;
}

/** Oracle reminder text for Crew N, verbatim from the printed cards. */
export function crewReminderText(n: number): string {
    return `Crew ${n} (Tap any number of creatures you control with total power ${n} or more: This Vehicle becomes an artifact creature until end of turn.)`;
}

/** The enforcing CR 702.122a activated ability. `power`/`toughness` are the
 *  Vehicle's PRINTED stats (CR 301.7b) — passed by `makeVehicle` from the very
 *  same fields it puts on the definition, so the two can never diverge. */
export function crewAbility(args: {
    /** Vehicle card name — namespaces the generated ability id. */
    name: string;
    n: number;
    power: number;
    toughness: number;
}): ActivatedAbility {
    return {
        id: `${slugify(args.name)}-crew`,
        oracleText: crewReminderText(args.n),
        // CR 702.122a — "Tap any number of other untapped creatures you control
        // with total power N or greater". No mana leg, no {T} on the Vehicle
        // itself: a tapped Vehicle can still be crewed.
        cost: {
            tapOtherFilter: {
                filter: { types: "Creature", controllerRelation: "you" },
                totalPower: args.n,
            },
        },
        useStack: true,
        // The Brain skips a self-animate ability while the source is already
        // animated (`gre/moves.ts`) — crewing a crewed Vehicle is legal but
        // gains nothing.
        animatesSelf: true,
        // CR 702.122a / 301.7b — becomes an artifact creature with its PRINTED
        // P/T until end of turn. "Artifact" is already among its types, so
        // `animate`'s implicit "Creature" add is the whole type change
        // (layer 4); the base P/T set is layer 7a, and later counters / static
        // buffs still apply on top at read time (CR 613.4).
        effects: [
            {
                op: "animate",
                target: { ref: "$source" },
                power: args.power,
                toughness: args.toughness,
                duration: { phase: "end-of-turn" },
            },
        ],
    };
}

export interface VehicleSpec {
    id: string;
    name: string;
    rarity: Rarity;
    manaCost: ManaCost;
    oracleText: string;
    /** Printed power (CR 301.7a — only a characteristic while it's a creature,
     *  but declared here and used verbatim by the crew animation). */
    power: number;
    toughness: number;
    /** N in "Crew N" (CR 702.122a). */
    crew: number;
    supertypes?: CardSupertype[];
    /** Extra artifact subtypes beyond "Vehicle" (rare). */
    extraSubtypes?: string[];
    /** Keyword abilities other than crew (e.g. "flying"). The crew keyword
     *  string is appended automatically. */
    staticAbilities?: string[];
    staticEffects?: StaticEffect[];
    triggeredAbilities?: TriggeredAbility[];
    /** Activated abilities other than crew — crew is appended automatically. */
    activatedAbilities?: ActivatedAbility[];
    aiValue?: number;
}

/** Builds a Vehicle `CardDefinition` (CR 301.7): an Artifact — Vehicle with
 *  printed P/T that is NOT a creature until crewed, carrying the Crew N
 *  keyword string plus its enforcing activated ability. One call emits BOTH
 *  halves, so a Vehicle can never print the keyword and enforce nothing. */
export function makeVehicle(spec: VehicleSpec): CardDefinition {
    return {
        id: spec.id,
        name: spec.name,
        rarity: spec.rarity,
        oracleText: spec.oracleText,
        manaCost: spec.manaCost,
        // CR 301.7 — an Artifact, NOT a Creature. It gains the creature type
        // only while a resolved crew ability's animation is active.
        types: ["Artifact"],
        subtypes: ["Vehicle", ...(spec.extraSubtypes ?? [])],
        ...(spec.supertypes ? { supertypes: spec.supertypes } : {}),
        power: spec.power,
        toughness: spec.toughness,
        staticAbilities: [
            ...(spec.staticAbilities ?? []),
            crewKeyword(spec.crew),
        ],
        ...(spec.staticEffects ? { staticEffects: spec.staticEffects } : {}),
        ...(spec.triggeredAbilities
            ? { triggeredAbilities: spec.triggeredAbilities }
            : {}),
        activatedAbilities: [
            ...(spec.activatedAbilities ?? []),
            crewAbility({
                name: spec.name,
                n: spec.crew,
                power: spec.power,
                toughness: spec.toughness,
            }),
        ],
        ...(spec.aiValue !== undefined ? { aiValue: spec.aiValue } : {}),
    };
}
