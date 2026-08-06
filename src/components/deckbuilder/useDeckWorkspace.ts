import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkingDeck } from "./deckBuilderVariant";

/** Trailing-edge delay before an edit reaches the persistence sink. */
const SAVE_DEBOUNCE_MS = 800;

/**
 * The persistence SINK a variant supplies (ADR 0075 §1 — one of the three
 * things a wrapper declares). Given the deck to write and the identity it
 * currently has (a `userDeckId`, a preset slug, or `null` before the first
 * write), it performs the write and returns the identity the deck now has.
 */
export type DeckSaveSink = (
    deck: WorkingDeck,
    identity: string | null
) => Promise<string | null>;

export interface DeckWorkspaceSpec {
    /** Lazy seed, evaluated once (a `useState` initializer). */
    initial: () => WorkingDeck;
    /** Identity the deck already has, or `null` for a deck not yet written. */
    initialIdentity: string | null;
    save: DeckSaveSink;
}

export interface DeckWorkspace {
    deck: WorkingDeck;
    /** A write is in flight — a variant may disable its add affordances. */
    saving: boolean;
    /** Apply an edit and schedule the debounced save. */
    updateDeck: (updater: (deck: WorkingDeck) => WorkingDeck) => void;
    setName: (name: string) => void;
    /** Write any pending edit NOW and resolve with the resulting identity.
     *  Called before leaving the screen, and on unmount. */
    flush: () => Promise<string | null>;
}

/**
 * The deckbuilder's working deck: state, colour derivation, and the debounced
 * autosave with its flush-on-leave (ADR 0075 §1, issue #1623).
 *
 * Both deckbuilder variants ran their own copy of this machinery — the same
 * 800ms trailing debounce, the same pending/timer/in-flight ref triple, the
 * same unmount flush — and they had already drifted: only one of them
 * recomputed colours per edit, only one refused to create a row for an empty
 * deck. Sharing the hook is what makes the save behaviour of every variant the
 * same BY CONSTRUCTION; all that a variant declares is where the bytes go
 * (`save`).
 *
 * The identity lives in a ref, not in state: it changes exactly once (the
 * first write of a brand-new deck) and nothing renders from it, so making it
 * state would re-render the whole screen mid-save for no observable gain.
 * `flush()` returns it instead, which is what a caller leaving the screen
 * needs.
 */
export function useDeckWorkspace({
    initial,
    initialIdentity,
    save,
}: DeckWorkspaceSpec): DeckWorkspace {
    const [deck, setDeck] = useState<WorkingDeck>(initial);
    const [saving, setSaving] = useState(false);

    const identityRef = useRef<string | null>(initialIdentity);
    const pendingRef = useRef<WorkingDeck | null>(null);
    const timerRef = useRef<number | null>(null);
    const inflightRef = useRef<Promise<unknown> | null>(null);
    // The sink is read at flush time through a ref rather than captured in
    // `flush`'s dependencies. A wrapper hands a fresh closure on most renders
    // (it closes over the deck's mutation hooks); if that closure were a
    // dependency, `flush` would be a new function each render and the
    // flush-on-unmount effect below would tear down and re-run — i.e. SAVE —
    // on every render instead of on leaving.
    const saveRef = useRef(save);
    useEffect(() => {
        saveRef.current = save;
    }, [save]);

    const clearTimer = () => {
        if (timerRef.current !== null) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    };

    const flush = useCallback(async (): Promise<string | null> => {
        clearTimer();
        if (inflightRef.current) {
            try {
                await inflightRef.current;
            } catch {
                // surfaced by the originating call site
            }
        }
        const pending = pendingRef.current;
        if (!pending) return identityRef.current;
        pendingRef.current = null;
        setSaving(true);
        const promise = saveRef.current(pending, identityRef.current);
        inflightRef.current = promise;
        try {
            identityRef.current = await promise;
        } finally {
            inflightRef.current = null;
            setSaving(false);
        }
        return identityRef.current;
    }, []);

    const schedule = useCallback(
        (next: WorkingDeck) => {
            // Never CREATE a row for a deck that has nothing in it: a user who
            // opens the builder and leaves must not leave an empty deck
            // behind. Once the deck exists (identity set) every edit persists,
            // emptying it included.
            const shouldPersist =
                next.cards.length > 0 ||
                next.sideboard.length > 0 ||
                identityRef.current !== null;
            if (!shouldPersist) {
                pendingRef.current = null;
                clearTimer();
                return;
            }
            pendingRef.current = next;
            clearTimer();
            timerRef.current = window.setTimeout(() => {
                timerRef.current = null;
                void flush();
            }, SAVE_DEBOUNCE_MS);
        },
        [flush]
    );

    useEffect(() => {
        return () => {
            void flush();
        };
    }, [flush]);

    const updateDeck = useCallback(
        (updater: (deck: WorkingDeck) => WorkingDeck) => {
            setDeck((current) => {
                const next = updater(current);
                schedule(next);
                return next;
            });
        },
        [schedule]
    );

    const setName = useCallback(
        (name: string) => updateDeck((d) => ({ ...d, name })),
        [updateDeck]
    );

    return { deck, saving, updateDeck, setName, flush };
}
