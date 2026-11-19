import type { ReactNode } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { cn } from "~/lib/utils";

/** The deck-status block of the Ready dock (issue #9820): ✓/⚠ badge,
 *  "Maindeck 60 / 60+", and one line saying what the window did. `trailing`
 *  rides the row on a phone (the opponent status). */
export default function SideboardDeckStatus({
    mainCount,
    lockedSize,
    sideCount,
    ins,
    outs,
    trailing,
}: {
    mainCount: number;
    lockedSize: number;
    sideCount: number;
    ins: number;
    outs: number;
    trailing?: ReactNode;
}) {
    const missing = lockedSize - mainCount;
    const ok = missing <= 0;
    const line = !ok
        ? `${missing} ${missing === 1 ? "card" : "cards"} short — bring ${missing === 1 ? "one" : "some"} back in`
        : ins + outs === 0
          ? "Same deck as last game"
          : `${ins} in · ${outs} out · Sideboard ${sideCount}`;
    return (
        <div className="flex min-w-0 items-center gap-3">
            <span
                aria-hidden
                className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full border-2 md:size-10",
                    ok
                        ? "border-success/70 bg-success-soft text-success-strong"
                        : "border-danger/70 bg-danger-soft text-danger-strong"
                )}
            >
                {ok ? (
                    <Check className="size-5" strokeWidth={3} />
                ) : (
                    <AlertTriangle className="size-5" />
                )}
            </span>
            <div className="min-w-0">
                <div className="text-base font-semibold text-parchment tabular-nums">
                    Maindeck {mainCount}
                    <span className="font-normal text-text-muted">
                        {" "}
                        / {lockedSize}+
                    </span>
                </div>
                <div
                    data-deck-status-line
                    className={cn(
                        "text-xs tabular-nums",
                        ok ? "text-text-muted" : "text-danger-strong"
                    )}
                >
                    {line}
                </div>
            </div>
            {trailing && (
                <div className="ml-auto flex items-center gap-2 md:hidden">
                    {trailing}
                </div>
            )}
        </div>
    );
}
