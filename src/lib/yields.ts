import type { StackItem } from "~/types/game";
import { stackAbilityKindOf, type StackAbilityKind } from "~/lib/card-utils";
import { isFaceDownCard } from "~/lib/face-down";
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
 *  all (`card.id` is `""`); its designation id is the identity instead.
 *
 *  A FACE-DOWN spell has NO identity to key on, for anyone: CR 708.2a leaves it
 *  nameless, and `turnFaceDown` swaps its `card.id` to the shared
 *  `FACE_DOWN_CARD_ID` sentinel on the stack item itself, so every face-down
 *  cast of every card would collapse into ONE key — yielding a face-down
 *  Ambush Viper would silently auto-pass the next face-down anything. It gets
 *  no key and therefore no toggle: a **Yield** names a card, and a face-down
 *  spell is exactly the object that has no card to name. */
function yieldCardIdentity(item: StackItem): string | null {
    if (item.designationId)
        return `${DESIGNATION_IDENTITY}${item.designationId}`;
    if (isFaceDownCard(item)) return null;
    return item.card.id ? `${CARD_IDENTITY}${item.card.id}` : null;
}

const CARD_IDENTITY = "card:";
const DESIGNATION_IDENTITY = "designation:";
const KEY_SEPARATOR = "|";

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
    const parts = parseYieldKey(key);
    if (!parts) return "";
    return parts.source.type === "designation"
        ? `${DESIGNATION_IDENTITY}${parts.source.id}`
        : `${CARD_IDENTITY}${parts.source.id}`;
}

/** The identity a battlefield permanent's abilities key under — the same
 *  `card:<definition id>` fragment {@link yieldKeyForStackItem} builds, so the
 *  permanent's context menu and the stack row agree without either of them
 *  knowing which abilities the other saw. */
export function yieldCardIdentityForDefinition(cardId: string): string {
    return `${CARD_IDENTITY}${cardId}`;
}

/** A **Yield** key read back into what it names (issue #3629). */
export type YieldKeyParts = {
    /** `spell` for a spell (CR 601), else the ability's flavour. */
    kind: "spell" | StackAbilityKind;
    source: { type: "card" | "designation"; id: string };
    /** The ability's id on its source; `null` for a spell. */
    abilityId: string | null;
};

/** The inverse of {@link yieldKeyForStackItem}, and the ONLY place a key is
 *  taken apart for display — it lives beside the minting so the two formats
 *  cannot drift. `null` for anything that minting could not have produced.
 *
 *  The ability id is read after the LAST separator and the identity is what
 *  lies between, so a source id that itself contains the separator still
 *  parses whole. */
