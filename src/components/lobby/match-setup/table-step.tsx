// Step 3 of Join — Table (PRD #5334 stories 27–28, issue #5342): the open
// tables of the chosen game mode with their Match Format and Games Format,
// plus join by code. Picking either skips the Match Format step: the joiner
// inherits the host's, and the deck step is filtered by it.
import { useState } from "react";
import { FORMAT_LABELS } from "@convex/formats";
import {
    joinByCodeAvailable,
    tablesForMode,
    type MatchSetup,
    type OpenTable,
} from "~/lib/matchSetup";
import ActionButton from "~/components/board/action-button";
import JoinByCodeDialog from "../join-by-code-dialog";
import SetupChoice from "./setup-choice";

export default function TableStep({
    setup,
    tables,
    onChange,
}: {
    setup: MatchSetup;
    tables: readonly OpenTable[];
    onChange: (patch: Partial<MatchSetup>) => void;
}) {
    const [codeOpen, setCodeOpen] = useState(false);
    const open = tablesForMode(tables, setup.mode);
    return (
        <div className="flex flex-col gap-4">
            {open.length === 0 ? (
                <p className="text-sm text-text-muted">
                    No open {setup.mode === "cockatrice" ? "Cockatrice " : ""}
                    tables right now.
                </p>
            ) : (
                <div
                    role="group"
                    aria-label="Open tables"
                    className="flex flex-wrap gap-2"
                    data-open-tables
                >
                    {open.map((t) => (
                        <SetupChoice
                            key={t._id}
                            title={t.name}
                            hint={`${t.players[0]?.name ?? "Unknown"} · ${FORMAT_LABELS[t.matchFormat]} · Bo${t.bestOf}`}
                            selected={setup.joinTableId === t._id}
                            onSelect={() =>
                                onChange({
                                    joinTableId: t._id,
                                    joinTableFormat: t.matchFormat,
                                })
                            }
                        />
                    ))}
                </div>
            )}
            {joinByCodeAvailable(setup.mode) && (
                <div className="flex items-center gap-3">
                    <ActionButton
                        label="Join by code"
                        tone="secondary"
                        onClick={() => setCodeOpen(true)}
                    />
                    {setup.joinCode !== null && (
                        <span className="font-mono text-sm text-parchment">
                            {setup.joinCode}
                        </span>
                    )}
                </div>
            )}
            <JoinByCodeDialog
                open={codeOpen}
                onOpenChange={setCodeOpen}
                submitLabel="Use code"
                onSubmit={(joinCode) => {
                    onChange({ joinCode });
                    return Promise.resolve();
                }}
            />
        </div>
    );
}
