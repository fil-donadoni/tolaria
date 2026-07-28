// Protection keyword ability primitives (CR 702.16).
//
// Protection is stored on a card as `staticAbilities[]` entries of the form
// `"protection from <color-name>"`, including the colorless variant
// (`"protection from colorless"`, issue #684/#928 — Giver of Runes), plus the
// PLAYER-quality form `"protection from each of your opponents"` (CR 702.16j,
// issue #1748 — Figure of Fable), whose quality is resolved live against the
// protected permanent's own controller. Protection from everything on a
// PERMANENT, and other non-colour qualities (CR 702.16h/k), are not yet
// implemented. (`playerHasProtectionFromEverything` below is the separate
// PLAYER-scoped protection The One Ring grants, CR 115.4.)
//
// Callers:
//   - targeting (CR 702.16b): rules.ts::getLegalTargets, game.ts target check
//   - damage    (CR 702.16e): state.ts::dealDamage, phases.ts::applyAllCombatDamage
//   - blocking  (CR 702.16f): combat.ts::validateBlockerEligibility
//
// The Aura clause (702.16c) is honoured at attach time and by the SBA
// fall-off pass; the Equipment clause (702.16d) is still pending project-wide
// (tracked-by: #1748 follow-up in the protection module's own backlog — it is
// unimplemented for the COLOUR form too, so the player form inherits exactly
// the same coverage rather than adding a new gap).

import type { CardInstanceState } from "./state";
import type { Color } from "../cards/types";
import { STATIC_EFFECT_CTX } from "./layers";
import { applySubstitution } from "./textChanges";

const PROTECTION_FROM_COLOR_REGEX =
    /^protection from (white|blue|black|red|green|colorless)$/;
const PROTECTION_COLOR_NAME_TO_CODE: Record<string, Color> = {
    white: "W",
    blue: "U",
    black: "B",
    red: "R",
    green: "G",
    colorless: "C",
};

/** CR 702.16j — the PLAYER-quality protection string. The quality is "each of
 *  your opponents", i.e. every player other than the protected permanent's own
 *  controller, re-derived live so a control-change effect moves the protection
 *  with the permanent (CR 109.4 / 702.16). Figure of Fable's final stage. */
export const PROTECTION_FROM_EACH_OPPONENT =
    "protection from each of your opponents";

/** The card's protection ability strings, read through any active color-word
 *  text changes (CR 612.6 — Sleight of Mind). Shared by the colour parse and
 *  the player-quality check so both see the same rewritten text. */
function liveProtectionAbilities(
    card: Pick<CardInstanceState, "staticAbilities"> &
        Partial<Pick<CardInstanceState, "subtypes" | "textChanges">>
): readonly string[] {
    // Fast path: no text changes → the raw abilities (zero-copy).
    return card.textChanges?.length
        ? applySubstitution({
              subtypes: card.subtypes ?? [],
              staticAbilities: card.staticAbilities,
              textChanges: card.textChanges,
          }).staticAbilities
        : card.staticAbilities;
}

/** True if `card` carries the CR 702.16j player-quality protection ability. */
export function hasProtectionFromEachOpponent(
    card: Pick<CardInstanceState, "staticAbilities"> &
        Partial<Pick<CardInstanceState, "subtypes" | "textChanges">>
): boolean {
    return liveProtectionAbilities(card).includes(
        PROTECTION_FROM_EACH_OPPONENT
    );
}

/** CR 702.16j — true if `target` has protection from each of its controller's
 *  opponents AND the source in question is controlled by one of them.
 *
 *  Fails CLOSED when the source's controller is unknown (`undefined`) or the
 *  target carries no `controllerId`: a protection check that can't identify the
 *  two controllers must not silently bar a legal action. Same-controller
 *  sources are never barred — the protection is from OPPONENTS, so the
 *  controller's own Auras, blockers, damage and targeting all still work. */
export function isProtectedFromController(
    target: Pick<CardInstanceState, "staticAbilities"> &
        Partial<
            Pick<CardInstanceState, "subtypes" | "textChanges" | "controllerId">
        >,
    sourceControllerId: string | undefined
): boolean {
    if (!sourceControllerId || !target.controllerId) return false;
    if (sourceControllerId === target.controllerId) return false;
    return hasProtectionFromEachOpponent(target);
}

