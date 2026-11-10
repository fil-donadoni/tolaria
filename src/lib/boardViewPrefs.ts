// Board view preferences (issue #7429): per-DEVICE presentation knobs for the
// game board. Not game state and not a server-side user setting — the same
// `tolaria:` localStorage discipline as `deckViewPrefs.ts` (whose read/write
// helpers this reuses): an absent, corrupt, out-of-vocabulary or inaccessible
// value degrades to the documented default, never throws.
import { readPref, writePref } from "~/lib/deckViewPrefs";

/** How identical permanents lay out on the battlefield (issue #7429).
 *  `"stacked"` collapses identical, interchangeable permanents into one fanned
 *  permanent stack (PRD #621); `"separate"` gives every permanent its own
 *  slot, permanently — the same layout the board already forces during a
 *  divide-as-you-choose or per-instance selection. */
export const BATTLEFIELD_GROUPINGS = ["stacked", "separate"] as const;
export type BattlefieldGrouping = (typeof BATTLEFIELD_GROUPINGS)[number];
/** PRD #621's behaviour: an unset preference reproduces today's board. */
export const DEFAULT_BATTLEFIELD_GROUPING: BattlefieldGrouping = "stacked";

export const BATTLEFIELD_GROUPING_OPTIONS: readonly {
    value: BattlefieldGrouping;
    label: string;
    description: string;
}[] = [
    {
        value: "stacked",
        label: "Stacked",
        description: "Identical permanents share one fanned pile",
    },
    {
        value: "separate",
        label: "Separate",
        description: "Every permanent gets its own slot",
    },
];

const BATTLEFIELD_GROUPING_KEY = "tolaria:boardViewPrefs:battlefieldGrouping";

function isBattlefieldGrouping(value: unknown): value is BattlefieldGrouping {
    return (
        typeof value === "string" &&
        (BATTLEFIELD_GROUPINGS as readonly string[]).includes(value)
    );
}

export function loadBattlefieldGrouping(
    storage: Storage = window.localStorage
): BattlefieldGrouping {
    return readPref(
        storage,
        BATTLEFIELD_GROUPING_KEY,
        isBattlefieldGrouping,
        DEFAULT_BATTLEFIELD_GROUPING
    );
}

export function saveBattlefieldGrouping(
    grouping: BattlefieldGrouping,
    storage: Storage = window.localStorage
): void {
    writePref(storage, BATTLEFIELD_GROUPING_KEY, grouping);
}
