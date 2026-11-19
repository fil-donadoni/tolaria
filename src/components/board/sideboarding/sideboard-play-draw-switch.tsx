import { cn } from "~/lib/utils";

type PlayDraw = "play" | "draw";

const OPTIONS: readonly { value: PlayDraw; label: string }[] = [
    { value: "play", label: "Play first" },
    { value: "draw", label: "Draw first" },
];

/** The chooser's big two-option switch (issue #9820), shown only to the
 *  Player who lost the last game. The
 *  caption hides on a phone. */
export default function SideboardPlayDrawSwitch({
    lostGame,
    value,
    onChange,
    disabled,
}: {
    lostGame: number;
    value: PlayDraw;
    onChange: (value: PlayDraw) => void;
    disabled: boolean;
}) {
    return (
        <div className="flex flex-col gap-1 md:ml-auto">
            <span className="hidden text-[11px] uppercase tracking-wide text-text-muted md:inline">
                You lost game {lostGame} — you choose
            </span>
            <div
                role="radiogroup"
                aria-label="Play or draw first"
                className="flex rounded-lg border border-border-strong bg-surface-base p-1"
            >
                {OPTIONS.map((o) => (
                    <button
                        key={o.value}
                        type="button"
                        role="radio"
                        aria-checked={value === o.value}
                        disabled={disabled}
                        onClick={() => onChange(o.value)}
                        className={cn(
                            "flex-1 rounded-md px-4 py-1.5 text-sm font-medium transition-colors md:min-w-28",
                            value === o.value
                                ? "bg-surface-elevated text-parchment shadow-[inset_0_0_0_1px_var(--color-accent)]"
                                : "text-text-muted hover:text-parchment"
                        )}
                    >
                        {o.label}
                    </button>
                ))}
            </div>
        </div>
    );
}
