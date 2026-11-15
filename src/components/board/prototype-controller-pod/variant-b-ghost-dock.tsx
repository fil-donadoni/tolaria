// PROTOTYPE — throwaway. Variant B "Ghost dock": keeps today's look (the same
// stacked ActionButtons) but the action area RESERVES the height of the
// three-button stack. Without priority the three buttons stay drawn as faint
// ghosts and the status sits over them, centred — clickable when it is a
// cancel ("Auto-passing… (cancel)"). Only a state with MORE than three actions
// (declare attackers: 4) still grows the pod.
import type {
    ControllerAction,
    ControllerCue,
} from "~/hooks/useControllerActions";
import ActionButton from "../action-button";
import ControllerCueBadge from "../controller-cue-badge";

const STATUS_TEXT: Record<ControllerCue, string> = {
    mine: "Your go",
    opponent: "Opponent to act",
    waiting: "Waiting on opponent",
    "auto-passing": "Auto-passing",
};

export default function VariantBGhostDock({
    cue,
    actions,
}: {
    cue: ControllerCue;
    actions: ControllerAction[];
}) {
    const buttons = actions.filter((a) => !a.pill);
    const pills = actions.filter((a) => a.pill);

    return (
        <>
            <ControllerCueBadge cue={cue} />
            {/* 3 × 40px + 2 × 6px gap = 132px reserved, always. */}
            <div className="relative flex min-h-[132px] flex-col gap-1.5">
                {buttons.length > 0 ? (
                    buttons.map((a) => (
                        <ActionButton
                            key={a.key}
                            onClick={a.onClick}
                            label={a.label}
                            tone={a.tone}
                            disabled={a.disabled}
                            shortcut={
                                a.shortcut ??
                                (a.key === "pass" ? "space" : undefined)
                            }
                        />
                    ))
                ) : (
                    <>
                        <div
                            aria-hidden
                            className="pointer-events-none flex flex-col gap-1.5 opacity-[0.06]"
                        >
                            <ActionButton
                                onClick={() => {}}
                                label="Pass"
                                tone="primary"
                                shortcut="space"
                            />
                            <ActionButton
                                onClick={() => {}}
                                label="Pass Turn"
                                tone="destructive"
                                shortcut="P"
                            />
                            <ActionButton
                                onClick={() => {}}
                                label="Pass Until Action"
                                tone="destructive"
                                shortcut="enter"
                            />
                        </div>
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-1">
                            {pills.length > 0 ? (
                                pills.map((p) => (
                                    <button
                                        key={p.key}
                                        type="button"
                                        onClick={p.onClick}
                                        disabled={p.disabled}
                                        className="w-full rounded-sm border border-border-strong bg-surface-base/95 px-3 py-2 text-center text-xs text-text-muted shadow-md backdrop-blur-md transition-colors hover:text-text disabled:cursor-default disabled:opacity-90"
                                    >
                                        {p.label}
                                    </button>
                                ))
                            ) : (
                                <>
                                    <span className="text-display text-base text-text-muted">
                                        {STATUS_TEXT[cue]}
                                    </span>
                                    <span className="text-center text-[10px] uppercase tracking-wide text-text-disabled">
                                        P queues Pass Turn · ⏎ queues Until
                                        Action
                                    </span>
                                </>
                            )}
                        </div>
                    </>
                )}
                {buttons.length > 0 &&
                    pills.map((p) => (
                        <button
                            key={p.key}
                            type="button"
                            onClick={p.onClick}
                            disabled={p.disabled}
                            className="rounded-sm border border-border-strong bg-surface-elevated px-3 py-2 text-center text-xs text-text-muted shadow-md"
                        >
                            {p.label}
                        </button>
                    ))}
            </div>
        </>
    );
}
