// PROTOTYPE — throwaway. Prototype chrome (fuchsia, not product UI): jump to
// any phase; in Waiting, flip the viewpoint between creator and visitor.
import { cn } from "~/lib/utils";
import { PHASES } from "./event-mock";
import type { EventProto } from "./use-event-proto";

export default function PhasePills({ p }: { p: EventProto }) {
    return (
        <div className="flex flex-wrap items-center justify-center gap-2">
            <div className="flex flex-wrap justify-center gap-1 rounded-full border border-fuchsia-600/50 bg-fuchsia-950/30 p-1 text-[11px] font-semibold">
                {PHASES.map((ph) => (
                    <button
                        key={ph.key}
                        type="button"
                        onClick={() => p.setPhase(ph.key)}
                        className={cn(
                            "rounded-full px-2.5 py-1",
                            ph.key === p.phase
                                ? "bg-fuchsia-600 text-white"
                                : "text-fuchsia-200 hover:bg-fuchsia-900/50"
                        )}
                    >
                        {ph.label}
                    </button>
                ))}
            </div>
            {p.phase === "waiting" && (
                <div className="flex gap-1 rounded-full border border-fuchsia-600/50 bg-fuchsia-950/30 p-1 text-[11px] font-semibold">
                    {(["creator", "visitor"] as const).map((v) => (
                        <button
                            key={v}
                            type="button"
                            onClick={() => p.setViewpoint(v)}
                            className={cn(
                                "rounded-full px-2.5 py-1",
                                v === p.viewpoint
                                    ? "bg-fuchsia-600 text-white"
                                    : "text-fuchsia-200"
                            )}
                        >
                            as {v}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
