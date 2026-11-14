// The WIRE SHAPE of a board permission's free cast (CR 601.2b / 118.9), kept in
// a leaf module because both sides of the composition read it: the permission
// module (`castPermissions.ts`) builds the id, and the face-choice readers
// (`splitCast.ts`, `castMode.ts`) see through it. Importing either of those
// from the other would close a cycle; this file imports nothing.
//
// CR 118.9a allows ONE alternative cost per spell, and the engine announces
// every cast option through ONE string, `alternativeCostId`. A permission that
// waives the mana cost (Aluren) is one such option; so is the choice of which
// half of a split card is cast (CR 709.3, ADR 0121) — which is not an
// alternative cost at all, only "a player chooses which half of a split card
// they are casting". A split half cast under such a permission has to say
// both, so the permission's id CARRIES the face it is applied to:
//
//     cast-permission:<permission id>                     the printed card
//     cast-permission:<permission id>@split-left:<parent>  one half
//
// One channel, so the five surfaces `castPermissions.ts` names keep reading
// one string, and a reader asking "is this a permission cast?" and one asking
// "which half?" each get their own answer from it.

/** Namespace prefix for the `alternativeCostId` a permission's free cast is
 *  addressed by on the wire (`announceCast.alternativeCostId`,
 *  `Move.alternativeCostId`). Namespaced so a permission id can never collide
 *  with a card-declared `alternativeCosts[].id` — the two live in the same
 *  string space and are resolved by the same lookup. */
export const CAST_PERMISSION_ALT_COST_PREFIX = "cast-permission:";

/** Joins a permission's id to the face-choice id it is applied to. A
 *  permission id never contains it (`castPermissionIds.test.ts`), so the
 *  first one after the prefix is the boundary. */
export const CAST_PERMISSION_FACE_SEPARATOR = "@";

/** `true` when `altCostId` addresses a board-granted permission's free cast
 *  rather than one of the card's own alternative costs — on the printed card
 *  or on one face. */
export function isCastPermissionAltCostId(altCostId: string): boolean {
    return altCostId.startsWith(CAST_PERMISSION_ALT_COST_PREFIX);
}

/** The `alternativeCostId` that announces the permission `permissionId`'s free
 *  cast, of the printed card or — CR 709.3 — of the face `faceChoiceId`
 *  names. */
export function composeCastPermissionAltCostId(
    permissionId: string,
    faceChoiceId?: string
): string {
    const base = `${CAST_PERMISSION_ALT_COST_PREFIX}${permissionId}`;
    return faceChoiceId === undefined
        ? base
        : `${base}${CAST_PERMISSION_FACE_SEPARATOR}${faceChoiceId}`;
}

/** CR 709.3 — the part of `altCostId` that says WHICH face is cast: the face
 *  a permission's free cast is applied to, or `altCostId` itself for every
 *  other announcement. A permission cast of the printed card names no face and
 *  returns its own id, which no face reader matches. */
export function faceChoiceComponent(
    altCostId: string | undefined
): string | undefined {
    if (altCostId === undefined || !isCastPermissionAltCostId(altCostId)) {
        return altCostId;
    }
    const at = altCostId.indexOf(
        CAST_PERMISSION_FACE_SEPARATOR,
        CAST_PERMISSION_ALT_COST_PREFIX.length
    );
    return at < 0 ? altCostId : altCostId.slice(at + 1);
}
