// CR 722 — PREPARATION: the `prepared` designation, the exiled copy of the
// prepare spell, and its cast (ADR 0120 § Consequences).
//
// ADR 0120 already built the half: a preparation card's inset frame is a
// registered TWIN definition (`${parentId}#prepare`, `cards/insetSpell.ts`),
// and CR 722.3 — "preparation cards can't be cast using the alternative
// characteristics found within their inset frames" — is the `prepare` row of
// `INSET_SPELL_KINDS` saying the parent never offers it. What this module adds
// is how the twin becomes castable instead:
//
//   * CR 722.3a — a permanent with a prepare spell may gain the PREPARED
//     designation (`CardInstanceState.prepared`), never twice and never
//     without a prepare spell. "Enters prepared" gives it as it enters
//     (`applyEntersPrepared`, called at the battlefield-entry sites).
//   * CR 722.3c — as it gains the designation (or phases in prepared) its
//     controller creates in exile a copy whose NORMAL characteristics are the
//     prepare spell's: an instance whose `card.id` IS the twin id. No cast
//     mode, no identity swap and no revert — the object never had any other
//     characteristics. ADR 0120 §2's table: "an instance whose `card.id` is
//     the twin". The copy is cast through the ordinary cast-from-exile family
//     (`castableFromExileBy`), so the timing gate, the cost (`xFactor`
//     included), targeting, the client's Cast button and the Bot's non-hand
//     cast enumeration all read the twin exactly as they read any exiled card.
//     What is new is only the permission's LIFETIME — bound to the
//     designation, not to a turn — which `checkPreparedCopySBA` maintains.
//   * CR 601.2i — "that permanent loses the prepared designation at the time
//     the spell becomes cast" (`onPreparedCopyCast`, run from the one cast
//     choke point `emitSpellCastEvent`). The spell is a copy of a card, so it
//     is marked `isCopy`: off the stack it ceases to exist (CR 704.5e) by the
//     paths every spell copy already takes.
//   * CR 722.3d — "if a prepare spell is copied, the copy is also a prepare
//     spell" falls out of the twin id: a copied stack item carries the same
//     `card.id`, so nothing here reimplements it.

import { tryGetDefinition } from "../cards";
import { insetSpellDefinitionId } from "../cards/insetSpell";
import type { CardDefinition } from "../cards/types";
import { allocInstanceId, findPermanent, getPlayer } from "./lookup";
import type {
    CardInstanceState,
    GameState,
    PlayerState,
    StackItem,
} from "./state/declarations";

/** The definition behind the object's current characteristics — what CR
 *  722.2a's "has a prepare spell" is asked of. A copy of a preparation card
 *  presents the copied card's id (CR 722.2b: the alternative characteristics
 *  are copiable), a face-down permanent the sentinel, which has none. */
function presentedDefinition(
    card: Pick<CardInstanceState, "card">
): CardDefinition | undefined {
    const id = (card.card as { id?: string }).id;
    return id ? (tryGetDefinition(id) ?? undefined) : undefined;
}

/** CR 722.2a — "a card, spell, or permanent that has a prepare spell" is "an
 *  object for which these alternative characteristics exist, even if the
 *  object currently doesn't use them". */
export function hasPrepareSpell(
    card: Pick<CardInstanceState, "card">
): boolean {
    return presentedDefinition(card)?.insetSpell?.kind === "prepare";
}

/** CR 722.3a — `permanent` becomes prepared. Returns `false`, changing
 *  nothing, when it cannot: "a permanent can't gain this designation unless it
 *  has a prepare spell. Additionally, a permanent can't gain this designation
 *  if the permanent already has it." Gaining it creates the CR 722.3c copy in
 *  the same act, so an already-prepared permanent never makes a second one. */
export function becomePrepared(
    state: GameState,
    permanent: CardInstanceState
): boolean {
    if (permanent.prepared === true) return false;
    const def = presentedDefinition(permanent);
    if (def?.insetSpell?.kind !== "prepare") return false;
    permanent.prepared = true;
    createPreparedCopy(state, permanent, def);
    return true;
}

/** CR 722.3a — "this creature enters prepared": applied at each
 *  battlefield-entry site once the permanent is on the battlefield under its
 *  controller, the `entersTapped` shape. A no-op for a card that does not
 *  declare it. */
export function applyEntersPrepared(
    state: GameState,
    permanent: CardInstanceState
): void {
    if (presentedDefinition(permanent)?.entersPrepared !== true) return;
    becomePrepared(state, permanent);
}

/** CR 722.3c — "its controller creates a copy of that object in exile, except
 *  that copy has only the characteristics of that permanent's prepare spell
 *  … Those characteristics become the copy's normal characteristics."
 *
 *  The copy is an instance carrying the twin id — no cast mode, no swap. It is
 *  put in the CONTROLLER's exile because the controller creates it, and CR
 *  112.2a makes that player its owner: "some effects instruct a player to
 *  create a copy of a card and say they may cast it. In that case, the owner
 *  of that copy is the player who is instructed to create it and given
 *  permission to cast it." Fail-closed: a twin that did not hydrate creates
 *  nothing rather than an object that cannot be cast. */
