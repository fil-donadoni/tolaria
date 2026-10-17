import { useEffect, useState, useSyncExternalStore } from "react";
import { isCompiledIndexInstalled } from "@convex/cards/catalogue";
import { installCompiledIndex } from "~/lib/catalogue/compiled-shards";
import { subscribeResidency } from "~/lib/catalogue/residency";

/** What a NAME-LIST surface reads: whether every compiled card's name is
 *  known in this graph, and why it is not if its load failed. */
export interface CompiledIndexResidence {
    ready: boolean;
    error: Error | null;
    /** Load again after a failure — a prompt the player must answer cannot
     *  stay dead on one failed fetch. */
    retry: () => void;
}

/**
 * The compiled Definition Index — every compiled card's name, no definition —
 * loaded ON DEMAND by a surface that lists or resolves names (issue #5616): the
 * name-a-card prompt, the debug name fields. A game route holds only its own
 * shards, so `getChooseableCardNames` / `getAllCardNames` would list only the
 * hand-written cards and the game's own compiled ones until this resolves.
 * Never the shards: a name needs no definition.
 *
 * Residency is the loader's external store; `isCompiledIndexInstalled` is the
 * snapshot, so the React Compiler cannot memoise a stale answer. `enabled`
 * false skips the load (a field showing another name space).
 */
export function useCompiledIndex(enabled = true): CompiledIndexResidence {
    const ready = useSyncExternalStore(
        subscribeResidency,
        isCompiledIndexInstalled,
        isCompiledIndexInstalled
    );
    const [error, setError] = useState<Error | null>(null);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        if (!enabled || ready) return;
        let cancelled = false;
        installCompiledIndex().catch((cause: unknown) => {
            // Loud: an empty list with no reason is a prompt nobody can answer.
            console.error("compiled index: load failed", cause);
            if (!cancelled)
                setError(
                    cause instanceof Error ? cause : new Error(String(cause))
                );
        });
        return () => {
            cancelled = true;
        };
    }, [enabled, ready, attempt]);
    return {
        ready,
        error: ready ? null : error,
        retry: () => {
            setError(null);
            setAttempt((n) => n + 1);
        },
    };
}
