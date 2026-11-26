// Station (CR 702.184) and station cards (CR 721) — the WHOLE mechanic in one
// module, expanded at the `getDefinition` seam the way Class level bars are
// (`classLevels.ts`): the station symbols are DATA on the definition
// (`CardDefinition.stationThresholds`), so a second station card is a
// card-file edit and no engine change.
//
// CR 702.184a: "Station" means "Tap another untapped creature you control: Put
//   a number of charge counters on this permanent equal to the tapped
//   creature's power. Activate only as a sorcery."
// CR 702.184b: each card printed with a station ability is a station card,
//   with station symbols that are themselves keyword abilities (CR 721).
// CR 702.184c: static abilities may make a station ability use a
//   characteristic other than the tapped creature's power. No card in the
//   catalogue does; the count is the ONE `$tapped.power` read below, which is
//   where such an ability would substitute its characteristic.
// CR 721.2a: "{N+}[abilities]" means "As long as this permanent has N or more
//   charge counters on it, it has [abilities]."
// CR 721.2b: "{N+}[abilities][P/T]" means "As long as this permanent has N or
//   more charge counters on it, it has [abilities] and is a creature with base
//   power and toughness [P/T] in addition to its other types."
// CR 721.2c: while in any zone other than the battlefield, station cards do not
//   have power or toughness — a station card's definition declares no
//   top-level `power`/`toughness`; its only P/T is the CR 721.2b box, which
//   lives on the threshold and applies only on the battlefield.
// CR 721.4: an ability not preceded by a station symbol is treated normally —
//   declared on the definition like any other card's, never touched here — and
//   the station ability itself is had at all times, whatever the charge.
//
// Primitives reused, none added for the threshold half:
//   - the `counters` Op (`action: "add"`) on `$source`, the count read off the
//     implicit `$tapped` binding (`interpreter.ts`, the permanent the
//     single-pick `tapOtherFilter` leg tapped, CR 608.2h last-known
//     information once it has left);
//   - `tapOtherFilter { count: 1 }` (the Hand of Justice leg, which already
//     excludes the source — "another") and `sorcerySpeedOnly` (CR 307.5);
//   - per striation: a layer-4 `type-add` + layer-7b `pt-set` for the P/T box,
//     a layer-6 `keyword-grant` per keyword, and the section gates shared with
//     Class (`sectionGates.ts`) for printed statics and triggers; an activated
//     ability carries the declarative `functionsAtStationCharge`, read by
//     `stationChargeGateOpen` wherever `exhaustGateOpen` is read.
//
// Mechanics Registry (`convex/cards/mechanicsRegistry.ts`) row `id: "station"`
// is the name authority; its `binding` points back here.

import type {
    ActivatedAbility,
    CardDefinition,
    PermanentView,
    StaticEffect,
    StationThresholdDefinition,
    TriggeredAbility,
} from "../types";
import { gateSectionStatic, gateSectionTrigger } from "./sectionGates";

/** CR 702.184a / 122.1 — the counter type a station ability puts on its
 *  permanent and every station symbol reads. */
export const CHARGE_COUNTER = "charge";

/** The station keyword ability's id on every station card. */
export const STATION_ABILITY_ID = "station";

/** CR 702.184a — the reminder line the station ability shows on the stack. */
export const STATION_ORACLE_TEXT =
    "Station (Tap another untapped creature you control: Put a number of charge counters on this permanent equal to the tapped creature's power. Station only as a sorcery.)";

/** CR 721.2a — the charge counters on `permanent`. */
export function stationChargeOf(
    permanent: Pick<PermanentView, "counters">
): number {
    return permanent.counters?.[CHARGE_COUNTER] ?? 0;
}

/** CR 721.2a (issue #10528) — whether `ability` is one `source` HAS right now:
 *  an ability printed in the `{N+}` striation exists only while the permanent
 *  has N or more charge counters on it. True for every other ability. The ONE
 *  reader of `functionsAtStationCharge`, called wherever `exhaustGateOpen` is
 *  (`activationPreconditionViolation`, the mana-tap sites, the client listing),
 *  so the server, the Bot and the affordance cannot disagree. */
export function stationChargeGateOpen(
    ability: Pick<ActivatedAbility, "functionsAtStationCharge">,
    source: Pick<PermanentView, "counters">
): boolean {
    const charge = ability.functionsAtStationCharge;
    return charge === undefined || stationChargeOf(source) >= charge;
}

/** CR 702.184a — the station keyword ability. */
export function buildStationAbility(): ActivatedAbility {
    return {
        id: STATION_ABILITY_ID,
        oracleText: STATION_ORACLE_TEXT,
        cost: {
            // "Tap another untapped creature you control" — the tap-other leg
            // excludes the source itself, and its candidates are untapped.
            tapOtherFilter: {
                filter: { types: "Creature", controllerRelation: "you" },
                count: 1,
            },
        },
        // CR 702.184a — "Activate only as a sorcery" (CR 307.5).
        sorcerySpeedOnly: true,
        useStack: true,
        effects: [
            {
                op: "counters",
                action: "add",
                counter: CHARGE_COUNTER,
                target: { ref: "$source" },
                // CR 702.184a / 608.2h — "equal to the tapped creature's
                // power", read as the ability resolves.
                count: { ref: "$tapped.power" },
            },
        ],
    };
}

