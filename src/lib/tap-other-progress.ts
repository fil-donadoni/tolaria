import {
    tapOtherRemaining,
    type TapOtherCostSpec,
} from "@convex/gre/tapOtherCost";
import { formatFilterLabel } from "~/lib/sacrifice-selection";

/** Human phrasing for what a `cost.tapOtherFilter` leg still wants (CR 602.1 /
 *  118.8 — Hand of Justice's "Tap five untapped white creatures you control",
 *  CR 702.122a Crew N, Urza, Lord High Artificer's "Tap an untapped artifact
 *  you control"). Returns the verb phrase only ("tap 3 more creatures"), so a
 *  caller can compose it into its own sentence.
 *
 *  Shared by BOTH pickers for this one cost shape — the deferred
 *  `useStack: true` picker's banner (`payment-banner.tsx`, driven by
 *  `pendingActivation.tapOtherChoice`) and the client-local `useStack: false`
 *  mana-ability picker's banner (`mana-tap-other-banner.tsx`, issue #2371).
 *  Extracted on the SECOND consumer: two prompts describing the same cost in
 *  differently-worded English is how a player learns to distrust the prompt. */
export function describeTapOtherProgress(
    spec: TapOtherCostSpec,
    pickedCount: number,
    pickedPower: number
): string {
    const label = formatFilterLabel(spec.filter);
    const outstanding = tapOtherRemaining(spec, pickedCount, pickedPower);
    // CR 702.122a (Crew N) — the total-power shape has no fixed number of
    // picks, so the prompt counts down POWER, not permanents.
    if (outstanding.kind === "power") {
        return `tap ${pluralizeBare(label)} with total power ${outstanding.remaining} or more`;
    }
    const remaining = outstanding.remaining;
    if (remaining > 1) {
        return `tap ${remaining} more ${pluralizeBare(label)}`;
    }
    return `tap ${label}`;
}

/** Strips the leading article ("a"/"an") before pluralizing —
 *  `formatFilterLabel` returns "a creature", and "tap 3 more a creatures"
 *  reads as broken English (#954 review). */
function pluralizeBare(label: string): string {
    const bare = label.replace(/^an? /, "");
    return bare.endsWith("s") ? bare : `${bare}s`;
}
