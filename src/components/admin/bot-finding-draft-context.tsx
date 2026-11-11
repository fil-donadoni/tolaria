import type { DraftContext } from "@convex/botFindingsCore";
import { draftContextRerunText } from "@/lib/botFindings";

/**
 * A Draft Lab report's rerun context (issue #8900): everything the Draft Lab
 * needs to deal the same draft again and focus the reported seat — the Pack
 * Source, the seed, the seat — and the scorer version it was picked under.
 */
export default function BotFindingDraftContext({
    context,
}: {
    context: DraftContext;
}) {
    return (
        <p
            data-bot-finding-draft-context=""
            className="font-mono text-xs text-text"
        >
            {draftContextRerunText(context)}
        </p>
    );
}
