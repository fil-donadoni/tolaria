// Board view preferences (issue #7429): per-DEVICE presentation knobs for the
// game board. Not game state and not a server-side user setting — the same
// `tolaria:` localStorage discipline as `deckViewPrefs.ts` and
// `skip-phase-prefs.ts`: an absent, corrupt, out-of-vocabulary or
// inaccessible value degrades to the documented default, never throws.

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
    try {
        const raw = storage.getItem(BATTLEFIELD_GROUPING_KEY);
        if (raw === null) return DEFAULT_BATTLEFIELD_GROUPING;
        const parsed = JSON.parse(raw) as unknown;
        return isBattlefieldGrouping(parsed)
            ? parsed
            : DEFAULT_BATTLEFIELD_GROUPING;
    } catch {
        return DEFAULT_BATTLEFIELD_GROUPING;
    }
}

/** Best-effort write — a throwing `storage` (quota, private browsing) is
 *  swallowed silently. */
export function saveBattlefieldGrouping(
    grouping: BattlefieldGrouping,
    storage: Storage = window.localStorage
): void {
    try {
        storage.setItem(BATTLEFIELD_GROUPING_KEY, JSON.stringify(grouping));
    } catch {
        // best-effort persistence — quota/serialization errors are ignored
    }
}
