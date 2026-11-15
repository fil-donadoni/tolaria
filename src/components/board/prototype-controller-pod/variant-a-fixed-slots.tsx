// PROTOTYPE — throwaway. Variant A "Fixed slots": the desktop twin of the
// portrait command row's variant-D rule. Three slots ALWAYS mounted at one
// height — morphing primary (CTA → status pill → disabled Pass), Pass Turn,
// Pass Until Action. Without priority Pass Turn / Until Action stay ENABLED:
// the server already accepts them as a queued intent (issue #157 / #5782) —
// today only the P / Enter hotkeys can reach that. Leftover actions (Attack
// with all, a queued-intent pill) float to the pod's LEFT, out of flow, so
// they never move its height either.
import type {
    ControllerAction,
    ControllerCue,
} from "~/hooks/useControllerActions";
import { selectCommandSlots } from "~/lib/controller-action-slots";
import ActionButton from "../action-button";
import ControllerCueBadge from "../controller-cue-badge";

const PILL =
    "flex h-10 w-full items-center justify-center truncate rounded-sm border border-border-strong bg-surface-elevated px-3 text-xs text-text-muted shadow-md transition-colors hover:text-text disabled:cursor-default disabled:opacity-70";

function queueable(
    cue: ControllerCue,
    base: ControllerAction | undefined,
    key: string,
    label: string,
    shortcut: ControllerAction["shortcut"]
): ControllerAction {
    if (base) return base;
    // No engine offer → the queued form: allowed unless an intent already runs.
    return {
        key,
        label,
        tone: "destructive",
        shortcut,
        disabled: cue === "auto-passing" || cue === "mine",
        onClick: () => {},
    };
}

export default function VariantAFixedSlots({
    cue,
    actions,
}: {
    cue: ControllerCue;
    actions: ControllerAction[];
}) {
    const slots = selectCommandSlots(actions);
    const passTurn = queueable(
        cue,
        slots.passTurn,
        "pass-turn",
        "Pass Turn",
        "P"
    );
    const until = queueable(
        cue,
        slots.passUntilAction,
        "pass-until-action",
        "Pass Until Action",
        "enter"
    );
    const queuedHint = !slots.passTurn && !passTurn.disabled;

    return (
        <>
            <ControllerCueBadge cue={cue} />
            <div className="relative flex flex-col gap-1.5">
                {slots.secondary.length > 0 && (
                    <div className="absolute right-full top-0 mr-3 flex w-44 flex-col gap-1.5">
                        {slots.secondary.map((a) =>
                            a.pill ? (
                                <button
                                    key={a.key}
                                    type="button"
                                    onClick={a.onClick}
                                    disabled={a.disabled}
                                    className={`${PILL} bg-surface-base/90 backdrop-blur-md`}
                                >
                                    {a.label}
                                </button>
                            ) : (
                                <ActionButton
                                    key={a.key}
                                    onClick={a.onClick}
                                    label={a.label}
                                    tone={a.tone}
                                    disabled={a.disabled}
                                    shortcut={a.shortcut}
                                />
                            )
                        )}
                    </div>
                )}

                {slots.primary ? (
                    <ActionButton
                        onClick={slots.primary.onClick}
                        label={slots.primary.label}
                        tone={slots.primary.tone}
                        disabled={slots.primary.disabled}
                        shortcut={
                            slots.primary.shortcut ??
                            (slots.primary.key === "pass" ? "space" : undefined)
                        }
                    />
                ) : slots.statusPill ? (
                    <button
                        type="button"
                        onClick={slots.statusPill.onClick}
                        disabled={slots.statusPill.disabled}
                        className={PILL}
                    >
                        {slots.statusPill.label}
                    </button>
                ) : (
                    <ActionButton
                        onClick={() => {}}
                        label="Pass"
                        tone="primary"
                        disabled
                        shortcut="space"
                    />
                )}

                <ActionButton
                    onClick={passTurn.onClick}
                    label={passTurn.label}
                    tone="destructive"
                    disabled={passTurn.disabled}
                    shortcut="P"
                />
                <ActionButton
                    onClick={until.onClick}
                    label={until.label}
                    tone="destructive"
                    disabled={until.disabled}
                    shortcut="enter"
                />
                <p
                    className={`h-3 text-center text-[9px] uppercase tracking-wide text-text-disabled ${queuedHint ? "" : "invisible"}`}
                >
                    queues until your priority
                </p>
            </div>
        </>
    );
}