/** CR 721.2 — why a threshold set cannot describe a printed station card, or
 *  `null`: no symbol, a symbol below 1, symbols out of order or repeated, or
 *  more than one P/T box. The ONE authority on the shape: the engine throws on
 *  it and the Oracle compiler refuses the card on it. */
export function stationThresholdsViolation(
    thresholds: readonly Pick<
        StationThresholdDefinition,
        "charge" | "creature"
    >[]
): string | null {
    if (thresholds.length === 0) {
        return "a station card has at least one station symbol (CR 721.1)";
    }
    let boxes = 0;
    for (let i = 0; i < thresholds.length; i++) {
        const { charge, creature } = thresholds[i];
        if (!Number.isInteger(charge) || charge < 1) {
            return `station symbol {${charge}+} is not a positive integer (CR 721.2)`;
        }
        if (i > 0 && charge <= thresholds[i - 1].charge) {
            return `station symbols are printed in increasing order (CR 721.2) — {${thresholds[i - 1].charge}+} then {${charge}+}`;
        }
        if (creature) boxes++;
    }
    if (boxes > 1) {
        return "a station card has at most one power/toughness box (CR 721.2b)";
    }
    return null;
}

/** The `{N+}` predicate every gate of one striation shares. */
function atCharge(charge: number): (source: PermanentView) => boolean {
    return (source) => stationChargeOf(source) >= charge;
}

/** CR 721.2a/b — the static effects one striation stands for. */
function thresholdStatics(
    threshold: StationThresholdDefinition
): StaticEffect[] {
    const inForce = atCharge(threshold.charge);
    const onSelf = (target: PermanentView, source: PermanentView): boolean =>
        target.id === source.id && inForce(source);
    const out: StaticEffect[] = [];
    if (threshold.creature) {
        // CR 721.2b — "is a creature … in addition to its other types": layer
        // 4 (CR 613.1d), recomputed at every read.
        out.push({ kind: "type-add", applies: onSelf, types: ["Creature"] });
        // CR 721.2b — "with base power and toughness [P/T]": layer 7b
        // (CR 613.4b).
        out.push({
            kind: "pt-set",
            applies: onSelf,
            power: threshold.creature.power,
            toughness: threshold.creature.toughness,
        });
    }
    const keywordList = threshold.keywords ?? [];
    for (let i = 0; i < keywordList.length; i++) {
        out.push({
            kind: "keyword-grant",
            // CR 613.5 (issue #1711) — the predicate reads counters.
            dependsOnCounters: true,
            applies: onSelf,
            keyword: keywordList[i],
        });
    }
    const effectList = threshold.staticEffects ?? [];
    for (let i = 0; i < effectList.length; i++) {
        out.push({
            ...gateSectionStatic(effectList[i], inForce),
            dependsOnCounters: true,
        } as StaticEffect);
    }
    return out;
}

/** CR 702.184 / 721 — expand `stationThresholds[]` into the abilities a station
 *  card stands for: the station ability (CR 702.184a, had at all times, CR
 *  721.4) plus every ability printed in each striation, charge-gated (CR
 *  721.2a/b). A no-op for every other card. Pure; idempotent on the station
 *  ability's id, because token copies re-enter the same seam. */
export function expandStationThresholds(def: CardDefinition): CardDefinition {
    const thresholds = def.stationThresholds;
    if (!thresholds || thresholds.length === 0) return def;
    const violation = stationThresholdsViolation(thresholds);
    if (violation !== null) {
        throw new Error(`expandStationThresholds: ${violation}`);
    }
    const existingActivated = def.activatedAbilities ?? [];
    if (existingActivated.some((a) => a.id === STATION_ABILITY_ID)) return def;

    const activated: ActivatedAbility[] = [buildStationAbility()];
    const triggered: TriggeredAbility[] = [];
    const statics: StaticEffect[] = [];
    for (let i = 0; i < thresholds.length; i++) {
        const threshold = thresholds[i];
        const abilityList = threshold.activatedAbilities ?? [];
        for (let j = 0; j < abilityList.length; j++) {
            activated.push({
                ...abilityList[j],
                functionsAtStationCharge: threshold.charge,
            });
        }
        const triggerList = threshold.triggeredAbilities ?? [];
        for (let j = 0; j < triggerList.length; j++) {
            triggered.push(
                gateSectionTrigger(triggerList[j], atCharge(threshold.charge))
            );
        }
        statics.push(...thresholdStatics(threshold));
    }
    return {
        ...def,
        activatedAbilities: existingActivated.concat(activated),
        triggeredAbilities: (def.triggeredAbilities ?? []).concat(triggered),
        staticEffects: (def.staticEffects ?? []).concat(statics),
    };
}
