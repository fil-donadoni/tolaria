// Reusable factories for common card-shape patterns. Cards with identical
// ability/structure shapes (rule of two extraction, see
// feedback_extract_after_second.md) should call these instead of re-declaring
// the inline literal.

import type {
    ActivatedAbility,
    CardDefinition,
    Color,
    ManaCost,
} from "./types";

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
    colors: [Color, Color];
}): CardDefinition {
    const [c1, c2] = args.colors;
    const slug = args.name.toLowerCase().replaceAll(/\s+/g, "-");
    return {
        id: args.id,
        name: args.name,
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
