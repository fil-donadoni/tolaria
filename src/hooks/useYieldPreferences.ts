import {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useState,
} from "react";
import { GameContext } from "~/hooks/useGameContext";
import {
    clearSeatCardYieldPrefs,
    clearSeatYieldPrefs,
    confirmTriggerOrder,
    countRememberedTriggerOrders,
    countYields,
    hasYield,
    seatTriggerOrderMemory,
    seatYields,
    toggleYield,
    yieldKeyCardIdentity,
    type RememberedTriggerOrder,
    type SeatTriggerOrderMemory,
    type TriggerOrderMemoryState,
    type YieldKey,
    type YieldPrefsState,
    type YieldState,
} from "~/lib/yields";

/** The board-wide **Yield** store: every seat's keys, every seat's
 *  **Auto-order** memory (issue #3617 — same lifecycle, same resets) and the
 *  writes. In MEMORY only — a **Yield** belongs to the seat within one **Game**
 *  (issue #3556 §6), so it is deliberately NOT in the `localStorage`-backed
 *  **Phase Stop** store (`useSkipPhasePreferences`) nor anywhere else that
 *  survives a reload. */
export type YieldPrefsStore = {
    yields: YieldState;
    triggerOrders: TriggerOrderMemoryState;
    toggle: (seatId: string, key: YieldKey) => void;
    clearSeat: (seatId: string) => void;
    clearSeatCard: (seatId: string, cardIdentity: string) => void;
    confirmTriggerOrder: (
        seatId: string,
        enabled: boolean,
        order: RememberedTriggerOrder | null
    ) => void;
};

export const YieldPrefsContext = createContext<YieldPrefsStore | null>(null);

/** The stateful half, mounted once per board. `gameId` is the LIFETIME: a new
 *  **Game** starts with no yields, asserted here rather than left to the route
 *  remounting (§6). */
export function useYieldPrefsState(gameId: string): YieldPrefsStore {
    // ONE state for both halves: the per-card reset decides whether to forget
    // the Auto-order memory from the yields it just computed, which two
    // separate `useState`s could only do by writing one from the other's
    // updater.
    const [prefs, setPrefs] = useState<YieldPrefsState>(EMPTY_PREFS);
    // Reset DURING render on a game change rather than in an effect: an effect
    // would let one render — the one the new game's first stack arrives in —
    // read the previous game's yields and auto-pass on them (or auto-order).
    const [lastGameId, setLastGameId] = useState(gameId);
    if (lastGameId !== gameId) {
        setLastGameId(gameId);
        if (prefs !== EMPTY_PREFS) setPrefs(EMPTY_PREFS);
    }

    const toggle = useCallback((seatId: string, key: YieldKey) => {
        setPrefs((prev) => ({
            ...prev,
            yields: toggleYield(prev.yields, seatId, key),
        }));
    }, []);
    const clearSeat = useCallback((seatId: string) => {
        setPrefs((prev) => clearSeatYieldPrefs(prev, seatId));
    }, []);
    const clearSeatCard = useCallback(
        (seatId: string, cardIdentity: string) => {
            setPrefs((prev) =>
                clearSeatCardYieldPrefs(prev, seatId, cardIdentity)
            );
        },
        []
    );
    const confirmOrder = useCallback(
        (
            seatId: string,
            enabled: boolean,
            order: RememberedTriggerOrder | null
        ) => {
            setPrefs((prev) => {
                const triggerOrders = confirmTriggerOrder(
                    prev.triggerOrders,
                    seatId,
                    enabled,
                    order
                );
                return triggerOrders === prev.triggerOrders
                    ? prev
                    : { ...prev, triggerOrders };
            });
        },
        []
    );

    return useMemo(
        () => ({
            yields: prefs.yields,
            triggerOrders: prefs.triggerOrders,
            toggle,
            clearSeat,
            clearSeatCard,
            confirmTriggerOrder: confirmOrder,
        }),
        [prefs, toggle, clearSeat, clearSeatCard, confirmOrder]
    );
}

