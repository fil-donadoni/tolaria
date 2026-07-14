// On-tap-for-mana bonus prediction (CR 605.4) — the declarative half of the
// Wild-Growth-style triggered mana abilities.
//
// A triggered mana ability like Wild Growth ("Whenever enchanted land is tapped
// for mana, its controller adds an additional {G}") produces its extra mana
// inside an opaque `resolve` closure that runs at the moment the land is tapped
// (CR 605.4 — off the stack, same game action). The ENGINE handles that
// correctly. What the closure hides from the rest of the engine is the
// PREDICTIVE question "how much mana could this land make if I tapped it?",
// asked by two potential-mana models that never actually tap anything:
//
//   * the castability gate `canPotentiallyPayCost` (rules.ts) — decides whether
//     the "Cast" affordance is shown at all, and
//   * the human auto-tap solver `buildAutoTapSources` (autoTap.ts) — plans a
//     minimal set of lands to tap.
//
// Both read the land's OWN mana ability and were blind to the aura's bonus, so
// a Craw Wurm castable off five lands + Wild Growth looked one mana short. This
// module exposes the bonus declaratively (`TriggeredAbility.manaBonusForPotential`,
// set by the `tappedTrigger` factory) so both models see it, without executing
// the closure.
//
// PURE and prediction-only: nothing here changes how a tap trigger resolves.
//
// Scope (documented simplification): bonuses are gathered from the ACTING
// player's own battlefield (the one passed in). A globally-worded rider an
// OPPONENT controls (their Gauntlet of Might buffing your Mountain tap) is not
// modelled — you almost always control your own mana rocks/auras, and the real
// tap still adds the mana; only the prediction under-counts in that rare case.

import type { Color, TapManaBonusForPotential } from "../cards/types";
import type { CardInstanceState } from "./state";
import { matchesPermanentFilter } from "../cards/filters";
import { tryGetDefinition } from "../cards";
import { abilitiesSuppressed, getProducibleColors, MANA_COLORS } from "./constants";

type BonusAmount = TapManaBonusForPotential["amount"];

/** Does `bonus` (declared on `source`) fire on a for-mana tap of `land`? */
function bonusAppliesToLand(
    source: CardInstanceState,
    bonus: TapManaBonusForPotential,
    land: CardInstanceState
): boolean {
    if (bonus.appliesTo === "host") {
        // Aura rider (Wild Growth / Fertile Ground): only the enchanted land.
        return source.attachedTo === land.id;
    }
    // Global rider keyed on a land filter (Gauntlet → Mountain, Mana Flare →
    // any Land). Reuses the canonical permanent matcher against the land's live
    // characteristics.
    return matchesPermanentFilter(
        {
            id: land.id,
            types: land.types,
            subtypes: land.subtypes,
            staticAbilities: land.staticAbilities ?? [],
            controllerId: land.controllerId,
        },
        bonus.appliesTo.filter
    );
}

/** The active on-tap-for-mana bonus AMOUNTS that apply to `land` right now,
 *  gathered from every Wild-Growth-style triggered mana ability on
 *  `battlefield` (CR 605.4). A permanent whose abilities are suppressed
 *  (CR 613.1f — Humility / Blood Moon) contributes nothing. */
export function getActiveTapManaBonuses(
    battlefield: readonly CardInstanceState[],
    land: CardInstanceState
): BonusAmount[] {
    const out: BonusAmount[] = [];
    for (const perm of battlefield) {
        if (abilitiesSuppressed(perm)) continue;
        const cardId = (perm.card as { id?: string }).id;
        const def = cardId ? tryGetDefinition(cardId) : undefined;
        if (!def?.triggeredAbilities) continue;
        for (const ability of def.triggeredAbilities) {
            const bonus = ability.manaBonusForPotential;
            if (!bonus) continue;
            if (!bonusAppliesToLand(perm, bonus, land)) continue;
            out.push(bonus.amount);
        }
    }
    return out;
}

/** Flexible potential-mana UNITS (one `Set<Color>` per extra mana) the active
 *  bonuses grant when `land` is tapped for mana — the shape
 *  `coloredCostLeftover` (rules.ts) counts. Errs toward affordable, matching
 *  that gate's documented bias: an `anyColor` bonus (Fertile Ground) is a fully
 *  flexible coloured unit; a `perProducedColor` bonus (Mana Flare) is the set of
 *  colours the land itself produces. */
export function tapManaBonusUnits(
    battlefield: readonly CardInstanceState[],
    land: CardInstanceState
): Set<Color>[] {
    const units: Set<Color>[] = [];
    for (const amount of getActiveTapManaBonuses(battlefield, land)) {
        if (amount.kind === "fixed") {
            for (const c of MANA_COLORS) {
                for (let i = 0; i < (amount.mana[c] ?? 0); i++) {
                    units.push(new Set<Color>([c]));
                }
            }
        } else if (amount.kind === "anyColor") {
            // "one mana of any colour" — W/U/B/R/G (colourless is not a colour).
            const any = MANA_COLORS.filter((c) => c !== "C");
            for (let i = 0; i < amount.count; i++) {
                units.push(new Set<Color>(any));
            }
        } else {
            // perProducedColor — the colours the land could itself make.
            const produced = getProducibleColors(land);
            if (produced.size === 0) continue;
            for (let i = 0; i < amount.count; i++) {
                units.push(new Set<Color>(produced));
            }
        }
    }
    return units;
}

/** Concrete extra mana to ADD to a single auto-tap source option (autoTap.ts),
 *  given that option's own produced mana. Conservative so the solver never
 *  claims a plan the tap can't honour: a `fixed` bonus adds its exact colours; a
 *  `perProducedColor` bonus adds its count of the option's single produced
 *  colour (the common mono-land case) and otherwise falls back to colourless; an
 *  `anyColor` bonus is modelled as colourless (it pays the generic portion — the
 *  player picks the actual colour when the trigger resolves, which the tap plan
 *  can't pre-encode). */
export function extraTapManaForOption(
    battlefield: readonly CardInstanceState[],
    land: CardInstanceState,
    optionMana: Partial<Record<Color, number>>
): Partial<Record<Color, number>> {
    const extra: Partial<Record<Color, number>> = {};
    const add = (c: Color, n: number) => {
        if (n > 0) extra[c] = (extra[c] ?? 0) + n;
    };
    for (const amount of getActiveTapManaBonuses(battlefield, land)) {
        if (amount.kind === "fixed") {
            for (const c of MANA_COLORS) add(c, amount.mana[c] ?? 0);
        } else if (amount.kind === "anyColor") {
            add("C", amount.count); // generic proxy — colour chosen at resolve
        } else {
            const colours = MANA_COLORS.filter(
                (c) => c !== "C" && (optionMana[c] ?? 0) > 0
            );
            if (colours.length === 1) add(colours[0], amount.count);
            else add("C", amount.count); // 0 or 2+ produced colours → safe proxy
        }
    }
    return extra;
}
