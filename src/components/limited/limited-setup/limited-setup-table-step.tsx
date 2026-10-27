// Step 3 — Table (PRD #5383): seats, Games Format, pick timer (Draft only),
// boosters per seat (Sealed only), Bot difficulty, round deadline and Open
// Decklists.
import { MAX_SEATS, MIN_SEATS } from "@convex/limited/eventLogic";
import {
    DEFAULT_ROUND_DEADLINE_MINUTES,
    MAX_ROUND_DEADLINE_MINUTES,
    MIN_ROUND_DEADLINE_MINUTES,
} from "@convex/limited/gamesFormat";
import type { PackSourceInfo } from "~/hooks/useLimitedEvent";
import { OPEN_DECKLISTS_CONSEQUENCE } from "~/lib/openDecklists";
import {
    pickTimerVisible,
    seatLimit,
    type LimitedSetup,
} from "~/lib/limited/limitedSetup";
import DifficultySelector from "~/components/lobby/difficulty-selector";
import SegmentedControl from "~/components/ui/segmented-control";
import LimitedSetupNumberField from "./limited-setup-number-field";
import LimitedSetupToggle from "./limited-setup-toggle";

const FIELD_LABEL = "text-[11px] tracking-wide text-text-muted uppercase";

export default function LimitedSetupTableStep({
    setup,
    sources,
    onChange,
}: {
    setup: LimitedSetup;
    sources: readonly PackSourceInfo[];
    onChange: (patch: Partial<LimitedSetup>) => void;
}) {
    const seatMax = seatLimit(setup, sources);
    return (
        <div className="flex flex-col gap-4">
            <LimitedSetupNumberField
                label={`Seats (${MIN_SEATS}-${seatMax})`}
                value={setup.seats}
                min={MIN_SEATS}
                max={seatMax}
                hint={
                    seatMax < MAX_SEATS
                        ? `The Vintage Cube deals one copy of each card, so the table is capped at ${seatMax} seats until the implemented pool grows.`
                        : "Unfilled seats become bots when the event starts."
                }
                onCommit={(seats) => onChange({ seats })}
            />

            {setup.type === "sealed" && (
                <LimitedSetupNumberField
                    label="Boosters per Seat"
                    value={setup.boostersPerSeat}
                    min={1}
                    onCommit={(boostersPerSeat) =>
                        onChange({ boostersPerSeat })
                    }
                />
            )}

            <div className="flex flex-col gap-1">
                <DifficultySelector
                    value={setup.botDifficulty}
                    onChange={(botDifficulty) => onChange({ botDifficulty })}
                />
                <span className="text-xs text-text-muted">
                    Every match against a Bot in this event — round pairings and
                    Play vs the Table — plays at this difficulty.
                </span>
            </div>

            <div className="flex flex-col gap-1">
                <span className={FIELD_LABEL}>Games Format</span>
                <SegmentedControl
                    ariaLabel="Games Format"
                    value={setup.gamesFormat === 1 ? "bo1" : "bo3"}
                    onChange={(next) =>
                        onChange({ gamesFormat: next === "bo1" ? 1 : 3 })
                    }
                    options={[
                        { value: "bo1", label: "Bo1" },
                        { value: "bo3", label: "Bo3" },
                    ]}
                />
                <span className="text-xs text-text-muted">
                    {setup.gamesFormat === 1
                        ? "Bo1 — one game decides each round pairing."
                        : "Bo3 — each round pairing is a best-of-three with sideboarding, like real Limited."}
                </span>
            </div>

            {pickTimerVisible(setup) && (
                <LimitedSetupToggle
                    label="Pick Timer"
                    value={setup.pickTimer}
                    onChange={(pickTimer) => onChange({ pickTimer })}
                    note="If the draft starts with 2+ humans, the timer is always on."
                    consequence={
                        setup.pickTimer
                            ? "On — each pick's time tightens through the pack on the official schedule; an expired pick auto-picks with the bot engine."
                            : "Off — seats pick at their own pace."
                    }
                />
            )}

            <LimitedSetupToggle
                label="Round Deadline"
                value={setup.roundDeadlineMinutes !== null}
                onChange={(on) =>
                    onChange({
                        roundDeadlineMinutes: on
                            ? DEFAULT_ROUND_DEADLINE_MINUTES
                            : null,
                    })
                }
                consequence={
                    setup.roundDeadlineMinutes !== null
                        ? "An unplayed pairing is closed as a loss when the round's time runs out, so one absent player cannot freeze the table."
                        : "Off — rounds never expire; the table waits for every pairing to be played."
                }
            />
            {setup.roundDeadlineMinutes !== null && (
                <LimitedSetupNumberField
                    label="Minutes per Round"
                    value={setup.roundDeadlineMinutes}
                    min={MIN_ROUND_DEADLINE_MINUTES}
                    max={MAX_ROUND_DEADLINE_MINUTES}
                    onCommit={(roundDeadlineMinutes) =>
                        onChange({ roundDeadlineMinutes })
                    }
                />
            )}

            <LimitedSetupToggle
                label="Open Decklists"
                value={setup.openDecklists}
                onChange={(openDecklists) => onChange({ openDecklists })}
                consequence={
                    setup.openDecklists
                        ? `On — ${OPEN_DECKLISTS_CONSEQUENCE} Players are warned before they join.`
                        : "Off — other seats' decks and pick orders stay hidden until the event ends."
                }
            />
        </div>
    );
}
