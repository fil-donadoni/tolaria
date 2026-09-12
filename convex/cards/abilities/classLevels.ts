// Class cards (CR 716) — the class level bar, expanded at the `getDefinition`
// seam (ADR 0078's `chapterAbilities` shape, the closest sibling: a printed
// text-box SECTION declared as data and desugared into ordinary engine
// abilities, so a second Class card is a card-file edit and no engine change).
//
// CR 716.2: "A class level bar is a keyword ability that represents both an
//   activated ability and a static ability. A class level bar includes the
//   activation cost of its activated ability and a level number. Any abilities
//   printed within the same text box section as the class level bar are part
//   of its static ability."
// CR 716.2a: "'[Cost]: Level N — [Abilities]' means '[Cost]: This Class's level
//   becomes N. Activate only if this Class is level N-1 and only as a sorcery'
//   and 'As long as this Class is level N or greater, it has [abilities].'"
// CR 716.2b: "A level is a designation that any permanent can have. A Class
//   retains its level even if it stops being a Class. Levels are not a copiable
//   characteristic."
// CR 716.2d: "If a rule or effect refers to a permanent's level and that
//   permanent doesn't have a level, it is treated as though its level is 1."
// CR 716.3: "Any ability printed on a Class card that isn't preceded by a class
//   level bar is treated normally. In particular, the Class has the ability
//   printed in its top text box section at all times." — needs NO code: a
//   top-section ability is declared on the definition like any other card's,
//   and this expander never touches it.
// CR 716.4 / 711.7: level counters do not interact with Class cards. That is
//   why the level is `CardInstanceState.classLevel`, a plain field, and NOT a
//   counter type: a counter would be visible to every counter-removal and
//   counter-doubling effect in the pool, which is the exact trap CR 711.7
//   warns about.
//
// What this module does NOT do, deliberately:
//   - it does not invent a second "level" concept for leveler cards — Level Up
//     (CR 702.87) keeps its own level COUNTERS in `abilities/levelUp.ts`, and
//     the two never read each other's storage (CR 716.4);
//   - it does not gate the level-up activation with a `canActivate` closure.
//     `gre/moves.ts` and `gre/evaluate.ts` both skip ANY ability carrying one,
//     so a closure-gated level bar would be structurally invisible to the Bot —
//     the same trap Boast hit (CR 702.142a, issue #2375), solved the same way:
//     a DECLARATIVE field (`ActivatedAbility.classLevelBar`) every surface
//     reads.

import type {
    ActivatedAbility,
    CardDefinition,
    ClassLevelBarDefinition,
    EffectOp,
    GameEvent,
    GateableStaticEffect,
    ManaCost,
    PermanentView,
    TargetRequirement,
    TriggeredAbility,
    TriggerStateView,
} from "../types";

/** CR 205.3h — the enchantment subtype that makes a permanent a Class. */
export const CLASS_SUBTYPE = "Class";

/** CR 716.2a/716.2d — a permanent's class level: the stored designation, or 1
 *  when it has none. The single reader; nothing else may spell
 *  `?? 1` by hand. */
export function classLevelOf(
    permanent: Pick<PermanentView, "classLevel">
): number {
    return permanent.classLevel ?? 1;
}

/** CR 716.2a (issue #3234) — the ONE authority on whether a Class-level gate
 *  forbids activating `ability` on `permanent`. Returns a human-readable reason
 *  or `null` when nothing forbids it.
 *
 *  Two gates, from the two halves of CR 716.2a:
 *   - `classLevelBar: N` — the bar itself: "Activate only if this Class is
 *     level N-1". This is what makes levels gained one at a time and upward
 *     only: at level L the bar for L+1 is the ONLY one that passes, so there is
 *     no way to skip a level and no way to re-take one already gained.
 *   - `functionsAtClassLevel: N` — an ability printed in the level-N section:
 *     the Class only HAS it "as long as this Class is level N or greater", and
 *     an ability an object does not have cannot be activated (CR 602.1).
 *
 *  Shared verbatim by `assertActivationTimingLegal` (`convex/gre/activation.ts`, the
 *  server authority), `enumerateAbilityMoves` / `hasFlexibleActivation`
 *  (`gre/moves.ts` / `gre/evaluate.ts`, the Bot) and `isActivationTimingAllowed`
 *  (`src/lib/card-utils.ts`, the UI affordance) — the `loyaltyActivationViolation`
 *  shape, so the enumerator can never offer an activation the server rejects. */