/** Parses "protection from [color]" static-ability strings (CR 702.16a).
 *  Returns the color code for recognized color variants (including `"C"` for
 *  colorless — CR 105.2c: an object/source is colorless when it has no
 *  colors at all), null otherwise. */
export function parseProtectionFromColor(ability: string): Color | null {
    const match = PROTECTION_FROM_COLOR_REGEX.exec(ability);
    return match ? PROTECTION_COLOR_NAME_TO_CODE[match[1]] : null;
}

/** Colors this card has protection from (CR 702.16). Parsed from its
 *  `staticAbilities[]`, read through any active color-word text changes
 *  (CR 612.6 — Sleight of Mind turns "protection from white" into "protection
 *  from blue"). Duplicates collapse (CR 702.16m). */
export function getProtectedColors(
    card: Pick<CardInstanceState, "staticAbilities"> &
        Partial<Pick<CardInstanceState, "subtypes" | "textChanges">>
): Color[] {
    const abilities = liveProtectionAbilities(card);
    const result: Color[] = [];
    for (const ability of abilities) {
        const color = parseProtectionFromColor(ability);
        if (color && !result.includes(color)) result.push(color);
    }
    return result;
}

/** True if `target` has protection from any color in `sourceColors`, or from
 *  colorless when `sourceColors` is empty (CR 702.16b/e/f; CR 105.2c — a
 *  source with no colors at all is colorless, so "protection from colorless"
 *  matches an empty `sourceColors`, never a colored one). */
export function isProtectedFromColors(
    target: Pick<CardInstanceState, "staticAbilities"> &
        Partial<
            Pick<CardInstanceState, "subtypes" | "textChanges" | "controllerId">
        >,
    sourceColors: readonly Color[],
    /** CR 702.16j (issue #1748) — the source's controller, for the PLAYER
     *  quality ("protection from each of your opponents"). Optional so every
     *  colour-only call site is unchanged; omitting it simply never matches the
     *  player quality (fail closed). */
    sourceControllerId?: string
): boolean {
    if (isProtectedFromController(target, sourceControllerId)) return true;
    const protectedFrom = getProtectedColors(target);
    if (protectedFrom.length === 0) return false;
    if (sourceColors.length === 0) return protectedFrom.includes("C");
    return sourceColors.some((c) => protectedFrom.includes(c));
}

/** True if `target` has protection from any color of `source` (CR 702.16).
 *  Source color is derived from its mana cost (CR 202.2) and works uniformly
 *  for battlefield permanents and for stack items (spells, activated
 *  abilities, triggered abilities) — ability stack items are cloned from
 *  their source permanent, so their colors match. */
export function isProtectedFromSource(
    target: CardInstanceState,
    source: CardInstanceState
): boolean {
    // CR 702.16j (issue #1748) — the source's controller carries the PLAYER
    // quality. A stack item cloned from its source permanent keeps that
    // permanent's `controllerId`, so this reads correctly for spells and
    // ability items as well as for battlefield permanents.
    return isProtectedFromColors(
        target,
        STATIC_EFFECT_CTX.getColors(source),
        source.controllerId
    );
}

/** True if `playerId` currently has PROTECTION FROM EVERYTHING (CR 702.16i
 *  applied to a player via CR 115.4 — The One Ring, issue #674).
 *
 *  The SINGLE authority for the player-scoped variant: every consumer reads
 *  this one predicate — `getLegalTargets` (the offered set) and the
 *  `selectTarget` mutation (the accepted set) so they can't diverge, plus
 *  `applyPlayerDamagePrevention` (CR 702.16e). Unlike the colour-parameterized
 *  card-scoped helpers above, it takes no source characteristics at all:
 *  protection from EVERYTHING is protection from each and every object
 *  regardless of its characteristics (CR 702.16i), with no controller
 *  exception — the protected player's own spells and sources are barred too.
 *
 *  Typed structurally (not as `GameState`) so the pure predicate stays
 *  importable from the client, exactly like `playerHasShroud`. */
export function playerHasProtectionFromEverything(
    state: { playerProtectionFromEverything?: readonly string[] },
    playerId: string
): boolean {
    return state.playerProtectionFromEverything?.includes(playerId) ?? false;
}
