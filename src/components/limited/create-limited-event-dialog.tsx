import { useState } from "react";
import GameDialog from "~/components/ui/game-dialog";
import ActionButton from "~/components/board/action-button";
import { Input } from "~/components/ui/input";
import type { DraftableSetInfo } from "~/hooks/useLimitedEvent";
import {
    DEFAULT_SEALED_BOOSTER_COUNT,
    MAX_SEATS,
    MIN_SEATS,
} from "@convex/limited/eventLogic";
import type { LimitedEventType } from "@convex/limited/eventTypes";
import IncompletenessNotice from "./incompleteness-notice";

export interface CreateLimitedEventPayload {
    type: LimitedEventType;
    seatCount: number;
    packSlots: string[];
    sealedBoosterCount: number;
    /** Per-pick timer on/off (issue #1114, PRD #1107 story 5; ADR 0060 /
     *  issue #1243: a clear On/Off control, no seconds field — when on, each
     *  pick's countdown follows the official descending schedule indexed by
     *  cards remaining). Omitted/false when the admin leaves the timer off. */
    timerEnabled?: boolean;
}

interface CreateLimitedEventDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Every checked-in Booster Config's live Draftability (PRD #1107 story
     *  4) — a non-Draftable set is shown but disabled, with its missing-card
     *  count as the reason. */
    draftableSets: DraftableSetInfo[];
    onCreate: (payload: CreateLimitedEventPayload) => void;
    /** Create mutation in-flight — disables every control (project rule:
     *  mutation buttons disable while pending). */
    pending?: boolean;
    error?: string | null;
}

/** Admin-only "Create Event" form (PRD #1107 stories 1-6, ADR 0054/0055):
 *  event type (Sealed/Draft), 2-8 Seats, a Pack Source (Draftable Set), and —
 *  for Sealed — the booster count (default 6). Draft's pick/pass flow isn't
 *  playable yet (`startLimitedEvent` rejects it server-side), but the type
 *  choice is still offered here so the event skeleton doesn't need a second
 *  migration once Draft lands. */
