// `eternalizeAbility` — declarative template for Eternalize (CR 702.129), the
// graveyard keyword that turns a dead creature card into a 4/4 black Zombie
// token copy of itself.
//
// CR 702.129a: "Eternalize [cost]" means "[cost], Exile this card from your
//   graveyard: Create a token that's a copy of this card, except it's a 4/4
//   black Zombie [card's subtypes] with no mana cost. Eternalize only as a
//   sorcery." This activated ability functions only while this card is in your
//   graveyard.
// CR 702.129b: Eternalize's token is not a copy of the exiled card's TOKEN-ness
//   or of any counters/effects on it — a copy effect copies copiable values
//   only (CR 707.2), which is exactly what `applyCopy` does.
//
// Eternalize is engine/cost-system infrastructure, NOT a new Effect Script Op:
// the only keyword-specific parts are the graveyard-zone permission, the
// exile-this-from-your-graveyard cost, the sorcery-speed restriction, and the
// CR 707.2 "except" clause — all four already expressible. It rides four
// existing seams plus one extension:
//   - `ActivatedAbility.activateFromGraveyard` — `activateAbility`
//     (`convex/game.ts`) locates the source in its OWNER's graveyard and gates
//     on this flag (the seam Ashen Ghoul opened, issue #737).
//   - `ActivatedAbility.cost.exileThis` — the source moves graveyard → exile at
//     COMMIT, so a cancelled mana payment leaves the graveyard untouched
//     (CR 601.2h).
//   - `ActivatedAbility.sorcerySpeedOnly` — CR 702.129a's "only as a sorcery",
//     the existing `isSorceryTiming` regime (Dauthi Voidwalker's shape).
//   - the `createTokenCopy` Op's `except` clause — CR 707.2's copiable-value
//     overrides, mapped 1:1 onto `CopyEffectOptions` by the interpreter.
//
// PARAMETRISED, not card-shaped: the cost, the base P/T, the colour, the added
// subtype and the token's own printed art are all arguments, because Embalm
// (CR 702.128a — "a white Zombie … with no mana cost", printed body kept) is
// the SAME ability shape with a different `except`. A future `embalmAbility`
// is a sibling factory over the same seam, not a redesign.
//
// The Mechanics Registry (`convex/cards/mechanicsRegistry.ts`) is the name
// authority: Eternalize is row `id: "eternalize"`.

import type { ActivatedAbility, Color, ManaCost } from "../types";

/** CR 702.129a — the base power/toughness every Eternalize token has. */
const ETERNALIZE_BASE_PT = 4;

/** CR 702.129a — the colour every Eternalize token is. */
const ETERNALIZE_COLOR: Color = "B";

/** CR 702.129a — the creature type every Eternalize token gains, in addition to
 *  the copied card's own subtypes (CR 205.1b). */
const ETERNALIZE_SUBTYPE = "Zombie";

/** Renders a `ManaCost` as its `{2}{G}{G}` reminder-text label (CR 107.1/202.1).
 *  Generic first (the codebase encodes fixed generic as a numeric `X`, see
 *  `ManaCost`), then one pip per coloured/colourless unit in WUBRG order so the
 *  label matches the printed cost's canonical ordering. */
function eternalizeCostLabel(cost: ManaCost): string {
    const generic =
        (typeof cost.X === "number" ? cost.X : 0) + (cost.generic ?? 0);
    let out = generic > 0 ? `{${generic}}` : "";
    for (const sym of ["W", "U", "B", "R", "G", "C"] as const) {
        const n = cost[sym];
        if (typeof n === "number") out += `{${sym}}`.repeat(n);
    }
    return out;
}

/** Builds the Eternalize activated ability (CR 702.129) for a card whose
 *  printed eternalize cost is `cost`. Add the returned ability to the card's
 *  `activatedAbilities`.
 *
 *  @param cost        the printed eternalize mana cost.
 *  @param subtypes    the card's own printed creature subtypes, used ONLY to
 *                     render CR 702.129a's reminder text ("a 4/4 black Zombie
 *                     Snake Druid"). The actual subtype union is computed at
 *                     resolution by the copy effect (CR 707.2), never from
 *                     this list.
 *  @param imagePrintId Scryfall print id of the card's OWN eternalize token
 *                     printing (CR 111 — cosmetic art only). Required rather
 *                     than optional: a token copy otherwise renders the
 *                     creature's card art in a creature frame, and every real
 *                     eternalize card has a printed token.
 */
export function eternalizeAbility(
    cost: ManaCost,
    subtypes: readonly string[],
    imagePrintId: string,
    id = "eternalize"
): ActivatedAbility {
    const label = eternalizeCostLabel(cost);
    const body = [ETERNALIZE_SUBTYPE, ...subtypes].join(" ");
    return {
        id,
        oracleText:
            `Eternalize ${label} (${label}, Exile this card from your graveyard: ` +
            `Create a token that's a copy of it, except it's a ` +
            `${ETERNALIZE_BASE_PT}/${ETERNALIZE_BASE_PT} black ${body} with no ` +
            `mana cost. Eternalize only as a sorcery.)`,
        // CR 702.129a — the printed eternalize mana cost plus exiling this card
        // from the graveyard. `exileThis` moves the source graveyard → exile at
        // activation commit, so a cancelled payment costs nothing.
        cost: { mana: cost, exileThis: true },
        // CR 702.129a — the ability functions only from its owner's graveyard.
        activateFromGraveyard: true,
        // CR 702.129a — "Eternalize only as a sorcery" (CR 307.5 timing).
        sorcerySpeedOnly: true,
        // CR 605.1a — not a mana ability: it uses the stack and can be
        // responded to (the card is already exiled by then — the cost was paid
        // at announcement, CR 601.2h).
        useStack: true,
        effects: [
            {
                op: "createTokenCopy",
                // CR 608.2b — the card is in EXILE by now (its own cost put it
                // there); `createTokenCopy` recovers `$source` from exile the
                // same way `moveZone` does for Ashen Ghoul's graveyard source.
                source: { ref: "$source" },
                controller: "controller",
                // CR 707.2 — the four printed exceptions.
                except: {
                    basePower: ETERNALIZE_BASE_PT,
                    baseToughness: ETERNALIZE_BASE_PT,
                    colors: [ETERNALIZE_COLOR],
                    additionalSubtypes: [ETERNALIZE_SUBTYPE],
                    noManaCost: true,
                    imagePrintId,
                },
            },
        ],
    };
}
