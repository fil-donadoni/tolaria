// PROTOTYPE — throwaway. The content of one step; the three variants differ
// in how they arrange steps, never in what a step asks.

import type { FormatId } from "@convex/formats";
import type { Difficulty } from "@convex/gre";
import type { LobbyDeck } from "~/lib/deckTypes";
import { cn } from "~/lib/utils";
import DifficultySelector from "../difficulty-selector";
import ProtoDeckGrid from "./proto-deck-grid";
import {
    ARENA_MATCH_FORMATS,
    effectiveMatchFormat,
    formatLabel,
    opponentLabel,
    type MatchSetup,
    type Opponent,
    type StepKey,
} from "./match-setup-logic";

export interface ProtoOpenTable {
    id: string;
    name: string;
    mode: "arena" | "cockatrice";
    format: FormatId | null;
    bestOf: 1 | 3;
}

export interface ProtoStepProps {
    setup: MatchSetup;
    decks: LobbyDeck[];
    tables: ProtoOpenTable[];
    update: (patch: Partial<MatchSetup>) => void;
    onImport: (target: "me" | "opp") => void;
    compact?: boolean;
}

function Choice({
    selected,
    onClick,
    title,
    hint,
    disabled,
}: {
    selected: boolean;
    onClick: () => void;
    title: string;
    hint?: string;
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={cn(
                "flex min-w-[9rem] flex-1 flex-col rounded-[var(--panel-radius)] border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-40",
                selected
                    ? "border-accent bg-accent/10"
                    : "border-border-strong hover:border-accent/60"
            )}
        >
            <span className="text-sm font-medium text-parchment">{title}</span>
            {hint && <span className="text-xs text-text-muted">{hint}</span>}
        </button>
    );
}

export default function ProtoStepBody({
    step,
    ...p
}: ProtoStepProps & { step: StepKey }) {
    const { setup: s, update } = p;
    const mf = effectiveMatchFormat(s);

    switch (step) {
        case "mode":
            return (
                <div className="flex flex-wrap gap-2">
                    <Choice
                        selected={s.mode === "arena"}
                        onClick={() => update({ mode: "arena" })}
                        title="Arena"
                        hint="The engine enforces the rules"
                    />
                    <Choice
                        selected={s.mode === "cockatrice"}
                        onClick={() => update({ mode: "cockatrice" })}
                        title="Cockatrice"
                        hint="Free table, Manual decks, you call the rules"
                    />
                </div>
            );
        case "opponent": {
            const options: { o: Opponent; hint: string }[] = [
                { o: "bot", hint: "The engine plays the other seat" },
                { o: "solo", hint: "You play both seats" },
                { o: "host", hint: "Open a table for a human" },
                { o: "join", hint: "Sit at someone's open table" },
            ];
            return (
                <div className="flex flex-wrap gap-2">
                    {options.map(({ o, hint }) => (
                        <Choice
                            key={o}
                            selected={s.opponent === o}
                            onClick={() => update({ opponent: o })}
                            title={opponentLabel(o)}
                            hint={
                                o === "bot" && s.mode === "cockatrice"
                                    ? "Not in Cockatrice — the engine can't play Manual decks"
                                    : hint
                            }
                            disabled={o === "bot" && s.mode === "cockatrice"}
                        />
                    ))}
                </div>
            );
        }
        case "table": {
            const list = p.tables.filter((t) => t.mode === s.mode);
            return (
                <div className="flex flex-col gap-2">
                    {list.length === 0 && (
                        <p className="text-xs text-text-disabled">
                            No open {s.mode} table right now.
                        </p>
                    )}
                    {list.map((t) => (
                        <Choice
                            key={t.id}
                            selected={s.joinTableId === t.id}
                            onClick={() =>
                                update({
                                    joinTableId: t.id,
                                    joinTableFormat: t.format ?? "freeform",
                                    gamesFormat: t.bestOf,
                                })
                            }
                            title={t.name}
                            hint={`${t.format ? formatLabel(t.format) : "?"} · Bo${t.bestOf}`}
                        />
                    ))}
                    <button
                        type="button"
                        className="self-start text-xs text-text-muted underline"
                    >
                        Join by code…
                    </button>
                </div>
            );
        }
        case "format":
            return (
                <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap gap-2">
                        {ARENA_MATCH_FORMATS.map((f) => (
                            <Choice
                                key={f}
                                selected={s.matchFormat === f}
                                onClick={() => update({ matchFormat: f })}
                                title={formatLabel(f)}
                                hint={
                                    f === "freeform"
                                        ? "Admits every deck"
                                        : `${p.decks.filter((d) => d.format === f).length} decks`
                                }
                            />
                        ))}
                    </div>
                    <div className="flex gap-2">
                        {([1, 3] as const).map((g) => (
                            <Choice
                                key={g}
                                selected={s.gamesFormat === g}
                                onClick={() => update({ gamesFormat: g })}
                                title={`Bo${g}`}
                                hint={g === 1 ? "One game" : "Best of three"}
                            />
                        ))}
                    </div>
                </div>
            );
        case "myDeck":
            return mf ? (
                <ProtoDeckGrid
                    decks={p.decks}
                    matchFormat={mf}
                    selectedId={s.myDeckId}
                    onSelect={(id) => update({ myDeckId: id })}
                    onImport={() => p.onImport("me")}
                    compact={p.compact}
                />
            ) : (
                <p className="text-xs text-text-disabled">
                    Choose the Match Format first.
                </p>
            );
        case "opponentDeck":
            return mf ? (
                <div className="flex flex-col gap-3">
                    {s.opponent === "bot" && (
                        <DifficultySelector
                            value={s.difficulty}
                            onChange={(d: Difficulty) =>
                                update({ difficulty: d })
                            }
                        />
                    )}
                    <ProtoDeckGrid
                        decks={p.decks}
                        matchFormat={mf}
                        selectedId={
                            s.opponentDeckChosen ? s.opponentDeckId : null
                        }
                        onSelect={(id) =>
                            update({
                                opponentDeckId: id,
                                opponentDeckChosen: true,
                            })
                        }
                        onImport={() => p.onImport("opp")}
                        mirror={{
                            selected:
                                s.opponentDeckChosen &&
                                s.opponentDeckId === null,
                            onSelect: () =>
                                update({
                                    opponentDeckId: null,
                                    opponentDeckChosen: true,
                                }),
                        }}
                        compact={p.compact}
                    />
                </div>
            ) : null;
    }
}