export function parseYieldKey(key: YieldKey): YieldKeyParts | null {
    const first = key.indexOf(KEY_SEPARATOR);
    if (first < 0) return null;
    const kind = key.slice(0, first);
    const rest = key.slice(first + 1);
    let identity: string;
    let abilityId: string | null;
    if (kind === "spell") {
        identity = rest;
        abilityId = null;
    } else if (
        kind === "activated" ||
        kind === "triggered" ||
        kind === "delayed"
    ) {
        const last = rest.lastIndexOf(KEY_SEPARATOR);
        if (last < 0) return null;
        identity = rest.slice(0, last);
        abilityId = rest.slice(last + 1);
        if (!abilityId) return null;
    } else {
        return null;
    }
    const source = identity.startsWith(DESIGNATION_IDENTITY)
        ? {
              type: "designation" as const,
              id: identity.slice(DESIGNATION_IDENTITY.length),
          }
        : identity.startsWith(CARD_IDENTITY)
          ? { type: "card" as const, id: identity.slice(CARD_IDENTITY.length) }
          : null;
    if (!source?.id) return null;
    return { kind, source, abilityId };
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

/** Drop exactly ONE key from the seat — a "Manage yields" row (issue #3629).
 *  Unlike the per-card reset it never forgets **Auto-order** memory, even when
 *  it removes the seat's last **Yield**: the player removed one ability, not
 *  the seat's remembered orders. */
export function removeSeatYield(
    state: YieldState,
    seatId: string,
    key: YieldKey
): YieldState {
    const current = seatYields(state, seatId);
    if (!current.includes(key)) return state;
    return { ...state, [seatId]: current.filter((k) => k !== key) };
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

// ---- Auto-order (issue #3617) ---------------------------------------------
//
// The simultaneous-trigger ordering picker (CR 603.3b, ADR 0058) can remember
// the order a seat confirmed for a set of abilities and apply it the next time
// that same set triggers. It keys on the **Yield** key — the ability identity
// {@link yieldKeyForStackItem} mints — and it lives and dies with the seat's
// **Yields**: every reset of those forgets it too.

/** One remembered ordering decision: the **Yield** keys LEFT→RIGHT as the
 *  picker lays them out, bottom-first — the last key is put on the stack last
 *  and resolves first (CR 405.1). */
export type RememberedTriggerOrder = YieldKey[];

/** A seat's **Auto-order** memory: the toggle, plus at most one remembered
 *  order per multiset of ability identities. */
export type SeatTriggerOrderMemory = {
    enabled: boolean;
    orders: RememberedTriggerOrder[];
};

/** Every seat's **Auto-order** memory, seat id → memory. Per seat for the same
 *  reason {@link YieldState} is: solo mode gives one user both seats. */
export type TriggerOrderMemoryState = Record<string, SeatTriggerOrderMemory>;

const NO_TRIGGER_ORDER_MEMORY: SeatTriggerOrderMemory = {
    enabled: false,
    orders: [],
};

export function seatTriggerOrderMemory(
    state: TriggerOrderMemoryState,
    seatId: string
): SeatTriggerOrderMemory {
    return state[seatId] ?? NO_TRIGGER_ORDER_MEMORY;
}

function sameKeyMultiset(a: readonly YieldKey[], b: readonly YieldKey[]) {
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    return sortedA.every((key, i) => key === sortedB[i]);
}

/** The **Yield** keys of `ids`, in the order given, or `null` when any of them
 *  has none — a face-down trigger (CR 708.2a) or an id missing from the batch.
 *  A set with a nameless member is never remembered and never matched: there
 *  is no identity to say it is "the same set" as anything. */
export function triggerOrderKeys(
    ids: readonly string[],
    itemsById: ReadonlyMap<string, StackItem>
): YieldKey[] | null {
    const keys: YieldKey[] = [];
    for (const id of ids) {
        const item = itemsById.get(id);
        const key = item ? yieldKeyForStackItem(item) : null;
        if (!key) return null;
        keys.push(key);
    }
    return keys;
}

/** Record a confirmed ordering decision. `enabled` is the toggle as confirmed;
 *  with it on, `order` (LEFT→RIGHT keys, `null` when unkeyable) replaces any
 *  order remembered for the same multiset. */
export function confirmTriggerOrder(
    state: TriggerOrderMemoryState,
    seatId: string,
    enabled: boolean,
    order: RememberedTriggerOrder | null
): TriggerOrderMemoryState {
    const current = seatTriggerOrderMemory(state, seatId);
    if (!enabled || !order) {
        if (current.enabled === enabled) return state;
        return { ...state, [seatId]: { ...current, enabled } };
    }
    const orders = [
        ...current.orders.filter((o) => !sameKeyMultiset(o, order)),
        [...order],
    ];
    return { ...state, [seatId]: { enabled, orders } };
}

/** The candidate ids LEFT→RIGHT in the seat's remembered order for this exact
 *  multiset, or `null` when the picker must open (toggle off, a nameless
 *  candidate, or no remembered order for this set).
 *
 *  `candidateIds` is the choice's collection order and `candidateKeys` their
 *  keys in that same order. Each remembered position takes the NEXT unused
 *  candidate with its key, so copies sharing an identity keep their collection
 *  order. */
export function rememberedTriggerOrderFor(
    memory: SeatTriggerOrderMemory,
    candidateIds: readonly string[],
    candidateKeys: readonly YieldKey[] | null
): string[] | null {
    if (!memory.enabled || !candidateKeys) return null;
    if (candidateKeys.length !== candidateIds.length) return null;
    const order = memory.orders.find((o) => sameKeyMultiset(o, candidateKeys));
    if (!order) return null;
    const idsByKey = new Map<YieldKey, string[]>();
    candidateKeys.forEach((key, i) => {
        const ids = idsByKey.get(key) ?? [];
        ids.push(candidateIds[i]);
        idsByKey.set(key, ids);
    });
    return order.map((key) => idsByKey.get(key)!.shift()!);
}

export function countRememberedTriggerOrders(
    state: TriggerOrderMemoryState,
    seatId: string
): number {
    return seatTriggerOrderMemory(state, seatId).orders.length;
}

/** Forget the seat's **Auto-order** memory and turn the toggle off. */
export function clearSeatTriggerOrders(
    state: TriggerOrderMemoryState,
    seatId: string
): TriggerOrderMemoryState {
    const current = seatTriggerOrderMemory(state, seatId);
    if (!current.enabled && current.orders.length === 0) return state;
    return { ...state, [seatId]: NO_TRIGGER_ORDER_MEMORY };
}

/** Forget ONE remembered order (issue #3629), identified by its key multiset —
 *  the identity {@link confirmTriggerOrder} keeps at most one order per. The
 *  **Auto-order** toggle keeps its value. */
export function forgetSeatTriggerOrder(
    state: TriggerOrderMemoryState,
    seatId: string,
    order: readonly YieldKey[]
): TriggerOrderMemoryState {
    const current = seatTriggerOrderMemory(state, seatId);
    const orders = current.orders.filter((o) => !sameKeyMultiset(o, order));
    if (orders.length === current.orders.length) return state;
    return { ...state, [seatId]: { ...current, orders } };
}

/** Everything the board-wide **Yield** store holds: the **Yields** and the
 *  **Auto-order** memory that shares their reset lifecycle. */
export type YieldPrefsState = {
    yields: YieldState;
    triggerOrders: TriggerOrderMemoryState;
};

/** "Clear all yields": drop every **Yield** the seat holds AND its
 *  **Auto-order** memory — even when it holds no **Yield** at all, which is the
 *  case the reset control must stay reachable for (issue #3617 §7). */
export function clearSeatYieldPrefs(
    state: YieldPrefsState,
    seatId: string
): YieldPrefsState {
    const yields = clearSeatYields(state.yields, seatId);
    const triggerOrders = clearSeatTriggerOrders(state.triggerOrders, seatId);
    if (yields === state.yields && triggerOrders === state.triggerOrders)
        return state;
    return { yields, triggerOrders };
}

/** The per-card reset. Forgets the **Auto-order** memory only when it removes
 *  the seat's LAST **Yield** — a reset that leaves other **Yields** standing
 *  has not reset the seat. */
export function clearSeatCardYieldPrefs(
    state: YieldPrefsState,
    seatId: string,
    cardIdentity: string
): YieldPrefsState {
    const yields = clearSeatCardYields(state.yields, seatId, cardIdentity);
    if (yields === state.yields) return state;
    const triggerOrders =
        countYields(yields, seatId) === 0
            ? clearSeatTriggerOrders(state.triggerOrders, seatId)
            : state.triggerOrders;
    return { yields, triggerOrders };
}

/** The seat's **Yields** plus its remembered orders — THE count and visibility
 *  rule of both "Clear all yields (N)" and "Manage yields (N)" (issue #3629),
 *  so the two controls can never disagree about whether there is anything to
 *  undo. */
export function countSeatYieldPrefs(
    state: YieldPrefsState,
    seatId: string
): number {
    return (
        countYields(state.yields, seatId) +
        countRememberedTriggerOrders(state.triggerOrders, seatId)
    );
}
