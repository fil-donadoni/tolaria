import { useState } from "react";
import GameDialog from "~/components/ui/game-dialog";
import ActionButton from "~/components/board/action-button";
import { Input } from "~/components/ui/input";
import type { DraftableSetInfo } from "~/hooks/useLimitedEvent";
import {
    DEFAULT_SEALED_BOOSTER_COUNT,
    DRAFT_BOOSTER_COUNT,
    MAX_SEATS,
    MIN_SEATS,
} from "@convex/limited/eventLogic";
import { CUBE_PACK_SIZE, maxCubeSeats } from "@convex/limited/cube";
import type { LimitedEventType } from "@convex/limited/eventTypes";
import {
    DEFAULT_MATCH_FORMAT,
    DEFAULT_ROUND_DEADLINE_MINUTES,
    MAX_ROUND_DEADLINE_MINUTES,
    MIN_ROUND_DEADLINE_MINUTES,
    type LimitedMatchFormat,
} from "@convex/limited/matchFormat";
import IncompletenessNotice from "./incompleteness-notice";
import CubeAvailabilityNote from "./cube-availability-note";

/** Human-facing Pack Source label — the Vintage Cube pool source (ADR 0062)
 *  shows a proper name, every real set shows its uppercased code. */
function packSourceLabel(set: DraftableSetInfo): string {
    return set.isCube ? "Vintage Cube" : set.setCode.toUpperCase();
}

/** Whether a Pack Source can be chosen for the given event type. The Vintage
 *  Cube is a DRAFT-only pool source (ADR 0062: the singleton pool-as-source
 *  path is wired into the draft engine, not the Sealed pool generator); every
 *  real Draftable Set works for both. */
function isSourceSelectable(
    set: DraftableSetInfo,
    type: LimitedEventType
): boolean {
    if (!set.draftable) return false;
    if (set.isCube) return type === "draft";
    return true;
}

/** Keeps the typed round deadline inside the bounds `createLimitedEvent`
 *  actually accepts (`isValidRoundDeadlineMinutes`), so a stray keystroke
 *  produces a clamped value rather than a server error. Both bounds come from
 *  the shared `matchFormat` module — the client can't drift from the server. */
