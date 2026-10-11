import { useState } from "react";
import GameDialog from "~/components/ui/game-dialog";
import ActionButton from "~/components/board/action-button";
import { Input } from "~/components/ui/input";
import type { PackSourceInfo } from "~/hooks/useLimitedEvent";
import {
    DEFAULT_SEALED_BOOSTER_COUNT,
    DRAFT_BOOSTER_COUNT,
    MAX_SEATS,
    MIN_SEATS,
} from "@convex/limited/eventLogic";
import { CUBE_PACK_SIZE, maxCubeSeats } from "@convex/limited/cube";
import type { LimitedEventType } from "@convex/limited/eventTypes";
import {
    DEFAULT_GAMES_FORMAT,
    DEFAULT_ROUND_DEADLINE_MINUTES,
    MAX_ROUND_DEADLINE_MINUTES,
    MIN_ROUND_DEADLINE_MINUTES,
    type LimitedGamesFormat,
} from "@convex/limited/gamesFormat";
import IncompletenessNotice from "./incompleteness-notice";
import CubeAvailabilityNote from "./cube-availability-note";

/** Whether a Pack Source can be chosen for the given event type. The Vintage
 *  Cube is a DRAFT-only pool source (ADR 0062: the singleton pool-as-source
 *  path is wired into the draft engine, not the Sealed pool generator); every
 *  source of real Draftable Sets works for both. */
function isSourceSelectable(
    source: PackSourceInfo,
    type: LimitedEventType
): boolean {
    if (!source.draftable) return false;
    return type === "draft" || !source.draftOnly;
}

/** Cards a non-Draftable source still lacks, summed over its sets — the
 *  reason shown beside a disabled entry. */
function missingCardCount(source: PackSourceInfo): number {
    return source.sets.reduce((sum, set) => sum + set.missingCardCount, 0);
}

/** Keeps the typed round deadline inside the bounds `createLimitedEvent`
 *  actually accepts (`isValidRoundDeadlineMinutes`), so a stray keystroke
 *  produces a clamped value rather than a server error. Both bounds come from
 *  the shared `gamesFormat` module — the client can't drift from the server. */
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
    /** Pack Source catalogue key (issue #5385); the server resolves it into
     *  the per-pack sets the event stores. */
    packSource: string;
    sealedBoosterCount: number;
    /** Per-pick timer on/off (issue #1114, PRD #1107 story 5; ADR 0060 /
     *  issue #1243: a clear On/Off control, no seconds field — when on, each
     *  pick's countdown follows the official descending schedule indexed by
     *  cards remaining). Omitted/false when the admin leaves the timer off. */
    timerEnabled?: boolean;
    /** Games Format of the event's round matches (PRD #1628 stories 1-2,
     *  issue #1640) — Bo1 or Bo3, defaulting to Bo3 so the event plays like
     *  real Limited with nothing configured. Always sent (never omitted): the
     *  creator's choice is explicit, and the server's tolerant default exists
     *  for OLD documents, not for new ones. */
    gamesFormat: LimitedGamesFormat;
    /** Optional round deadline in minutes (PRD #1628 stories 3-4). Omitted
     *  when the creator leaves the deadline off — a relaxed table among
     *  friends is never cut short by a timer. */
    roundDeadlineMinutes?: number;
}

interface CreateLimitedEventDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The Pack Source catalogue in display order, Vintage Cube first (issue
     *  #5385) — a non-Draftable source is shown but disabled, with its
     *  missing-card count as the reason. */
    packSources: PackSourceInfo[];
    onCreate: (payload: CreateLimitedEventPayload) => void;
    /** Create mutation in-flight — disables every control (project rule:
     *  mutation buttons disable while pending). */
    pending?: boolean;
    error?: string | null;
}

/** "Create Event" form (PRD #1107 stories 1-6, ADR 0054/0055): event type
 *  (Sealed/Draft), 2-8 Seats, a Pack Source by name (issue #5385), and —
 *  for Sealed only — an editable booster count (default 6, story 8). Draft's
 *  booster count is fixed at `DRAFT_BOOSTER_COUNT` (3, PRD #1241 story 7 /
 *  issue #1246) and never shown as an editable field — a classic Draft is
 *  always three boosters. */