export default function CreateLimitedEventDialog({
    open,
    onOpenChange,
    draftableSets,
    onCreate,
    pending = false,
    error,
}: CreateLimitedEventDialogProps) {
    const [type, setType] = useState<LimitedEventType>("sealed");
    const [seatCount, setSeatCount] = useState(4);
    const firstDraftable = draftableSets.find((s) => s.draftable)?.setCode;
    const [setCode, setSetCode] = useState<string | undefined>(firstDraftable);
    const [sealedBoosterCount, setSealedBoosterCount] = useState(
        DEFAULT_SEALED_BOOSTER_COUNT
    );
    const [timerEnabled, setTimerEnabled] = useState(false);

    const resolvedSetCode = setCode ?? firstDraftable;
    const canSubmit = !pending && resolvedSetCode !== undefined;
    const selectedSetInfo = draftableSets.find(
        (s) => s.setCode === resolvedSetCode
    );

    const handleSubmit = () => {
        if (!canSubmit || !resolvedSetCode) return;
        onCreate({
            type,
            seatCount,
            packSlots: [resolvedSetCode],
            sealedBoosterCount,
            timerEnabled: type === "draft" && timerEnabled,
        });
    };

    return (
        <GameDialog
            open={open}
            onOpenChange={onOpenChange}
            title="Create Limited Event"
            subtitle="Set up a Sealed or Draft pod from a Draftable Set."
            footer={
                <>
                    <ActionButton
                        onClick={() => onOpenChange(false)}
                        label="Cancel"
                        tone="secondary"
                        disabled={pending}
                    />
                    <ActionButton
                        onClick={handleSubmit}
                        label="Create Event"
                        tone="primary"
                        disabled={!canSubmit}
                    />
                </>
            }
        >
            <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                        Event Type
                    </span>
                    <div
                        role="radiogroup"
                        aria-label="Event Type"
                        className="inline-flex overflow-hidden rounded-sm border border-border-subtle/40"
                    >
                        {(
                            [
                                { value: "sealed", label: "Sealed" },
                                { value: "draft", label: "Draft" },
                            ] as const
                        ).map((opt) => (
                            <button
                                key={opt.value}
                                type="button"
                                role="radio"
                                aria-checked={type === opt.value}
                                disabled={pending}
                                onClick={() => setType(opt.value)}
                                className={
                                    "px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 " +
                                    (type === opt.value
                                        ? "bg-accent text-surface-base"
                                        : "bg-surface-elevated/30 text-text hover:bg-surface-elevated/50")
                                }
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </div>

                <label className="flex flex-col gap-1 text-sm">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                        Seats ({MIN_SEATS}-{MAX_SEATS})
                    </span>
                    <Input
                        type="number"
                        min={MIN_SEATS}
                        max={MAX_SEATS}
                        value={seatCount}
                        disabled={pending}
                        onChange={(e) =>
                            setSeatCount(
                                Math.max(
                                    MIN_SEATS,
                                    Math.min(
                                        MAX_SEATS,
                                        Number(e.currentTarget.value) ||
                                            MIN_SEATS
                                    )
                                )
                            )
                        }
                    />
                    <span className="text-xs text-text-muted">
                        Unfilled seats become bots when the event starts — for
                        a solo draft, set the full table (e.g. {MAX_SEATS}).
                    </span>
                </label>

                <div className="flex flex-col gap-1 text-sm">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                        Pack Source
                    </span>
                    <div className="flex flex-col gap-1">
                        {draftableSets.length === 0 && (
                            <p className="text-xs text-text-muted">
                                No Draftable Sets available yet.
                            </p>
                        )}
                        {draftableSets.map((set) => (
                            <label
                                key={set.setCode}
                                className={
                                    "flex items-center justify-between rounded-sm border px-2 py-1.5 " +
                                    (set.draftable
                                        ? "cursor-pointer border-border-subtle/40"
                                        : "cursor-not-allowed border-border-subtle/20 opacity-50")
                                }
                            >
                                <span className="flex items-center gap-2">
                                    <input
                                        type="radio"
                                        name="limited-pack-source"
                                        disabled={!set.draftable || pending}
                                        checked={
                                            resolvedSetCode === set.setCode
                                        }
                                        onChange={() => setSetCode(set.setCode)}
                                    />
                                    <span className="uppercase">
                                        {set.setCode}
                                    </span>
                                </span>
                                {!set.draftable && (
                                    <span className="text-xs text-text-muted">
                                        {set.missingCardCount} card
                                        {set.missingCardCount === 1
                                            ? ""
                                            : "s"}{" "}
                                        missing
                                    </span>
                                )}
                            </label>
                        ))}
                    </div>
                    <IncompletenessNotice set={selectedSetInfo} />
                </div>

                {type === "sealed" && (
                    <label className="flex flex-col gap-1 text-sm">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                            Sealed Boosters per Seat
                        </span>
                        <Input
                            type="number"
                            min={1}
                            value={sealedBoosterCount}
                            disabled={pending}
                            onChange={(e) =>
                                setSealedBoosterCount(
                                    Math.max(
                                        1,
                                        Number(e.currentTarget.value) ||
                                            DEFAULT_SEALED_BOOSTER_COUNT
                                    )
                                )
                            }
                        />
                    </label>
                )}

                {type === "draft" && (
                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                            Pick Timer
                        </span>
                        <div
                            role="radiogroup"
                            aria-label="Pick Timer"
                            className="inline-flex overflow-hidden rounded-sm border border-border-subtle/40"
                        >
                            {(
                                [
                                    { value: false, label: "Off" },
                                    { value: true, label: "On" },
                                ] as const
                            ).map((opt) => (
                                <button
                                    key={String(opt.value)}
                                    type="button"
                                    role="radio"
                                    aria-checked={timerEnabled === opt.value}
                                    disabled={pending}
                                    onClick={() => setTimerEnabled(opt.value)}
                                    className={
                                        "px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 " +
                                        (timerEnabled === opt.value
                                            ? "bg-accent text-surface-base"
                                            : "bg-surface-elevated/30 text-text hover:bg-surface-elevated/50")
                                    }
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                        <span className="text-xs text-text-muted">
                            {timerEnabled
                                ? "On — each pick's time tightens through the pack on the official schedule; an expired pick auto-picks with the bot engine."
                                : "Off — seats pick at their own pace."}
                        </span>
                    </div>
                )}

                {error && <p className="text-sm text-danger-strong">{error}</p>}
            </div>
        </GameDialog>
    );
}
