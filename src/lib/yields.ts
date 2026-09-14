import type { StackItem } from "~/types/game";
import { stackAbilityKindOf } from "~/lib/card-utils";
import {
    computeAutoPassBlockedCore,
    type AutoPassCoreCtx,
} from "~/lib/priority";

/** A **Yield** key: the stable identity of an ABILITY, not of a stack object.
 *  Opaque to every consumer — only {@link yieldKeyForStackItem} mints one. */
export type YieldKey = string;

/** Every **Yield** held on a board, seat id → the keys that seat yields on.
 *  Per-seat because solo mode gives one user both seats (issue #3556 §7), and
 *  a plain array rather than a `Set` so React sees a new value on every write
 *  and the store stays trivially serialisable for a test's `toEqual`. */
export type YieldState = Record<string, YieldKey[]>;

/** The card half of a **Yield** key.
 *
 *  `item.card.id` — the DEFINITION id — is the identity, deliberately: the
 *  catalogue holds exactly one definition per card NAME, so keying on it is
 *  what makes a **Yield** apply to every Noble Hierarch on the battlefield,
 *  including ones that arrive later or leave and come back, and to neither
 *  Ignoble Hierarch's identically-worded Exalted trigger nor a second,
 *  different ability of Noble Hierarch itself (issue #3556 comment).
 *
 *  Not `displayCardId`: that one prefers the caster's own `knownCardId` for a
 *  face-down object, so the key would name a card the row does not show
 *  (`StackRow` renders the face-down face for the caster too, issue #2904) —
 *  the toggle and the row would disagree about what is being yielded.
 *
 *  A designation trigger (CR 725 — the Monarch's end-step draw) has no card at
 *  all (`card.id` is `""`); its designation id is the identity instead. */
function yieldCardIdentity(item: StackItem): string | null {
    if (item.designationId) return `designation:${item.designationId}`;
    return item.card.id ? `card:${item.card.id}` : null;
}

/** The **Yield** key of a stack object, or `null` when the object has no
 *  stable identity to key on (a card-less inline trigger with no designation).
 *
 *  THE single derivation. The row toggle, the auto-pass predicate and both
 *  reset controls all call this one — a second, hand-rolled key is exactly how
 *  a toggle and a pass silently disagree (issue #3556 § Key interfaces). */
export function yieldKeyForStackItem(item: StackItem): YieldKey | null {
    const card = yieldCardIdentity(item);
    if (!card) return null;
    switch (stackAbilityKindOf(item)) {
        case "activated":
            return `activated|${card}|${item.abilityId}`;
        case "triggered":
            return `triggered|${card}|${item.triggeredAbilityId}`;
        case "delayed":
            return `delayed|${card}|${item.delayedTriggerId}`;
        default:
            // A spell has one identity and no ability slot (CR 601): the card
            // itself IS the key.
            return `spell|${card}`;
    }
}

/** The card identity a key was minted from — the read the per-card reset
 *  ("Turn off auto-yield for Noble Hierarch") filters on, so it never has to
 *  re-derive a key from a battlefield permanent whose abilities it cannot see. */
export function yieldKeyCardIdentity(key: YieldKey): string {
    return key.split("|")[1] ?? "";
}

/** The identity a battlefield permanent's abilities key under — the same
 *  `card:<definition id>` fragment {@link yieldKeyForStackItem} builds, so the
 *  permanent's context menu and the stack row agree without either of them
 *  knowing which abilities the other saw. */
export function yieldCardIdentityForDefinition(cardId: string): string {
    return `card:${cardId}`;
}

export function seatYields(state: YieldState, seatId: string): YieldKey[] {
    return state[seatId] ?? [];
}

export function hasYield(
    state: YieldState,
    seatId: string,
    key: YieldKey
): boolean {
    return seatYields(state, seatId).includes(key);
}

export function countYields(state: YieldState, seatId: string): number {
    return seatYields(state, seatId).length;
}

export function toggleYield(
    state: YieldState,
    seatId: string,
    key: YieldKey
): YieldState {
    const current = seatYields(state, seatId);
    const next = current.includes(key)
        ? current.filter((k) => k !== key)
        : [...current, key];
    return { ...state, [seatId]: next };
}

/** Drop every **Yield** the seat holds. Other seats are untouched — in solo
 *  mode the reset is still the VIEWING seat's, not the board's (§5/§7). */
export function clearSeatYields(state: YieldState, seatId: string): YieldState {
    if (seatYields(state, seatId).length === 0) return state;
    return { ...state, [seatId]: [] };
}

/** Drop the seat's yields whose source is this card identity — every ability
 *  of that card at once, which is what the permanent's context menu offers
 *  ("Turn off auto-yield for Noble Hierarch"). */
export function clearSeatCardYields(
    state: YieldState,
    seatId: string,
    cardIdentity: string
): YieldState {
    const current = seatYields(state, seatId);
    const next = current.filter(
        (k) => yieldKeyCardIdentity(k) !== cardIdentity
    );
    if (next.length === current.length) return state;
    return { ...state, [seatId]: next };
}

export type YieldAutoPassCtx = AutoPassCoreCtx & {
    /** The whole stack, bottom-first (CR 405.1) — `stackItems` as the board
     *  context carries it. Only its LAST entry, the top object, is read. */
    stackItems: StackItem[];
};

/** The top object of the stack (CR 405.1 — the last one put there resolves
 *  first), or `undefined` on an empty stack. */
export function topOfStack(stackItems: StackItem[]): StackItem | undefined {
    return stackItems.length > 0
        ? stackItems[stackItems.length - 1]
        : undefined;
}

/** Should the viewing seat pass priority right now because the object on TOP
 *  of the stack is one it yields (issue #3556 §3)?
 *
 *  Top-of-stack only, regardless of what sits underneath: the yielded object
 *  resolves and the seat is handed priority again on the next object unless
 *  that one is yielded too. It cannot deadlock a board — the predicate fires
 *  only for the seat currently HOLDING priority (`computeAutoPassBlockedCore`
 *  → `computeHasPriority`) and each firing passes once, so two seats yielding
 *  the same object produce the two consecutive passes that RESOLVE it (CR
 *  117.4) and the stack strictly shrinks.
 *
 *  Shares every blocking guard with the **Phase Stop** path through
 *  `computeAutoPassBlockedCore`; what it must NOT inherit is that path's
 *  refusal on a non-empty stack, which is the only case a **Yield** exists
 *  for. */
export function shouldAutoPassYield(
    ctx: YieldAutoPassCtx,
    state: YieldState,
    pageVisible: boolean
): boolean {
    if (!pageVisible) return false;
    if (computeAutoPassBlockedCore(ctx)) return false;
    const top = topOfStack(ctx.stackItems);
    if (!top) return false;
    const key = yieldKeyForStackItem(top);
    if (!key) return false;
    return hasYield(state, ctx.playerId, key);
}
