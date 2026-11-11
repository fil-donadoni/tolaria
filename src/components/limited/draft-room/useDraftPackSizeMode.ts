import { useCallback, useEffect, useState } from "react";
import {
    DEFAULT_DRAFT_PACK_SIZE_MODE,
    DRAFT_PACK_SIZE_MODES,
    type DraftPackSizeMode,
} from "./draftPackSizing";

// The desktop Booster's size MODE (issue #9166): client-local, `localStorage`,
// same read/write shape as `useShowAutopick`. One key — a single Draft Room
// preference. The fine-grained `large` multiplier persists separately in
// `useCardZoom`.
const STORAGE_KEY = "tolaria:draftPackSizeMode";

function read(): DraftPackSizeMode {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        return DRAFT_PACK_SIZE_MODES.some((m) => m.mode === raw)
            ? (raw as DraftPackSizeMode)
            : DEFAULT_DRAFT_PACK_SIZE_MODE;
    } catch {
        return DEFAULT_DRAFT_PACK_SIZE_MODE;
    }
}

export function useDraftPackSizeMode() {
    const [value, setValue] = useState(read);

    useEffect(() => {
        try {
            window.localStorage.setItem(STORAGE_KEY, value);
        } catch {
            // ignore — persistence is best-effort
        }
    }, [value]);

    const set = useCallback((next: DraftPackSizeMode) => setValue(next), []);

    return { value, set };
}