function clampRoundDeadline(value: number): number {
    if (!Number.isFinite(value)) return DEFAULT_ROUND_DEADLINE_MINUTES;
    return Math.max(
        MIN_ROUND_DEADLINE_MINUTES,
        Math.min(MAX_ROUND_DEADLINE_MINUTES, Math.round(value))
    );
}

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
    /** Match Format of the event's round matches (PRD #1628 stories 1-2,
     *  issue #1640) — Bo1 or Bo3, defaulting to Bo3 so the event plays like
     *  real Limited with nothing configured. Always sent (never omitted): the
     *  creator's choice is explicit, and the server's tolerant default exists
     *  for OLD documents, not for new ones. */
    matchFormat: LimitedMatchFormat;
    /** Optional round deadline in minutes (PRD #1628 stories 3-4). Omitted
     *  when the creator leaves the deadline off — a relaxed table among
     *  friends is never cut short by a timer. */
    roundDeadlineMinutes?: number;
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
 *  for Sealed only — an editable booster count (default 6, story 8). Draft's
 *  booster count is fixed at `DRAFT_BOOSTER_COUNT` (3, PRD #1241 story 7 /
 *  issue #1246) and never shown as an editable field — a classic Draft is
 *  always three boosters. */
export default function CreateLimitedEventDialog({
    open,
    onOpenChange,
    draftableSets,
    onCreate,
    pending = false,
    error,
}: CreateLimitedEventDialogProps) {
    const [type, setType] = useState<LimitedEventType>("sealed");
    const [seatCount, setSeatCount] = useState(8);
    const firstDraftable = draftableSets.find((s) => s.draftable)?.setCode;
    const [setCode, setSetCode] = useState<string | undefined>(firstDraftable);
    const [sealedBoosterCount, setSealedBoosterCount] = useState(
        DEFAULT_SEALED_BOOSTER_COUNT
    );
    const [timerEnabled, setTimerEnabled] = useState(false);
    // Match Format + round deadline (PRD #1628 stories 1-4). Bo3 is the
    // default (story 2); the deadline is OFF by default (story 4), held as an
    // enabled flag + a value so toggling it off doesn't lose what was typed.
    const [matchFormat, setMatchFormat] =
        useState<LimitedMatchFormat>(DEFAULT_MATCH_FORMAT);
    const [deadlineEnabled, setDeadlineEnabled] = useState(false);
    const [roundDeadlineMinutes, setRoundDeadlineMinutes] = useState(
        DEFAULT_ROUND_DEADLINE_MINUTES
    );

    const resolvedSetCode = setCode ?? firstDraftable;
    const selectedSetInfo = draftableSets.find(
        (s) => s.setCode === resolvedSetCode
    );
    // The selected source must be usable for the current event type — the
    // Vintage Cube (ADR 0062) is Draft-only, so a cube selection carried over
    // into Sealed blocks submit rather than reaching the Sealed pool generator.
    const selectionUsable =
        selectedSetInfo !== undefined &&
        isSourceSelectable(selectedSetInfo, type);
    // Vintage Cube singleton capacity cap (ADR 0062 rev): a cube deals one copy
    // of each card, so the table can be no larger than the implemented pool
    // fills singleton over the 3 boosters. Cap the seat control to match the
    // server guard (`createLimitedEvent`) so an oversized table can't even be
    // submitted. Non-cube sources keep the full 2–8 range.
    const isCubeDraft = selectedSetInfo?.isCube === true && type === "draft";
    const seatMax = isCubeDraft
        ? Math.max(
              MIN_SEATS,
              Math.min(
                  MAX_SEATS,
                  maxCubeSeats(
                      selectedSetInfo?.availableCardCount ?? 0,
                      CUBE_PACK_SIZE,
                      DRAFT_BOOSTER_COUNT
                  )
              )
          )
        : MAX_SEATS;
    const effectiveSeatCount = Math.min(seatCount, seatMax);
    const canSubmit = !pending && selectionUsable;

    const handleSubmit = () => {
        if (!canSubmit || !resolvedSetCode) return;
        // Draft is a fixed 3-booster classic draft (PRD #1241 story 7, issue
        // #1246) — packSlots is DRAFT_BOOSTER_COUNT copies of the chosen set,
        // not a single element. `draftEngine.ts`'s `applyPick` completes the
        // draft exactly when `packSlots.length` rounds have emptied, so a
        // single-element list (the pre-fix bug) ended the draft after one
        // booster. Sealed keeps its single-entry `packSlots`, cycled
        // `sealedBoosterCount` times by `generateSealedPools`.
        const packSlots =
            type === "draft"
                ? Array.from(
                      { length: DRAFT_BOOSTER_COUNT },
                      () => resolvedSetCode
                  )
                : [resolvedSetCode];
        onCreate({
            type,
            seatCount: effectiveSeatCount,
            packSlots,
            sealedBoosterCount,
            timerEnabled: type === "draft" && timerEnabled,
            matchFormat,
            roundDeadlineMinutes: deadlineEnabled
                ? roundDeadlineMinutes
                : undefined,
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
                        Seats ({MIN_SEATS}-{seatMax})
                    </span>
                    <Input
                        type="number"
                        min={MIN_SEATS}
                        max={seatMax}
                        value={effectiveSeatCount}
                        disabled={pending}
                        onChange={(e) =>
                            setSeatCount(
                                Math.max(
                                    MIN_SEATS,
                                    Math.min(
                                        seatMax,
                                        Number(e.currentTarget.value) ||
                                            MIN_SEATS
                                    )
                                )
                            )
                        }
                    />
                    <span className="text-xs text-text-muted">
                        {isCubeDraft && seatMax < MAX_SEATS
                            ? `Vintage Cube deals one copy of each card, so the table is capped at ${seatMax} seats until the implemented pool grows.`
                            : `Unfilled seats become bots when the event starts — for a solo draft, set the full table (e.g. ${seatMax}).`}
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
                        {draftableSets.map((set) => {
                            const selectable = isSourceSelectable(set, type);
                            return (
                                <label
                                    key={set.setCode}
                                    className={
                                        "flex items-center justify-between rounded-sm border px-2 py-1.5 " +
                                        (selectable
                                            ? "cursor-pointer border-border-subtle/40"
                                            : "cursor-not-allowed border-border-subtle/20 opacity-50")
                                    }
                                >
                                    <span className="flex items-center gap-2">
                                        <input
                                            type="radio"
                                            name="limited-pack-source"
                                            disabled={!selectable || pending}
                                            checked={
                                                resolvedSetCode === set.setCode
                                            }
                                            onChange={() =>
                                                setSetCode(set.setCode)
                                            }
                                        />
                                        <span
                                            className={
                                                set.isCube ? "" : "uppercase"
                                            }
                                        >
                                            {packSourceLabel(set)}
                                        </span>
                                    </span>
                                    {set.isCube ? (
                                        <span className="text-xs text-text-muted">
                                            {set.availableCardCount ?? 0} card
                                            {(set.availableCardCount ?? 0) === 1
                                                ? ""
                                                : "s"}{" "}
                                            {type === "draft"
                                                ? "available"
                                                : "· Draft only"}
                                        </span>
                                    ) : (
                                        !set.draftable && (
                                            <span className="text-xs text-text-muted">
                                                {set.missingCardCount} card
                                                {set.missingCardCount === 1
                                                    ? ""
                                                    : "s"}{" "}
                                                missing
                                            </span>
                                        )
                                    )}
                                </label>
                            );
                        })}
                    </div>
                    <IncompletenessNotice set={selectedSetInfo} />
                    <CubeAvailabilityNote set={selectedSetInfo} />
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

                <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                        Match Format
                    </span>
                    <div
                        role="radiogroup"
                        aria-label="Match Format"
                        className="inline-flex overflow-hidden rounded-sm border border-border-subtle/40"
                    >
                        {(
                            [
                                { value: "bo1", label: "Bo1" },
                                { value: "bo3", label: "Bo3" },
                            ] as const
                        ).map((opt) => (
                            <button
                                key={opt.value}
                                type="button"
                                role="radio"
                                aria-checked={matchFormat === opt.value}
                                disabled={pending}
                                onClick={() => setMatchFormat(opt.value)}
                                className={
                                    "px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 " +
                                    (matchFormat === opt.value
                                        ? "bg-accent text-surface-base"
                                        : "bg-surface-elevated/30 text-text hover:bg-surface-elevated/50")
                                }
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                    <span className="text-xs text-text-muted">
                        {matchFormat === "bo1"
                            ? "Bo1 — one game decides each round pairing."
                            : "Bo3 — each round pairing is a best-of-three with sideboarding, like real Limited."}
                    </span>
                </div>

                <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                        Round Deadline
                    </span>
                    <div
                        role="radiogroup"
                        aria-label="Round Deadline"
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
                                // Explicit accessible name: the visible label
                                // is the same "Off"/"On" the Pick Timer group
                                // uses, and two radios with an identical name
                                // are ambiguous to assistive tech (and to any
                                // by-name query).
                                aria-label={`Round Deadline ${opt.label}`}
                                aria-checked={deadlineEnabled === opt.value}
                                disabled={pending}
                                onClick={() => setDeadlineEnabled(opt.value)}
                                className={
                                    "px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 " +
                                    (deadlineEnabled === opt.value
                                        ? "bg-accent text-surface-base"
                                        : "bg-surface-elevated/30 text-text hover:bg-surface-elevated/50")
                                }
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                    {deadlineEnabled ? (
                        <label className="flex flex-col gap-1 text-sm">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                                Minutes per Round
                            </span>
                            <Input
                                type="number"
                                aria-label="Minutes per Round"
                                min={MIN_ROUND_DEADLINE_MINUTES}
                                max={MAX_ROUND_DEADLINE_MINUTES}
                                value={roundDeadlineMinutes}
                                disabled={pending}
                                onChange={(e) =>
                                    setRoundDeadlineMinutes(
                                        clampRoundDeadline(
                                            Number(e.currentTarget.value)
                                        )
                                    )
                                }
                            />
                            <span className="text-xs text-text-muted">
                                An unplayed pairing is closed as a loss when the
                                round's time runs out, so one absent player
                                cannot freeze the table.
                            </span>
                        </label>
                    ) : (
                        <span className="text-xs text-text-muted">
                            Off — rounds never expire; the table waits for every
                            pairing to be played.
                        </span>
                    )}
                </div>

                {error && <p className="text-sm text-danger-strong">{error}</p>}
            </div>
        </GameDialog>
    );
}
