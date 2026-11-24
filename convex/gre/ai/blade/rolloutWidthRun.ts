/**
 * Run a synchronous blade search with the rollout width recorder installed
 * (issue #10631): the census and the authoring probe read how wide the
 * position's rollout plies are. Restores whatever recorder was there before,
 * a throw included.
 */
import { setRolloutPlyRecorder } from "../../search";
import {
    newRolloutWidth,
    recordRolloutPly,
    type RolloutWidth,
} from "../rolloutWidth";

export function withRolloutWidth<T>(run: () => T): {
    value: T;
    width: RolloutWidth;
} {
    const width = newRolloutWidth();
    const previous = setRolloutPlyRecorder((candidates, declaration) =>
        recordRolloutPly(width, candidates, declaration)
    );
    try {
        return { value: run(), width };
    } finally {
        setRolloutPlyRecorder(previous);
    }
}
