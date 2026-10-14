import { useEffect, useReducer, useState } from "react";
import { installSets, setsNeededFor } from "~/lib/catalogue/definitionShards";

/** What the board reads to decide whether it may render its cards. */
export interface DefinitionsResidence {
    /** Every Set the ids need is resident: `getDefinition` answers each. */
    ready: boolean;
    /** The load that failed, if one did; `retry` re-loads it. */
    error: Error | null;
    retry: () => void;
}

/**
 * Holds a surface back until every hand-written Set its definition ids need
 * is resident (issue #5615, PRD #5602): the ON-DEMAND path of the per-game
 * delivery. The Definition Manifest names what a game can need at its build;
 * what lands on the board outside it — a debug placement before the widened
 * Manifest arrives, a card fetched from outside the game (CR 400.11), a
 * Manifest Set code the client's index does not know — is caught HERE, by
 * the ids the state actually carries, and loaded with the snapshot held back.
 * Never debug-only. This hold is what keeps `getDefinition` — which throws
 * for a card whose Set is not resident, like any unknown id — from running
 * against a snapshot it cannot resolve.
 *
 * `ids` is `null` while there is no state to read. Cheap per render: a map
 * lookup per id; the install runs once per distinct set of missing Sets.
 */
export function useDefinitionsResident(
    ids: readonly string[] | null
): DefinitionsResidence {
    // Residency lives outside React (the loader's map): a bump after an
    // install re-reads it.
    const [, bump] = useReducer((n: number) => n + 1, 0);
    // A failure belongs to the set of Sets it failed for: a new set of
    // missing Sets starts clean, an earlier failure is not this load's.
    const [failed, setFailed] = useState<{
        key: string;
        error: Error;
    } | null>(null);
    const [attempt, setAttempt] = useState(0);
    const needed = ids === null ? [] : setsNeededFor(ids);
    const neededKey = needed.join(" ");

    useEffect(() => {
        if (neededKey === "") return;
        let cancelled = false;
        installSets(neededKey.split(" ")).then(
            () => {
                if (!cancelled) bump();
            },
            (cause: unknown) => {
                // Loud: a silent hold is a board that never updates.
                console.error("definition shards: install failed", cause);
                if (!cancelled)
                    setFailed({
                        key: neededKey,
                        error:
                            cause instanceof Error
                                ? cause
                                : new Error(String(cause)),
                    });
            }
        );
        return () => {
            cancelled = true;
        };
    }, [neededKey, attempt]);

    return {
        ready: needed.length === 0,
        error:
            failed !== null && failed.key === neededKey ? failed.error : null,
        retry: () => {
            setFailed(null);
            setAttempt((n) => n + 1);
        },
    };
}