export function classLevelActivationViolation(
    permanent: Pick<PermanentView, "classLevel">,
    ability: Pick<ActivatedAbility, "classLevelBar" | "functionsAtClassLevel">
): string | null {
    const level = classLevelOf(permanent);
    if (
        ability.classLevelBar !== undefined &&
        level !== ability.classLevelBar - 1
    ) {
        return `Activate only if this Class is level ${ability.classLevelBar - 1}`;
    }
    if (
        ability.functionsAtClassLevel !== undefined &&
        level < ability.functionsAtClassLevel
    ) {
        return `This Class has that ability only at level ${ability.functionsAtClassLevel} or greater`;
    }
    return null;
}

/** Deterministic ability id for the class level bar that grants level N,
 *  derived from the level so it is stable across expansions and unique within
 *  the card. */
export const classLevelBarId = (level: number): string =>
    `class-level-${level}`;

/** CR 716.1/716.2 — rejects a bar set that cannot describe a printed Class:
 *  no bars at all, a bar at level 1 or below (a Class on the battlefield is
 *  already level 1, so nothing activates to reach it), duplicated levels, or
 *  levels out of order / with a gap (CR 716.2a's "activate only if this Class
 *  is level N-1" makes every level after the first reachable ONLY from its
 *  immediate predecessor — a gap would strand every bar above it). Throws on the
 *  card's FIRST definition read (`expandDefinition` memoizes, so it is once per
 *  card, not once per call), which every catalogue sweep in the gate performs —
 *  so a malformed Class is a red catalogue and never a permanent with an
 *  unreachable level. */
function assertWellFormedBars(bars: readonly ClassLevelBarDefinition[]): void {
    if (bars.length === 0) {
        throw new Error(
            "expandClassLevelBars: a Class card has at least one class level bar (CR 716.1)"
        );
    }
    for (let i = 0; i < bars.length; i++) {
        const expected = i + 2;
        if (bars[i].level !== expected) {
            throw new Error(
                `expandClassLevelBars: class level bars are consecutive from level 2 (CR 716.2a) — expected level ${expected}, got ${bars[i].level}`
            );
        }
        // CR 716.2 — the bar's PRINTED price and the price the engine charges
        // are the same number. `costLabel` exists only because the Oracle line
        // is text, and two spellings of one fact drift silently: the ability's
        // `oracleText` is rendered from the label while the badge renders the
        // mana symbols from `cost`, so a typo would ship a bar whose printed
        // and paid costs differ with nothing red.
        const printed = manaCostLabel(bars[i].cost);
        if (printed !== bars[i].costLabel) {
            throw new Error(
                `expandClassLevelBars: class level bar ${bars[i].level}'s costLabel "${bars[i].costLabel}" does not spell its cost (${printed})`
            );
        }
    }
}

/** CR 107.4 / 202.1 — a `ManaCost` as it is PRINTED: the generic pip first,
 *  then the five colours in WUBRG order, then colorless. The one place the
 *  engine spells a cost back out, so a bar's `costLabel` can be checked against
 *  the cost it claims to print. */
function manaCostLabel(cost: ManaCost): string {
    const pips: string[] = [];
    if (cost.X === "X") {
        for (let i = 0; i < (cost.xFactor ?? 1); i++) pips.push("X");
    } else if (typeof cost.X === "number" && cost.X > 0) {
        pips.push(String(cost.X));
    }
    if (cost.generic !== undefined && cost.generic > 0) {
        pips.push(String(cost.generic));
    }
    for (const colour of ["W", "U", "B", "R", "G"] as const) {
        for (let i = 0; i < (cost[colour] ?? 0); i++) pips.push(colour);
    }
    for (let i = 0; i < (cost.C ?? 0); i++) pips.push("C");
    return pips.map((pip) => `{${pip}}`).join("");
}

/** CR 716.2a — the activated half of a class level bar: "[Cost]: This Class's
 *  level becomes N. Activate only if this Class is level N-1 and only as a
 *  sorcery."
 *
 *  `classLevelBar: N` is the DECLARATIVE form of the "only if this Class is
 *  level N-1" restriction — see this module's header for why it is not a
 *  `canActivate` closure. `sorcerySpeedOnly` is the CR 307.5 timing template
 *  every activation surface already honours. */
function buildLevelBarAbility(bar: ClassLevelBarDefinition): ActivatedAbility {
    const effects: EffectOp[] = [
        {
            op: "setLevel",
            target: { ref: "$source" },
            level: bar.level,
        },
    ];
    return {
        id: classLevelBarId(bar.level),
        oracleText: `${bar.costLabel}: Level ${bar.level}`,
        cost: { mana: bar.cost },
        sorcerySpeedOnly: true,
        useStack: true,
        classLevelBar: bar.level,
        effects,
    };
}

/** CR 716.2a — "as long as this Class is level N or greater, it has
 *  [abilities]", applied to a static effect printed in the level-N section.
 *  The gate reads the SOURCE's level (the Class itself), never the target's. */