function createPreparedCopy(
    state: GameState,
    permanent: CardInstanceState,
    def: CardDefinition
): void {
    const twin = tryGetDefinition(insetSpellDefinitionId(def.id, "prepare"));
    if (!twin) return;
    const controllerId = permanent.controllerId;
    getPlayer(state, controllerId).exile.push({
        id: allocInstanceId(state),
        card: { id: twin.id },
        // Every array COPIED, never aliased to the registry definition's own.
        types: [...twin.types],
        subtypes: [...(twin.subtypes ?? [])],
        staticAbilities: [...(twin.staticAbilities ?? [])],
        controllerId,
        ownerId: controllerId,
        zone: "exile",
        isTapped: false,
        // CR 722.3c — "the prepared permanent's controller may cast the copy".
        // Kept pointed at the CURRENT controller by `checkPreparedCopySBA`.
        castableFromExileBy: controllerId,
        preparedCopyOf: permanent.id,
        // The print the permanent shows is the print the copy shows: one card
        // is one printing (ADR 0140 §6), and the twin's own art is the parent's.
        ...(permanent.imagePrintId
            ? { imagePrintId: permanent.imagePrintId }
            : {}),
    });
}

/** CR 702.26 / 722.3c — "as a permanent with a prepare spell … phases in
 *  prepared, its controller creates a copy". Phasing out removed the old copy
 *  (the permanent was no longer on the battlefield, `checkPreparedCopySBA`);
 *  phasing in keeps the designation, which is not lost by phasing, and makes a
 *  new one. */
export function onPhasedInPrepared(
    state: GameState,
    permanent: CardInstanceState
): void {
    if (permanent.prepared !== true) return;
    const def = presentedDefinition(permanent);
    if (def?.insetSpell?.kind !== "prepare") return;
    if (findPreparedCopy(state, permanent.id)) return;
    createPreparedCopy(state, permanent, def);
}

/** The exiled copy linked to `permanentId`, with the exile it sits in. */
function findPreparedCopy(
    state: GameState,
    permanentId: string
): { player: PlayerState; copy: CardInstanceState } | undefined {
    for (const player of state.players) {
        const copy = player.exile.find((c) => c.preparedCopyOf === permanentId);
        if (copy) return { player, copy };
    }
    return undefined;
}

/** CR 722.3b — "a rule or effect may cause a permanent to become
 *  'unprepared.' This removes the prepared designation from that permanent."
 *  The exiled copy goes with it: CR 722.3c keeps it in exile only "for as long
 *  as the prepared permanent … has the prepared designation". */
export function unprepare(
    state: GameState,
    permanent: CardInstanceState
): void {
    if (permanent.prepared !== true) return;
    delete permanent.prepared;
    const found = findPreparedCopy(state, permanent.id);
    if (found) {
        found.player.exile = found.player.exile.filter((c) => c !== found.copy);
    }
}

/** CR 722.3c + 601.2i — the exiled copy has just become cast: "that permanent
 *  loses the prepared designation at the time the spell becomes cast". Called
 *  from `emitSpellCastEvent`, the one choke point every cast (announced,
 *  searched or made during a resolution) goes through, so no cast path can
 *  leave the permanent prepared.
 *
 *  The spell is a COPY OF A CARD (CR 112.1b), so it is marked `isCopy`: off
 *  the stack — resolved, countered, fizzled or bounced — it ceases to exist
 *  (CR 704.5e) along the paths a spell copy already takes, and never reaches a
 *  graveyard. Unprepared even when the permanent's controller changed after
 *  the copy was made: the link is to the object, not to a player. */
export function onPreparedCopyCast(state: GameState, item: StackItem): void {
    const permanentId = item.preparedCopyOf;
    if (permanentId === undefined) return;
    delete item.preparedCopyOf;
    item.isCopy = true;
    const permanent = findPermanent(state, permanentId);
    if (permanent) delete permanent.prepared;
}

/** CR 704.5e + 722.3c — "if a copy of a card is in any zone other than the
 *  stack or the battlefield, it ceases to exist", except an exiled prepare
 *  copy, which "remains in exile for as long as the prepared permanent remains
 *  on the battlefield and has the prepared designation. This is an exception
 *  to rule 704.5e."
 *
 *  So a copy survives exactly while its permanent is on the battlefield
 *  (phased in — a phased-out permanent is in `state.phasedOut`, not on any
 *  battlefield, CR 702.26b) and prepared; anywhere else, or with the link
 *  broken, it is removed. A surviving copy's cast permission is re-pointed at
 *  the permanent's CURRENT controller: "the prepared permanent's controller
 *  may cast the copy" names whoever controls it now, so a control change moves
 *  the permission with it before anyone next holds priority (CR 117.5). The
 *  re-point is bookkeeping, not an action, and does not count toward the
 *  CR 704.3 fixpoint. Returns whether a copy ceased to exist. */
export function checkPreparedCopySBA(state: GameState): boolean {
    let removed = false;
    for (const player of state.players) {
        for (const zone of ["graveyard", "exile", "hand", "library"] as const) {
            const list = player[zone];
            if (!list.some((c) => c.preparedCopyOf !== undefined)) continue;
            const kept = list.filter((c) => {
                if (c.preparedCopyOf === undefined) return true;
                if (zone !== "exile") return false;
                const permanent = findPermanent(state, c.preparedCopyOf);
                if (permanent?.prepared !== true) return false;
                c.castableFromExileBy = permanent.controllerId;
                return true;
            });
            if (kept.length !== list.length) {
                player[zone] = kept;
                removed = true;
            }
        }
    }
    return removed;
}
