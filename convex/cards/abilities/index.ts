// Reusable factories for common card-shape patterns. Cards with identical
// ability/structure shapes (rule of two extraction, see
// feedback_extract_after_second.md) should call these instead of re-declaring
// the inline literal.

import type {
    ActivatedAbility,
    CardDefinition,
    Color,
    ManaCost,
    Rarity,
    SpellContext,
    TargetRequirement,
} from "../types";

/** Builds a `{T}: Add <mana>` mana ability (CR 605.1a, 605.3a — useStack false).
 *  Used by Mox Pearl/Sapphire/Jet/Ruby/Emerald, Sol Ring, Llanowar Elves and
 *  any future fixed-output mana producer. */
export function makeTapForMana(args: {
    id: string;
    oracleText: string;
    produces: ManaCost;
}): ActivatedAbility {
    const produces = args.produces;
    return {
        id: args.id,
        oracleText: args.oracleText,
        cost: { tap: true },
        effect: (ctx) => {
            ctx.addMana(produces);
        },
        useStack: false,
        manaProduced: produces,
    };
}

/** Color words used by the protection-from-X keyword (CR 702.16). Keep this
 *  in lowercase and aligned with the Oracle text — the engine's protection
 *  parser splits on the literal `protection from <color>` substring. */
type ProtectionColor = "white" | "blue" | "black" | "red" | "green";

/** Builds the static-ability strings for the classic "Knight cycle" creatures
 *  (first strike + protection from the opposing color). Used by White Knight,
 *  Black Knight; future cycles like Order of Leitbur / Order of the Ebon Hand
 *  add an activated pump on top — they reuse this baseline as their starting
 *  `staticAbilities` array. */
export const knightStaticAbilities = (
    protectionFrom: ProtectionColor
): string[] => ["first strike", `protection from ${protectionFrom}`];

const COLOR_TO_LAND_SUBTYPE: Record<Color, string> = {
    W: "Plains",
    U: "Island",
    B: "Swamp",
    R: "Mountain",
    G: "Forest",
    C: "Wastes",
};

/** Builds a non-basic dual land (CR 305.6) that taps for one of two colors.
 *  Subtypes are derived from `colors` so the same factory drives both the
 *  mana-ability shape and the rules-relevant land subtypes (landwalk,
 *  Armageddon, etc.). The mana ability follows the dual pattern from
 *  Birds of Paradise: `effect` produces the first color by default, and the
 *  `manaChoices` array exposes both options to the picker. */
export function makeDualLand(args: {
    id: string;
    name: string;
    /** Optional printed Oracle text — forwarded onto the resulting
     *  `CardDefinition` for display in the card preview and reference. */
    oracleText?: string;
    /** Printed rarity of the home-set printing (CR 206). The original duals
     *  are rare; pass through so the factory output is a complete definition. */
    rarity: Rarity;
    colors: [Color, Color];
}): CardDefinition {
    const [c1, c2] = args.colors;
    const slug = args.name.toLowerCase().replaceAll(/\s+/g, "-");
    return {
        id: args.id,
        name: args.name,
        rarity: args.rarity,
        oracleText: args.oracleText,
        types: ["Land"],
        subtypes: [COLOR_TO_LAND_SUBTYPE[c1], COLOR_TO_LAND_SUBTYPE[c2]],
        activatedAbilities: [
            {
                id: `${slug}-mana`,
                oracleText: `{T}: Add {${c1}} or {${c2}}.`,
                cost: { tap: true },
                effect: (ctx) => {
                    ctx.addMana({ [c1]: 1 });
                },
                useStack: false,
                manaChoices: [{ [c1]: 1 }, { [c2]: 1 }],
            },
        ],
    };
}

/** Builds a "Circle of Protection: <X>" enchantment (CR 615 prevention).
 *  `{1}: The next time a <X> source of your choice would deal damage to
 *  you this turn, prevent that damage.` Drives the LEA color cycle (White/
 *  Blue/Black/Green/Red), the Beta-original Circle of Protection: Black, and
 *  ATQ's Circle of Protection: Artifacts.
 *
 *  The `source` filter selects what kind of damage source can be chosen:
 *   - `{ kind: "color"; color; word }` — the LEA cycle. `colorFilter`
 *     restricts targets to sources of `color`; players can't be chosen
 *     (a player isn't a colored source).
 *   - `{ kind: "color-any"; colors; word }` — a multi-color "source of your
 *     choice" (Greater Realm of Preservation: "a black or red source").
 *     `colorFilterAny` restricts targets to sources that are AT LEAST ONE of
 *     `colors` (CR 202.2 — OR semantics); players can't be chosen.
 *   - `{ kind: "artifact"; word }` — COP: Artifacts. The target filter
 *     restricts to permanents/spells of the Artifact card type.
 *
 *  The resolve schedules a one-shot end-of-turn damage prevention against the
 *  chosen source via `preventNextDamageFromSource` (CR 615.1, 615.6). The
 *  shield is keyed on the chosen source's instance id, so the color predicate
 *  only gates the choice — once a legal source is picked, that exact source is
 *  shielded regardless of any later color change (CR 615.6). */
