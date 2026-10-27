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

/** Expected shares of one pack source. Recomputed per call, never memoised
 *  across calls: the shares depend on the rating lookup, the profile lookup,
 *  the booster registry and the cube pool, and a cache keyed on any subset of
 *  them would make a run's picks depend on what ran before it. */
function expectedFor(
    sourceKey: string,
    cubePool: readonly string[] | undefined,
    getPickRating: GetPickRating,
    getCardProfile: GetCardProfile | undefined
): ExpectedShares | null {
    return computeExpectedShares(
        sourceKey,
        getRuntimeBoosterConfig,
        cubePool,
        buildSignalFacts(draftLabGetCardEvalMeta, getPickRating, getCardProfile)
    );
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