function gateStaticEffect(
    effect: GateableStaticEffect,
    level: number
): GateableStaticEffect {
    const applies = effect.applies as (
        target: PermanentView,
        source: PermanentView,
        ctx: unknown
    ) => boolean;
    return {
        ...effect,
        applies: (target: PermanentView, source: PermanentView, ctx: unknown) =>
            classLevelOf(source) >= level && applies(target, source, ctx),
    } as GateableStaticEffect;
}

/** CR 716.2a — the same grant for a triggered ability printed in the level-N
 *  section: it is not an ability of the Class below level N, so it cannot
 *  trigger there (CR 603.2 — only an ability the object HAS can trigger). */
function gateTriggeredAbility(
    ability: TriggeredAbility,
    level: number
): TriggeredAbility {
    const matches = ability.matches;
    return {
        ...ability,
        classLevelSection: level,
        matches: (
            event: GameEvent,
            self: PermanentView,
            state?: TriggerStateView
        ) => classLevelOf(self) >= level && matches(event, self, state),
    };
}

/** CR 716.2a — the same grant for an activated ability printed in the level-N
 *  section. Declarative (`functionsAtClassLevel`) for the same reason the bar's
 *  own gate is: a `canActivate` closure is invisible to the Bot enumerator. */
function gateActivatedAbility(
    ability: ActivatedAbility,
    level: number
): ActivatedAbility {
    return { ...ability, functionsAtClassLevel: level };
}

/** CR 716.2 — expand `classLevelBars[]` into the abilities the printed bars
 *  stand for: one activated ability per bar (CR 716.2a's first half) plus every
 *  ability printed in that bar's section, level-gated (CR 716.2a's second
 *  half). A no-op for every non-Class card, so it chains freely with the other
 *  `getDefinition` expanders. Pure: never mutates `def`. Re-expansion is
 *  idempotent (guarded on the synthesized ability ids), which matters because
 *  token copies re-enter the same seam. */
export function expandClassLevelBars(def: CardDefinition): CardDefinition {
    const bars = def.classLevelBars;
    if (!bars || bars.length === 0) return def;
    assertWellFormedBars(bars);

    const existingActivated = def.activatedAbilities ?? [];
    const barAbilities = bars.map(buildLevelBarAbility);
    if (
        existingActivated.some((a) =>
            barAbilities.some((bar) => bar.id === a.id)
        )
    ) {
        return def;
    }

    const sectionActivated: ActivatedAbility[] = [];
    const sectionTriggered: TriggeredAbility[] = [];
    const sectionStatics: GateableStaticEffect[] = [];
    for (const bar of bars) {
        for (const ability of bar.activatedAbilities ?? []) {
            sectionActivated.push(gateActivatedAbility(ability, bar.level));
        }
        for (const ability of bar.triggeredAbilities ?? []) {
            sectionTriggered.push(gateTriggeredAbility(ability, bar.level));
        }
        for (const effect of bar.staticEffects ?? []) {
            sectionStatics.push(gateStaticEffect(effect, bar.level));
        }
    }

    return {
        ...def,
        activatedAbilities: [
            ...existingActivated,
            ...barAbilities,
            ...sectionActivated,
        ],
        triggeredAbilities: [
            ...(def.triggeredAbilities ?? []),
            ...sectionTriggered,
        ],
        staticEffects: [...(def.staticEffects ?? []), ...sectionStatics],
    };
}

/** CR 716.2a — "When this Class becomes level N, …", the trigger shape every
 *  Class card's mid-section uses. Fires on the `LEVEL_GAINED` event the
 *  `setLevel` Op emits, for THIS permanent, for exactly that level: levels are
 *  gained one at a time and only upward (CR 716.2a's "only if this Class is
 *  level N-1"), so it fires once and is never re-armed by a later level.
 *
 *  Author it inside its own bar's `triggeredAbilities` — `expandClassLevelBars`
 *  then adds CR 716.2a's "as long as … level N or greater" gate on top, so the
 *  ability genuinely does not exist below level N. */
export function classLevelGainedTrigger(args: {
    level: number;
    oracleText: string;
    targetRequirement?: TargetRequirement;
    effects: EffectOp[];
}): TriggeredAbility {
    return {
        id: `class-becomes-level-${args.level}`,
        oracleText: args.oracleText,
        event: "LEVEL_GAINED",
        ...(args.targetRequirement
            ? { targetRequirement: args.targetRequirement }
            : {}),
        matches: (event, self) =>
            event.type === "LEVEL_GAINED" &&
            event.instanceId === self.id &&
            event.level === args.level,
        effects: args.effects,
    };
}
