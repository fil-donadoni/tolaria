// MMQ — colorless cards, split by colour per ADR 0043. The registry's
// `import * as mmq from "./sets/mmq"` resolves through mmq/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition, Color, ManaCost } from "../../types";

/** CR 122.1 — the counter these lands enter with and spend. The name is shared
 *  with the Ice Age depletion DUALS (`sets/ice/colorless.ts`), which ADD one per
 *  tap and remove one at upkeep; CR 122.1 makes counters of the same name
 *  interchangeable, so the two cycles coexist on the same key by design and the
 *  behaviour difference lives entirely in the abilities that read it. */
const DEPLETION = "depletion";

/** The Mercadian Masques depletion-land cycle (CR 605.1a / 614.1c / 122.6 /
 *  701.21) — five commons that differ only by the colour they make:
 *
 *    This land enters tapped with two depletion counters on it.
 *    {T}, Remove a depletion counter from this land: Add {C}{C}. If there are
 *    no depletion counters on this land, sacrifice it.
 *
 *  Every clause is declarative, so the whole cycle is one factory rather than
 *  five closures (the `makeTalisman` precedent, `cards/abilities/index.ts`):
 *
 *   - the entry rider is the CR 614.1c self-replacement pair `entersTapped` +
 *     `entersWith.counters` — these are the first shipped LAND to use the
 *     counters half, the path `cards/entersWith.ts` calls out as latent;
 *   - the counter payment is the FIXED `cost.removeCounter` leg (CR 122.6),
 *     which the tap-for-mana paths pay through
 *     `applyManaAbilityRemoveCounterCost`;
 *   - the sacrifice is the `sacrificesSourceWhenNoCountersRemain` rider
 *     (CR 701.21), read AFTER the cost is paid, so the second activation is
 *     the one that ends the land — the mana is added first and survives it
 *     (CR 605.1a permits a mana ability to carry a non-mana effect and still
 *     resolve without the stack).
 *
 *  Two mana of ONE colour per activation, twice, then gone: the land is a
 *  Dark Ritual on a land drop, not a permanent mana source. */
function makeDepletionLand(args: {
    id: string;
    name: string;
    color: Color;
}): CardDefinition {
    const slug = args.name.toLowerCase().replaceAll(/\s+/g, "-");
    const produces = { [args.color]: 2 } as ManaCost;
    const abilityText = `{T}, Remove a depletion counter from this land: Add {${args.color}}{${args.color}}. If there are no depletion counters on this land, sacrifice it.`;
    return {
        id: args.id,
        name: args.name,
        rarity: "common",
        oracleText: `This land enters tapped with two depletion counters on it.\n${abilityText}`,
        types: ["Land"],
        entersTapped: true,
        entersWith: { counters: [{ type: DEPLETION, count: 2 }] },
        activatedAbilities: [
            {
                id: `${slug}-mana`,
                oracleText: abilityText,
                cost: {
                    tap: true,
                    removeCounter: { type: DEPLETION, count: 1 },
                },
                useStack: false,
                effect: (ctx) => {
                    ctx.addMana(produces);
                },
                manaProduced: produces,
                sacrificesSourceWhenNoCountersRemain: DEPLETION,
            },
        ],
    };
}

// compiler-gap: "{T}, Remove a depletion counter from this land: Add {G}{G}. If there are no depletion counters on this land, sacrifice it." (#2693)
export const hickoryWoodlot: CardDefinition = makeDepletionLand({
    id: "af7aafb7-6870-4d09-a191-70786766c459",
    name: "Hickory Woodlot",
    color: "G",
});

// compiler-gap: "{T}, Remove a depletion counter from this land: Add {B}{B}. If there are no depletion counters on this land, sacrifice it." (#2693)
export const peatBog: CardDefinition = makeDepletionLand({
    id: "bcc9d1e0-c8f4-4bac-90d4-8167f7a1515a",
    name: "Peat Bog",
    color: "B",
});

// compiler-gap: "{T}, Remove a depletion counter from this land: Add {W}{W}. If there are no depletion counters on this land, sacrifice it." (#2693)
export const remoteFarm: CardDefinition = makeDepletionLand({
    id: "115cab84-60d7-4bf2-9beb-b4ed7b5ceaf4",
    name: "Remote Farm",
    color: "W",
});

// compiler-gap: "{T}, Remove a depletion counter from this land: Add {R}{R}. If there are no depletion counters on this land, sacrifice it." (#2693)
export const sandstoneNeedle: CardDefinition = makeDepletionLand({
    id: "82bc7c6b-2e3d-42d1-b2bb-b37b6f34d33b",
    name: "Sandstone Needle",
    color: "R",
});

// compiler-gap: "{T}, Remove a depletion counter from this land: Add {U}{U}. If there are no depletion counters on this land, sacrifice it." (#2693)
export const saprazzanSkerry: CardDefinition = makeDepletionLand({
    id: "006871fd-2641-42cb-a2ac-a33d05fc5a35",
    name: "Saprazzan Skerry",
    color: "U",
});
