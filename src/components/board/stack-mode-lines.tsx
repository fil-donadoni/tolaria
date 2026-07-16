import { formatOracleText } from "~/lib/oracle-text";
import type { StackModeLine } from "~/lib/card-utils";

type StackModeLinesProps = {
    lines: StackModeLine[];
};

/** CR 700.2c (issue #1274) — the chosen-mode caption shown beneath a modal
 *  spell on the stack. Renders every declared mode's oracle line, highlighting
 *  the one the caster locked in at cast and de-emphasizing the rest, so BOTH
 *  players can see which mode is resolving before deciding whether to respond.
 *
 *  Presentational only — the caller supplies `lines` from `getStackModeLines`,
 *  which reads the wire-preserved `chosenModeId`. */
export default function StackModeLines({ lines }: StackModeLinesProps) {
    return (
        <div
            className="w-32 mt-1 rounded bg-surface/90 ring-1 ring-border-subtle px-1.5 py-1 space-y-0.5 text-left"
            data-testid="stack-mode-lines"
        >
            {lines.map((line) => (
                <div
                    key={line.modeId}
                    data-mode-id={line.modeId}
                    data-mode-chosen={line.chosen}
                    className={
                        line.chosen
                            ? "flex gap-1 text-[9px] leading-tight font-semibold text-accent"
                            : "flex gap-1 text-[9px] leading-tight text-text-muted/60"
                    }
                >
                    <span aria-hidden className="shrink-0">
                        {line.chosen ? "▸" : "•"}
                    </span>
                    <span className="min-w-0">
                        {formatOracleText(line.oracleText)}
                    </span>
                </div>
            ))}
        </div>
    );
}