type CopSourceFilter =
    | { kind: "color"; color: Color; word: string }
    | { kind: "color-any"; colors: ReadonlyArray<Color>; word: string }
    | { kind: "artifact"; word: string };

/** Renders a fixed activation cost as mana symbols for oracle text (CR 107):
 *  generic `{N}` first (from numeric `X`/`C`), then colored WUBRG pips. Only
 *  the fixed forms used by Circle-of-Protection-shaped abilities are handled
 *  ({1}, {1}{W}); variable X is not expected here. */
function formatActivationCost(cost: ManaCost): string {
    const parts: string[] = [];
    const generic = (typeof cost.X === "number" ? cost.X : 0) + (cost.C ?? 0);
    if (generic > 0) parts.push(`{${generic}}`);
    for (const sym of ["W", "U", "B", "R", "G"] as const) {
        const n = cost[sym] ?? 0;
        for (let i = 0; i < n; i++) parts.push(`{${sym}}`);
    }
    return parts.join("");
}

export function makeCircleOfProtection(args: {
    id: string;
    name: string;
    oracleText?: string;
    /** Printed rarity of this Circle's printing (CR 206). The LEA cycle is
     *  uncommon; pass through so the factory output is a complete definition. */
    rarity: Rarity;
    /** Back-compat color shorthand — equivalent to
     *  `source: { kind: "color", color, word: colorWord }`. */
    color?: Color;
    colorWord?: string;
    source?: CopSourceFilter;
    /** Enchantment mana cost (CR 202). Defaults to the LEA Circle's {1}{W};
     *  Greater Realm of Preservation overrides it (it is also {1}{W}, but the
     *  factory keeps the field explicit for non-CoP reuse). */
    manaCost?: ManaCost;
    /** Activation cost of the prevention ability. Defaults to {1} (the CoP
     *  cycle); Greater Realm of Preservation uses {1}{W}. */
    activationCost?: ManaCost;
}): CardDefinition {
    const source: CopSourceFilter =
        args.source ??
        ({ kind: "color", color: args.color!, word: args.colorWord! } as const);
    // Artifact sources are matched by the Artifact card type (permanent or
    // spell); single-color sources by `colorFilter`; multi-color "X or Y
    // source" by `colorFilterAny` (CR 202.2 — OR semantics).
    const targetRequirement: TargetRequirement =
        source.kind === "artifact"
            ? {
                  type: ["Artifact", "spell"],
                  count: 1,
                  spellTypeFilter: "Artifact",
              }
            : source.kind === "color-any"
              ? {
                    type: ["any", "spell"],
                    count: 1,
                    colorFilterAny: source.colors,
                }
              : {
                    type: ["any", "spell"],
                    count: 1,
                    colorFilter: source.color,
                };
    const activationCost: ManaCost = args.activationCost ?? { X: 1 };
    // CR 107 — render the activation cost as mana symbols for the ability's
    // oracle text ({N} generic, then WUBRG). Keeps the LEA cycle's "{1}:" and
    // Greater Realm's "{1}{W}:" in sync with the actual cost field.
    const costPrefix = formatActivationCost(activationCost);
    return {
        id: args.id,
        name: args.name,
        rarity: args.rarity,
        oracleText: args.oracleText,
        manaCost: args.manaCost ?? { X: 1, W: 1 },
        types: ["Enchantment"],
        activatedAbilities: [
            {
                id: "cop-prevent",
                oracleText: `${costPrefix}: The next time a ${source.word.toLowerCase()} source of your choice would deal damage to you this turn, prevent that damage.`,
                cost: { mana: activationCost },
                useStack: true,
                targetRequirement,
                resolve: (ctx: SpellContext) => {
                    const [target] = ctx.targets;
                    if (!target) return;
                    if (target.type === "player") return; // not a valid source
                    ctx.preventNextDamageFromSource(target.id, ctx.controller, {
                        phase: "end-of-turn",
                    });
                },
            },
        ],
    };
}
