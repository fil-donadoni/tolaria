/**
 * The ONE resolver for "what is this oracle card's earliest PAPER printing?"
 * (ADR 0041 — home set = earliest paper printing), shared by
 * `scripts/backfill-card-index.ts` (hand-written registry → lockfile) and
 * `scripts/oracle-index-backfill.ts` (compiled `ready` rows → lockfile).
 *
 * IT FAILS CLOSED, and that is the whole point (issue #3423). Both callers
 * used to carry their own copy that, on a failed lookup, returned the print
 * IN HAND with a `console.warn`:
 *
 *     console.warn(`  prints lookup failed for ${oracleId} — keeping own print`);
 *     return fallback;
 *
 * The caller then wrote that guess into BOTH `scryfallId` and `firstPrintId`,
 * and `check-card-index.ts` compares exactly those two fields AGAINST EACH
 * OTHER. A row poisoned by the fallback is therefore self-consistent by
 * construction: the guard prints "every card on its first printing" over it,
 * the lockfile is committed, and the only trace is a warning on a run nobody
 * re-reads. One transient 429 pinned Shadowblood Ridge to `dsc` (Duskmourn
 * Commander, 2024) instead of `ody` (Odyssey, 2001) and nothing went red for
 * a year.
 *
 * So: `null` on any failure, never a guess. A caller that cannot resolve a
 * card WRITES NO ROW and carries the failure out in its exit code — a missing
 * row is loud (`check:index` reports it, the next backfill re-fetches it),
 * a wrong row is silent forever.
 */

export const SCRYFALL = "https://api.scryfall.com";

/** Set types that are not a real paper printing of the card. `funny` joins
 *  the three the two copies already shared: an acorn/silver-border set is
 *  printed on paper but is not the card's home set, and it is the filter the
 *  issue #3423 audit measured the population with. */
export const NON_PRINT_SET_TYPES: ReadonlySet<string> = new Set([
    "token",
    "memorabilia",
    "minigame",
    "funny",
]);

export interface PaperPrint {
    id: string;
    set: string;
    /** Rarity of THIS printing (CR 206). `oracle-index-backfill.ts` needs it
     *  (the compiler is forbidden from emitting it, ADR 0108);
     *  `backfill-card-index.ts` ignores it — a hand-written `CardDefinition`
     *  declares its own. */
    rarity: string;
}

export interface FirstPaperPrintDeps {
    /** Injected in tests to simulate a failing Scryfall (issue #3423's
     *  acceptance criterion: prove a failed lookup writes no verified-looking
     *  row). Defaults to the global `fetch`. */
    fetch?: typeof globalThis.fetch;
    /** Injected in tests so a retry loop costs no wall-clock. */
    sleep?: (ms: number) => Promise<void>;
    userAgent?: string;
    attempts?: number;
}

const realSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The card's earliest paper printing, or `null` if Scryfall could not answer.
 * Only worth calling for a print Scryfall flags as a `reprint` — otherwise
 * the print in hand already IS the first one.
 */
export async function resolveFirstPaperPrint(
    oracleId: string,
    deps: FirstPaperPrintDeps = {}
): Promise<PaperPrint | null> {
    const doFetch = deps.fetch ?? globalThis.fetch;
    const sleep = deps.sleep ?? realSleep;
    const attempts = deps.attempts ?? 4;
    const url =
        `${SCRYFALL}/cards/search?order=released&dir=asc&unique=prints` +
        `&include_extras=true&q=${encodeURIComponent(`oracleid:${oracleId}`)}`;
    for (let a = 1; a <= attempts; a++) {
        let res: Response;
        try {
            res = await doFetch(url, {
                headers: {
                    Accept: "application/json",
                    "User-Agent": deps.userAgent ?? "tolaria-card-index/1.0",
                },
            });
        } catch {
            // Network error — same treatment as a 5xx: retry, then give up.
            if (a < attempts) {
                await sleep(1500 * a);
                continue;
            }
            return null;
        }
        await sleep(150);
        if (res.status === 429 || res.status >= 500) {
            if (a < attempts) {
                await sleep(1500 * a);
                continue;
            }
            return null;
        }
        if (!res.ok) return null;
        const json = (await res.json()) as {
            data?: Array<{
                id: string;
                set: string;
                set_type: string;
                digital: boolean;
                rarity: string;
            }>;
        };
        const paper = (json.data ?? []).filter(
            (p) => !p.digital && !NON_PRINT_SET_TYPES.has(p.set_type)
        );
        if (paper.length === 0) return null;
        return {
            id: paper[0].id,
            set: paper[0].set,
            rarity: paper[0].rarity,
        };
    }
    return null;
}
