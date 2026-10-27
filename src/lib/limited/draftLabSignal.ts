// Draft Signal wiring shared by the Draft Lab and the replay (PRD #1616, issue
// #3736): one place that turns "the pack in front of a seat" into the
// `draftSignal` option `chooseBotPick`/`scorePack` read. The fold itself is the
// pure `convex/limited/draftSignal.ts`; this file only supplies the browser-side
// seams (card meta, booster config, cube pool).
import { passDirection } from "@convex/limited/draftEngine";
import {
    buildSignalFacts,
    type GetPickRating,
} from "@convex/limited/botDrafter";
import type { GetCardProfile } from "@convex/limited/cardProfilesCore";
import {
    computeExpectedShares,
    observePack,
    type DraftSignalInput,
    type ExpectedShares,
    type SeatSignalState,
} from "@convex/limited/draftSignal";
import type { DraftPackCard } from "@convex/limited/eventTypes";
import { getRuntimeBoosterConfig } from "@convex/limited/registry";
import { draftLabGetCardEvalMeta } from "./draftLabCardMeta";

/** Memo of expected shares per (pack source, cube pool, lookups) — computing
 *  one walks a whole sheet or cube pool, and a draft asks 360 times. */
const expectedCache = new WeakMap<object, Map<string, ExpectedShares | null>>();

function expectedFor(
    sourceKey: string,
    cubePool: readonly string[] | undefined,
    getPickRating: GetPickRating,
    getCardProfile: GetCardProfile | undefined
): ExpectedShares | null {
    // Keyed on the lookups' identity: a changed rating/profile lookup is a
    // different power scale and must not reuse a stale share.
    const cacheKey = getPickRating;
    let perSource = expectedCache.get(cacheKey);
    if (!perSource) {
        perSource = new Map();
        expectedCache.set(cacheKey, perSource);
    }
    const key = `${sourceKey}|${cubePool?.length ?? 0}|${getCardProfile ? "p" : "-"}`;
    if (!perSource.has(key)) {
        perSource.set(
            key,
            computeExpectedShares(
                sourceKey,
                getRuntimeBoosterConfig,
                cubePool,
                buildSignalFacts(
                    draftLabGetCardEvalMeta,
                    getPickRating,
                    getCardProfile
                )
            )
        );
    }
    return perSource.get(key) ?? null;
}

/** Folds the pack a seat is about to pick from into its Signal state and
 *  returns the new state plus the scorer's `draftSignal` input. */
export function observeLabPack(
    state: SeatSignalState,
    pack: readonly DraftPackCard[],
    round: number,
    packSlots: readonly string[],
    cubePool: readonly string[] | undefined,
    getPickRating: GetPickRating,
    getCardProfile: GetCardProfile | undefined
): { state: SeatSignalState; input: DraftSignalInput } {
    const direction = passDirection(round);
    const next = observePack(
        state,
        pack,
        round,
        direction,
        expectedFor(
            packSlots[round] ?? packSlots[0],
            cubePool,
            getPickRating,
            getCardProfile
        ),
        buildSignalFacts(draftLabGetCardEvalMeta, getPickRating, getCardProfile)
    );
    return { state: next, input: { read: next.read, direction } };
}
