import { useNavigate } from "@tanstack/react-router";
import type { LimitedSetup } from "~/lib/limited/limitedSetup";
import { Button } from "@/components/ui/button";
import { cn } from "~/lib/utils";

/** The solid parchment "New event" tile (PRD #5383): wins the hub by contrast.
 *  "Again" starts the remembered setup in one click; the second button opens
 *  `/limited/new` to choose. `again` is `null` until the Pack Source catalogue
 *  has loaded — the button then waits rather than guess. */
export default function LimitedHubNewEventTile({
    again,
    summary,
    busy,
    error,
    onAgain,
    className,
}: {
    again: LimitedSetup | null;
    /** The remembered setup in words: "Draft · Vintage Cube · 8 seats". */
    summary: string;
    busy: boolean;
    error: string | null;
    onAgain: () => void;
    className?: string;
}) {
    const navigate = useNavigate();
    return (
        <article
            data-hub-tile="new-event"
            className={cn(
                "flex flex-col justify-between gap-3 rounded-[var(--panel-radius)] bg-parchment p-4 text-surface",
                className
            )}
        >
            <div className="flex flex-col gap-1">
                <h3 className="font-display text-xl leading-tight">
                    New event
                </h3>
                {again && <p className="text-xs opacity-80">{summary}</p>}
                {error && (
                    <p role="alert" className="text-xs font-semibold">
                        {error}
                    </p>
                )}
            </div>
            <div className="flex flex-wrap gap-2">
                <Button
                    type="button"
                    variant="primary"
                    className="!border-surface !bg-surface !bg-none !text-parchment disabled:!border-surface/40 disabled:!bg-surface/40 disabled:!text-parchment/70"
                    disabled={again === null || busy}
                    onClick={onAgain}
                >
                    Again: your last event
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    className="!text-surface"
                    onClick={() => void navigate({ to: "/limited/new" })}
                >
                    Choose format, seats, timers…
                </Button>
            </div>
        </article>
    );
}
