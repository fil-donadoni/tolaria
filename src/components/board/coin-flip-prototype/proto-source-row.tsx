// PROTOTYPE (issue #4433) — the flip's source, laid out like a stack row
// (`stack-row.tsx`): art tile + kind badge, name + mana pips + controller
// chip, then the Oracle excerpt the flip comes from.
import { tryGetDefinition } from "@convex/cards";
import { manaCostToString } from "~/lib/card-utils";
import { formatOracleText } from "~/lib/oracle-text";
import { ART_CROP_RATIO, getArtCropImageUrl } from "~/lib/images";
import { seatName, type ProtoScenario } from "./prototype-scenarios";

export default function ProtoSourceRow({
    scenario,
}: {
    scenario: ProtoScenario;
}) {
    const def = tryGetDefinition(scenario.sourceId);
    const mine = scenario.sourceController === "you";
    return (
        <div className="flex w-full gap-3 rounded-[var(--panel-radius)] border border-accent/50 bg-accent-soft/40 p-2 text-left">
            <span className="relative block w-16 shrink-0 self-start">
                <span
                    className="relative block overflow-hidden card-corner"
                    style={{ aspectRatio: ART_CROP_RATIO }}
                >
                    <img
                        src={getArtCropImageUrl(scenario.sourceId)}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover"
                    />
                </span>
                <span className="mt-0.5 block rounded-sm bg-black/70 px-1 py-0.5 text-center text-[8px] font-semibold tracking-wider text-text uppercase">
                    {scenario.sourceKind}
                </span>
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-display text-sm text-text">
                        {scenario.sourceName}
                    </span>
                    {def?.manaCost && (
                        <span className="text-[10px]">
                            {formatOracleText(manaCostToString(def.manaCost))}
                        </span>
                    )}
                    <span
                        className={`inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            mine
                                ? "bg-signal-self/15 text-signal-self-strong"
                                : "bg-signal-opponent/15 text-signal-opponent-strong"
                        }`}
                    >
                        <span
                            className={`h-1.5 w-1.5 rounded-full ${mine ? "bg-signal-self" : "bg-signal-opponent"}`}
                        />
                        {seatName(scenario.sourceController)}
                    </span>
                </span>
                <span className="text-[11px] leading-snug whitespace-pre-line text-text-muted">
                    {formatOracleText(scenario.oracleExcerpt)}
                </span>
            </span>
        </div>
    );
}
