import { StateBadge } from "../StateBadge";
import { DynamicTerm } from "../DynamicTerm";
import type { LoopFinding } from "../../lib/nowPayload";

/**
 * One piece of evidence behind the verdict (issue #3135, ported in S2): the
 * engine's own code as a badge, then its detail sentence.
 *
 * The CODE stays visible — it is what `bun run loop:status` prints and what
 * `loop-drain.log`'s reason column says — but it is no longer the only word.
 * The badge carries `finding.<code>`, so the code explains itself; the key is
 * composed from a server value, which is what `DynamicTerm` is for.
 */
export function FindingRow({ finding }: { finding: LoopFinding }) {
    return (
        <div className="flex flex-wrap items-center gap-2 text-xs">
            <StateBadge tone="warn">
                <DynamicTerm term={`finding.${finding.code}`}>
                    {finding.code}
                </DynamicTerm>
            </StateBadge>
            <span className="text-muted-foreground">{finding.detail}</span>
        </div>
    );
}
