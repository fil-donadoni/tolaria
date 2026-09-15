// A `ScenarioSpec` rendered as a board (issue #3577, PRD #3574).
//
// Text rows, not card art: it lives in the 293px debug sheet, and a position is
// judged by what is where, tapped or not — which a name list carries at every
// viewport. The reading itself is `scenario-spec-board-model.ts`.

import type { ScenarioSpec } from "@convex/debugScenarioSpec";
import {
    scenarioBoard,
    type ScenarioBoardEntry,
    type ScenarioSeat,
} from "./scenario-spec-board-model";

const ZONE_LABELS = {
    battlefield: "Battlefield",
    graveyard: "Graveyard",
    exile: "Exile",
} as const;

function entryText(entry: ScenarioBoardEntry): string {
    const copies = entry.count > 1 ? ` ×${entry.count}` : "";
    const notes = entry.notes.length > 0 ? ` (${entry.notes.join(", ")})` : "";
    return `${entry.name}${copies}${notes}`;
}

export default function ScenarioSpecBoard({
    spec,
    revealedHands,
    seatLabels = { me: "Me", opp: "Opponent" },
}: {
    spec: ScenarioSpec;
    /** Seats whose hand renders as cards; every other hand is a count. */
    revealedHands: readonly ScenarioSeat[];
    seatLabels?: Record<ScenarioSeat, string>;
}) {
    const board = scenarioBoard(spec, revealedHands);
    const header = [
        board.turn === undefined ? null : `Turn ${board.turn}`,
        board.phase ?? null,
        board.seededLands > 0 ? `+${board.seededLands} basic lands each` : null,
    ].filter((part): part is string => part !== null);

    return (
        <div
            data-testid="scenario-board"
            className="flex min-w-0 flex-col gap-1 text-[10px] leading-snug"
        >
            {header.length > 0 && (
                <span className="text-text-disabled">{header.join(" · ")}</span>
            )}
            {board.stack.length > 0 && (
                <div className="flex flex-col">
                    <span className="text-label">Stack (top first)</span>
                    <ul className="ml-3 list-disc text-text-muted">
                        {board.stack.map((item, i) => (
                            <li key={i} className="break-words">
                                {item.name} — {seatLabels[item.controller]}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {board.seats.map((seat) => (
                <section
                    key={seat.seat}
                    data-testid={`scenario-board-seat-${seat.seat}`}
                    className="flex min-w-0 flex-col rounded-sm border border-border-subtle px-1 py-0.5"
                >
                    <span className="font-medium text-text">
                        {seatLabels[seat.seat]}
                        {seat.life === undefined ? "" : ` · ${seat.life} life`}
                    </span>
                    {seat.zones.map((zone) => (
                        <div key={zone.zone} className="flex flex-col">
                            <span className="text-text-disabled">
                                {ZONE_LABELS[zone.zone]}
                            </span>
                            <ul className="ml-3 list-disc text-text-muted">
                                {zone.entries.map((entry, i) => (
                                    <li key={i} className="break-words">
                                        {entryText(entry)}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                    <div
                        data-testid={`scenario-board-hand-${seat.seat}`}
                        data-hand={seat.hand.revealed ? "cards" : "count"}
                        className="flex flex-col"
                    >
                        <span className="text-text-disabled">
                            Hand — {seat.hand.size}{" "}
                            {seat.hand.size === 1 ? "card" : "cards"}
                        </span>
                        {seat.hand.revealed && seat.hand.entries.length > 0 && (
                            <ul className="ml-3 list-disc text-text-muted">
                                {seat.hand.entries.map((entry, i) => (
                                    <li key={i} className="break-words">
                                        {entryText(entry)}
                                    </li>
                                ))}
                            </ul>
                        )}
                        {seat.hand.revealed && seat.hand.unseen > 0 && (
                            <span className="ml-3 text-text-disabled">
                                +{seat.hand.unseen} not named in this position
                            </span>
                        )}
                    </div>
                </section>
            ))}
        </div>
    );
}
