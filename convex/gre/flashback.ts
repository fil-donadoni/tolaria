// Flashback (CR 702.34) — a keyword-cast capability that lets an instant or
// sorcery card be cast from its owner's graveyard for an alternative mana cost,
// then exiles the card as it resolves or leaves the stack.
//
// 702.34a "Flashback [cost]" means "You may cast this card from your graveyard
//         by paying [cost] rather than paying its mana cost" and "If the
//         flashback cost was paid, exile this card as it resolves or as it
//         otherwise leaves the stack."
// 702.34c Casting a spell using its flashback ability follows the normal cast
//         timing rules for that card type (a sorcery flashback is sorcery-speed).
//
// Flashback is engine/cost-system infrastructure, NOT an Effect Script Op — a
// card's on-resolution effect stays DSL/`resolve()`; only the CAST permission
// and cost live here. The flashback cost is either printed on the card
// (`CardDefinition.flashback`) or granted at the instance level until end of
// turn (`CardInstanceState.grantedFlashback` — Snapcaster Mage).
import type { Color, FlashbackCost, ManaCost } from "../cards/types";
import { tryGetDefinition } from "../cards";
import { cardHasColor } from "../cards/colors";
import type { CardInstanceState, PlayerState } from "./state";

/** The flashback-only NON-mana additional cost (sacrifice a permanent and/or
 *  exile a card from hand), independent of the mana portion (CR 702.34a). */
export type FlashbackAdditionalCost = Pick<
    FlashbackCost,
    "sacrifice" | "exileFromHand"
>;

/** A raw `flashback` value may be a bare {@link ManaCost} (mana-only flashback,
 *  Faithless Looting) or the generalized {@link FlashbackCost} shape carrying a
 *  non-mana component (Lava Dart). This discriminant is exact: a `FlashbackCost`
 *  is the only shape with a `mana`/`sacrifice`/`exileFromHand` key, and a
 *  `ManaCost` never has one (its keys are colour/generic/X pips). */
function isFlashbackCostShape(
    raw: ManaCost | FlashbackCost
): raw is FlashbackCost {
    return "mana" in raw || "sacrifice" in raw || "exileFromHand" in raw;
}

/** Normalize either accepted `flashback` shape to a {@link FlashbackCost}. A
 *  bare mana cost becomes `{ mana }`; a `FlashbackCost` passes through. */
export function normalizeFlashbackCost(
    raw: ManaCost | FlashbackCost
): FlashbackCost {
    return isFlashbackCostShape(raw) ? raw : { mana: raw };
}

/** The raw flashback value in effect for `card` — the instance-level grant
 *  (Snapcaster's `grantedFlashback`) if present, else the printed
 *  `CardDefinition.flashback`. Undefined when the card has no flashback. */
function getRawFlashback(
    card: CardInstanceState
): ManaCost | FlashbackCost | undefined {
    if (card.grantedFlashback) return card.grantedFlashback;
    const id = (card.card as { id?: string }).id;
    return id ? (tryGetDefinition(id)?.flashback ?? undefined) : undefined;
}

/** The full normalized flashback cost for `card`, or `undefined` when it has no
 *  flashback (CR 702.34a). */
export function getNormalizedFlashback(
    card: CardInstanceState
): FlashbackCost | undefined {
    const raw = getRawFlashback(card);
    return raw ? normalizeFlashbackCost(raw) : undefined;
}

/** The MANA portion of a card's flashback cost, or `undefined` when the card
 *  has no flashback OR the flashback cost has no mana component (Lava Dart:
 *  "Sacrifice a Mountain" pays no mana). An instance-level grant (Snapcaster
 *  Mage's `grantedFlashback`) overrides / supplies the printed
 *  `CardDefinition.flashback`. Callers that also need the non-mana component
 *  read {@link getFlashbackAdditionalCost}. */
export function getFlashbackCost(
    card: CardInstanceState
): ManaCost | undefined {
    return getNormalizedFlashback(card)?.mana;
}

/** The flashback-only NON-mana additional cost for `card`, or `undefined` when
 *  the card has no flashback or a purely-mana flashback (CR 702.34a / 118.5).
 *  Applies ONLY on a flashback (graveyard) cast — the caller gates on the cast
 *  zone. */
export function getFlashbackAdditionalCost(
    card: CardInstanceState
): FlashbackAdditionalCost | undefined {
    const fb = getNormalizedFlashback(card);
    if (!fb) return undefined;
    if (fb.sacrifice === undefined && fb.exileFromHand === undefined) {
        return undefined;
    }
    return {
        ...(fb.sacrifice !== undefined ? { sacrifice: fb.sacrifice } : {}),
        ...(fb.exileFromHand !== undefined
            ? { exileFromHand: fb.exileFromHand }
            : {}),
    };
}

/** True iff `card` currently has a Flashback cost of any shape — mana-only,
 *  a non-mana cost, or both (printed or granted). Note this is NOT
 *  `getFlashbackCost(card) !== undefined`: a purely non-mana flashback (Lava
 *  Dart) has no mana portion yet is still castable via flashback. */
export function hasFlashback(card: CardInstanceState): boolean {
    return getNormalizedFlashback(card) !== undefined;
}

/** CR 702.34a / 118.5 / 702.34e — the number of cards in `player`'s OWN
 *  graveyard eligible to pay a `flashbackExileFromGraveyard` cost: matching
 *  `color` (undefined = any card), EXCLUDING `excludeInstanceId` (the flashback
 *  card can't pay for its own cost). This is BOTH the affordability bound
 *  (`canPayFlashbackExile` — need `>= chosenX`) AND the maximum X the caster may
 *  legally announce on the flashback cast, since the cost demands EXACTLY
 *  `chosenX` such cards. Single authority for "how many blue cards can this
 *  flashback exile" so the client X cap and the server announce check never
 *  diverge (`getEffectiveToughness`-style single-source pattern). */
export function flashbackExileEligibleCount(
    player: PlayerState,
    color: Color | undefined,
    excludeInstanceId: string
): number {
    return player.graveyard.filter((c) => {
        if (c.id === excludeInstanceId) return false;
        if (color === undefined) return true;
        const def = tryGetDefinition((c.card as { id?: string }).id ?? "");
        // CR 105.2 / 202.2 — a card's COLOUR, not its colour identity: an Island
        // taps for blue but is colourless, so it never pays "exile a blue card".
        return def ? cardHasColor(def, color) : false;
    }).length;
}

/** CR 702.34a — the card in `player`'s graveyard with `instanceId` that can be
 *  cast via Flashback right now (it carries a flashback cost), or `undefined`.
 *  Only the graveyard zone is a legal flashback source; a card being flashed
 *  back is located here by the cast path, mirroring `findCastableExileCard`. */
export function findFlashbackCastable(
    player: PlayerState,
    instanceId: string
): CardInstanceState | undefined {
    const card = player.graveyard.find((c) => c.id === instanceId);
    if (!card) return undefined;
    return hasFlashback(card) ? card : undefined;
}
