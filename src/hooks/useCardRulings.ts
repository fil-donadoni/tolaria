import { useCallback, useEffect, useState } from "react";
import {
    fetchRulings,
    getCachedRulings,
    type ScryfallRuling,
} from "~/lib/scryfallRulings";

export type CardRulingsState =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "loaded"; rulings: ScryfallRuling[] }
    | { status: "error" };

/**
 * Rulings of one print (issue #4816). Does nothing — no network, no storage
 * read — until `active`; then loading → loaded / error. No automatic retry:
 * `retry()` is the only way to try again.
 */
export default function useCardRulings(
    printId: string | null,
    active: boolean
): { state: CardRulingsState; retry: () => void } {
    const [attempt, setAttempt] = useState(0);
    const [result, setResult] = useState<{
        key: string;
        state: CardRulingsState;
    } | null>(null);
    const key = `${printId}#${attempt}`;

    useEffect(() => {
        if (!active || !printId) return;
        if (getCachedRulings(printId)) return;
        const controller = new AbortController();
        fetchRulings(printId, controller.signal)
            .then((rulings) =>
                setResult({ key, state: { status: "loaded", rulings } })
            )
            .catch(() => {
                if (!controller.signal.aborted)
                    setResult({ key, state: { status: "error" } });
            });
        return () => controller.abort();
    }, [active, printId, key]);

    const retry = useCallback(() => setAttempt((n) => n + 1), []);

    if (!active || !printId) return { state: { status: "idle" }, retry };
    const cached = getCachedRulings(printId);
    if (cached) {
        return { state: { status: "loaded", rulings: cached }, retry };
    }
    if (result?.key === key) return { state: result.state, retry };
    return { state: { status: "loading" }, retry };
}