export default function CreateLimitedEventDialog({
    open,
    onOpenChange,
    packSources,
    onCreate,
    pending = false,
    error,
}: CreateLimitedEventDialogProps) {
    // Opens on Draft · first selectable source (Vintage Cube) · pick timer
    // on (PRD #5383 stories 17-19).
    const [type, setType] = useState<LimitedEventType>("draft");
    const [seatCount, setSeatCount] = useState(8);
    const firstSelectable = packSources.find((s) =>
        isSourceSelectable(s, "draft")
    )?.key;
    const [sourceKey, setSourceKey] = useState<string | undefined>(
        firstSelectable
    );
    const [sealedBoosterCount, setSealedBoosterCount] = useState(
        DEFAULT_SEALED_BOOSTER_COUNT
    );
    const [timerEnabled, setTimerEnabled] = useState(true);
    // Games Format + round deadline (PRD #1628 stories 1-4). Bo3 is the
    // default (story 2); the deadline is OFF by default (story 4), held as an
    // enabled flag + a value so toggling it off doesn't lose what was typed.
    const [gamesFormat, setGamesFormat] =
        useState<LimitedGamesFormat>(DEFAULT_GAMES_FORMAT);
    const [deadlineEnabled, setDeadlineEnabled] = useState(false);
    const [roundDeadlineMinutes, setRoundDeadlineMinutes] = useState(
        DEFAULT_ROUND_DEADLINE_MINUTES
    );

    const resolvedSourceKey = sourceKey ?? firstSelectable;
    const selectedSource = packSources.find((s) => s.key === resolvedSourceKey);
    // The selected source must be usable for the current event type — the
    // Vintage Cube (ADR 0062) is Draft-only, so a cube selection carried over
    // into Sealed blocks submit rather than reaching the Sealed pool generator.
    const selectionUsable =
        selectedSource !== undefined &&
        isSourceSelectable(selectedSource, type);
    // Vintage Cube singleton capacity cap (ADR 0062 rev): a cube deals one copy
    // of each card, so the table can be no larger than the implemented pool
    // fills singleton over the 3 boosters. Cap the seat control to match the
    // server guard (`createLimitedEvent`) so an oversized table can't even be
    // submitted. Non-cube sources keep the full 2–8 range.
    const cubeSet = selectedSource?.sets.find((s) => s.isCube === true);
    const isCubeDraft = cubeSet !== undefined && type === "draft";
    const seatMax = isCubeDraft
        ? Math.max(
              MIN_SEATS,
              Math.min(
                  MAX_SEATS,
                  maxCubeSeats(
                      cubeSet.availableCardCount ?? 0,
                      CUBE_PACK_SIZE,
                      DRAFT_BOOSTER_COUNT
                  )
              )
          )
        : MAX_SEATS;
    const effectiveSeatCount = Math.min(seatCount, seatMax);
    const canSubmit = !pending && selectionUsable;

    const handleSubmit = () => {
        if (!canSubmit || !resolvedSourceKey) return;
        onCreate({
            type,
            seatCount: effectiveSeatCount,
            packSource: resolvedSourceKey,
            sealedBoosterCount,
            timerEnabled: type === "draft" && timerEnabled,
            gamesFormat,
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
            subtitle="Set up a Sealed or Draft pod from a Pack Source."
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
                        {packSources.length === 0 && (
                            <p className="text-xs text-text-muted">
                                No Pack Sources available yet.
                            </p>
                        )}
                        {packSources.map((source) => {
                            const selectable = isSourceSelectable(source, type);
                            const sourceCube = source.sets.find(
                                (s) => s.isCube === true
                            );
                            const missing = missingCardCount(source);
                            return (
                                <label
                                    key={source.key}
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
                                                resolvedSourceKey === source.key
                                            }
                                            onChange={() =>
                                                setSourceKey(source.key)
                                            }
                                        />
                                        <span className="flex flex-col">
                                            <span>{source.name}</span>
                                            <span className="text-xs text-text-muted">
                                                {source.description}
                                            </span>
                                        </span>
                                    </span>
                                    {sourceCube ? (
                                        <span className="shrink-0 text-xs text-text-muted">
                                            {sourceCube.availableCardCount ?? 0}{" "}
                                            card
                                            {(sourceCube.availableCardCount ??
                                                0) === 1
                                                ? ""
                                                : "s"}{" "}
                                            {type === "draft"
                                                ? "available"
                                                : "· Draft only"}
                                        </span>
                                    ) : (
                                        !source.draftable && (
                                            <span className="shrink-0 text-xs text-text-muted">
                                                {missing} card
                                                {missing === 1 ? "" : "s"}{" "}
                                                missing
                                            </span>
                                        )
                                    )}
                                </label>
                            );
                        })}
                    </div>
                    {selectedSource?.sets.map((set) => (
                        <IncompletenessNotice key={set.setCode} set={set} />
                    ))}
                    <CubeAvailabilityNote set={cubeSet} />
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
                        Games Format
                    </span>
                    <div
                        role="radiogroup"
                        aria-label="Games Format"
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
                                aria-checked={gamesFormat === opt.value}
                                disabled={pending}
                                onClick={() => setGamesFormat(opt.value)}
                                className={
                                    "px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 " +
                                    (gamesFormat === opt.value
                                        ? "bg-accent text-surface-base"
                                        : "bg-surface-elevated/30 text-text hover:bg-surface-elevated/50")
                                }
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                    <span className="text-xs text-text-muted">
                        {gamesFormat === "bo1"
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
