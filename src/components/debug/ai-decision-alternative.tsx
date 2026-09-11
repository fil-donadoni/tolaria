// One move the bot did NOT make, and what taking it would have changed
// (issue #3404).
//
// The comparison is derived from the eval-term deltas between the two
// positions, not from the reward: a tester can check "it would have lost a
// creature" against the board in front of them, and cannot check `r0.53`. When
// the terms separate the two candidates by nothing at all, that IS the reading
// — `NO_DIFFERENCE_PHRASE` says so, because a tie is the signature of a pick
// made by a tie-break rather than by the evaluation (`/bot-slice` phase 0).

import type { CandidateTrace } from "@convex/gre";
import { comparePositions } from "~/lib/ai/decision-phrases";

export default function AiDecisionAlternative({
    chosen,
    candidate,
}: {
    chosen: CandidateTrace;
    candidate: CandidateTrace;
}) {
    // `unavailable` means `buildTrace` could not replay this edge's move against
    // the root world (issue #1516), so its breakdown is the UNRESOLVED root
    // position — comparing it would read as a confident sentence about a
    // position that was never evaluated. Say nothing instead of saying it
    // wrongly.
    const comparable = !candidate.unavailable && !chosen.unavailable;
    const reading = comparable
        ? comparePositions(chosen.eval, candidate.eval).join(", ")
        : "not comparable — the search could not replay this move";

    return (
        // `break-words` on both lines, not `truncate`: a move label is already
        // a sentence ("Cast Lightning Bolt targeting Grizzly Bears") and the
        // sheet is 400px wide on a phone, so clipping it would cut exactly the
        // half that says WHICH alternative this was. Wrapping is what keeps the
        // panel off a horizontal scrollbar.
        <li className="flex min-w-0 flex-col">
            <span className="break-words text-text">{candidate.label}</span>
            <span
                className={`break-words ${
                    comparable ? "text-text-muted" : "text-text-disabled italic"
                }`}
            >
                {reading}
            </span>
        </li>
    );
}
