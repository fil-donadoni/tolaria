import { useEffect, useRef, useState } from "react";

/**
 * Delays propagation of a rapidly-changing value by `delayMs`, collapsing a
 * burst of updates (e.g. per-keystroke text input) into a single trailing
 * emission. The returned value only catches up to `value` once it has stopped
 * changing for `delayMs`.
 *
 * Clearing is **prompt**: when `value` becomes empty (`""`), the debounced
 * value is reported as `""` synchronously (resolved during render) rather than
 * waiting out the delay, so a cleared search box returns to its idle state
 * without lag. The internal stored value is also reset to `""` on the next tick
 * so a subsequent burst of typing debounces from a clean base instead of
 * flashing the previously-settled query. Any pending trailing timer is
 * cancelled on clear so it can't resurrect a stale value.
 *
 * @param value   the raw, immediately-updating source value
 * @param delayMs trailing-edge delay before emitting (single tuning constant)
 */
export function useDebouncedValue(value: string, delayMs: number): string {
    const [debounced, setDebounced] = useState(value);
    const timerRef = useRef<number | null>(null);

    useEffect(() => {
        if (timerRef.current !== null) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }

        // Clearing bypasses the debounce. The empty value is surfaced
        // synchronously by the render-time return below; we additionally reset
        // the stored value (on a 0ms tick, so it's not a synchronous
        // setState-in-effect) so the next non-empty burst starts clean.
        if (value === "") {
            timerRef.current = window.setTimeout(() => {
                timerRef.current = null;
                setDebounced("");
            }, 0);
        } else {
            timerRef.current = window.setTimeout(() => {
                timerRef.current = null;
                setDebounced(value);
            }, delayMs);
        }

        return () => {
            if (timerRef.current !== null) {
                window.clearTimeout(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [value, delayMs]);

    // A cleared input reports "" immediately; otherwise the trailing value wins.
    return value === "" ? "" : debounced;
}