/** The store, or a throw. The AUTHORITY path — the hook that actually passes
 *  priority — takes this one: a board that forgot the provider must fail
 *  loudly there, not quietly stop yielding. */
export function useYieldPrefsStore(): YieldPrefsStore {
    const store = useContext(YieldPrefsContext);
    if (!store)
        throw new Error(
            "useYieldPrefsStore must be used within YieldPrefsContext.Provider"
        );
    return store;
}

/** Everything a **Yield** surface needs, already scoped to the VIEWING seat —
 *  `useGameContext().playerId`, which in solo mode follows whichever seat owes
 *  input (`computeSoloViewerId`). Seat-implicit on purpose: §7's "seat A's
 *  yields must not apply while the viewer is seat B" is then a property of the
 *  hook, not of each caller remembering to pass the right id. */
export type SeatYields = {
    /** How many yields the viewing seat holds — the reset controls' count. */
    count: number;
    isYielded: (key: YieldKey) => boolean;
    toggle: (key: YieldKey) => void;
    clearAll: () => void;
    /** Does the seat yield ANY ability of this card identity
     *  (`yieldCardIdentityForDefinition`)? Gates the permanent's context-menu
     *  entry. */
    hasCardYield: (cardIdentity: string) => boolean;
    clearCard: (cardIdentity: string) => void;
    /** How many trigger orders the viewing seat has remembered (issue #3617)
     *  — counted by the reset control so it stays reachable with zero
     *  yields. */
    rememberedOrderCount: number;
    /** The viewing seat's **Auto-order** toggle and remembered orders. */
    autoOrder: SeatTriggerOrderMemory;
    /** Record a confirmed trigger order — see `confirmTriggerOrder`. */
    confirmTriggerOrder: (
        enabled: boolean,
        order: RememberedTriggerOrder | null
    ) => void;
};

/** Display-side read. Falls back to an INERT store outside a provider so a
 *  stack panel mounted in a preview / test harness renders its rows with no
 *  yields held rather than crashing — "no yields" is the truthful default for
 *  a surface with no board behind it. */
export function useSeatYields(): SeatYields {
    const store = useContext(YieldPrefsContext);
    // Read through the raw context, not `useGameContext()`: this is the
    // DISPLAY path, and it is mounted on surfaces that legitimately have no
    // board behind them (the Game Menu in a Manual Game, preview and test
    // harnesses). No seat means no yields held — which is the truth there —
    // rather than a thrown board. The AUTHORITY path (`useAutoPassYields`)
    // uses the throwing `useGameContext()` / `useYieldPrefsStore()` pair, so a
    // real board that lost either provider still fails loudly.
    const playerId = useContext(GameContext)?.playerId ?? "";
    const state = store?.yields ?? EMPTY_YIELDS;
    const triggerOrders = store?.triggerOrders ?? EMPTY_TRIGGER_ORDERS;
    return useMemo(
        () => ({
            count: countYields(state, playerId),
            isYielded: (key: YieldKey) => hasYield(state, playerId, key),
            toggle: (key: YieldKey) => store?.toggle(playerId, key),
            clearAll: () => store?.clearSeat(playerId),
            hasCardYield: (cardIdentity: string) =>
                seatYields(state, playerId).some(
                    (k) => yieldKeyCardIdentity(k) === cardIdentity
                ),
            clearCard: (cardIdentity: string) =>
                store?.clearSeatCard(playerId, cardIdentity),
            rememberedOrderCount: countRememberedTriggerOrders(
                triggerOrders,
                playerId
            ),
            autoOrder: seatTriggerOrderMemory(triggerOrders, playerId),
            confirmTriggerOrder: (
                enabled: boolean,
                order: RememberedTriggerOrder | null
            ) => store?.confirmTriggerOrder(playerId, enabled, order),
        }),
        [state, triggerOrders, playerId, store]
    );
}

const EMPTY_YIELDS: YieldState = {};
const EMPTY_TRIGGER_ORDERS: TriggerOrderMemoryState = {};
const EMPTY_PREFS: YieldPrefsState = { yields: {}, triggerOrders: {} };
