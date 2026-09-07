import { cn } from "@/lib/utils";
import { toneRuleClass, toneTextClass } from "../../lib/tones";
import { verdictTone, VERDICT_TERM } from "../../lib/verdict";
import { Term } from "../Term";
import { InfoMark } from "../InfoMark";
import { Remedy } from "./Remedy";
import { FindingRow } from "./FindingRow";
import { ActionButton } from "./ActionButton";
import type { LoopVerdict } from "../../lib/nowPayload";

/**
 * The loop verdict band (#2624, ported in PRD #3148 S2) — the one health
 * statement on the page.
 *
 * It renders `deriveLoopVerdict`'s output and nothing else. The four traffic
 * lights below state facts about their OWN subsystems and can never contradict
 * this, because they are not making the same claim (see `nowLights.ts`).
 *
 * `remedyAction` is a STRUCTURAL discriminator the engine sets alongside the
 * remedy's wording (#2636), so the action button is a lookup, never a
 * pattern-match on `remedy`'s prose. A verdict whose `remedyAction` is `null`
 * renders no button — the remedy stays copy-only.
 */
export function VerdictBand({ verdict }: { verdict: LoopVerdict }) {
    const tone = verdictTone(verdict.state);
    const findings = verdict.findings ?? [];
    return (
        <div
            className={cn(
                "bg-card flex flex-col gap-2 rounded-lg border border-l-2 p-4",
                toneRuleClass(tone)
            )}
        >
            <div className="flex flex-wrap items-center gap-2">
                <span
                    className={cn(
                        "text-sm font-semibold tracking-tight",
                        toneTextClass(tone)
                    )}
                >
                    <Term id={VERDICT_TERM[verdict.state]}>
                        {verdict.state}
                    </Term>
                </span>
                <InfoMark id="section.verdict" what="the loop verdict" />
                <span className="text-sm">{verdict.sentence}</span>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground font-medium">
                    Next step
                </span>
                <Remedy remedy={verdict.remedy} />
                {verdict.remedyAction ? (
                    <ActionButton
                        action={verdict.remedyAction}
                        emphasis="primary"
                    />
                ) : null}
            </div>

            {findings.length > 0 ? (
                <div className="flex flex-col gap-1">
                    <span className="text-muted-foreground text-xs font-medium">
                        Evidence
                    </span>
                    {findings.map((f) => (
                        <FindingRow key={f.code} finding={f} />
                    ))}
                </div>
            ) : null}
        </div>
    );
}
