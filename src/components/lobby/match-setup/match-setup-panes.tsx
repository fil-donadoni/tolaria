// The setup flow's two panes (PRD #5334 stories 16–18, 59): the recap rail on
// the left, the active step on the right; stacked below `md`, rail first.
//
// The active step is the first unanswered one unless the player picked another
// from the rail. A single-control answer opens the step AFTER the one answered
// (also when it was re-opened from the rail); a multi-control step stays put
// and shows Next (issue #5934).
import { useState } from "react";
import type { LobbyDeck } from "~/lib/deckTypes";
import { stepAfter } from "~/lib/recapRail";
import {
    MULTI_CONTROL_STEPS,
    advancesOnChoice,
    firstOpenStep,
    setupSteps,
    stepsFor,
    type MatchSetup,
    type OpenTable,
    type StepKey,
} from "~/lib/matchSetup";
import { Panel, PanelBody, PanelHeader } from "~/components/ui/panel";
import MatchSetupRail from "./match-setup-rail";
import MatchSetupStepBody from "./match-setup-step-body";
import SetupNextButton from "./setup-next-button";

export default function MatchSetupPanes({
    setup,
    decks,
    tables,
    onChange,
    canStart,
    busy,
    error,
    onStart,
}: {
    setup: MatchSetup;
    decks: readonly LobbyDeck[];
    tables: readonly OpenTable[];
    onChange: (patch: Partial<MatchSetup>, imported?: LobbyDeck) => void;
    canStart: boolean;
    busy: boolean;
    error: string | null;
    onStart: () => void;
}) {
    const [selected, setSelected] = useState<StepKey | null>(null);
    const steps = setupSteps(setup, decks);
    const firstOpen = firstOpenStep(steps);
    const current =
        steps.find((s, i) => s.key === selected && i <= firstOpen) ??
        steps[Math.min(firstOpen, steps.length - 1)];
    const next = stepAfter(
        steps.map((s) => s.key),
        current.key
    );

    return (
        <div className="grid w-full grid-cols-1 gap-4 md:grid-cols-[16rem_minmax(0,1fr)]">
            <MatchSetupRail
                steps={steps}
                firstOpen={firstOpen}
                current={current.key}
                onOpen={setSelected}
                canStart={canStart}
                busy={busy}
                error={error}
                onStart={onStart}
            />
            <Panel size="full" className="bg-surface/80">
                <PanelHeader title={current.title} />
                <PanelBody>
                    <MatchSetupStepBody
                        step={current.key}
                        setup={setup}
                        decks={decks}
                        tables={tables}
                        onChange={(patch, imported) => {
                            onChange(patch, imported);
                            // The following step under the setup AFTER the
                            // patch: the answer may reshape the flow.
                            const after = stepAfter(
                                stepsFor({ ...setup, ...patch }),
                                current.key
                            );
                            setSelected(
                                after && advancesOnChoice(current.key, patch)
                                    ? after
                                    : current.key
                            );
                        }}
                    />
                </PanelBody>
                {next && MULTI_CONTROL_STEPS.includes(current.key) && (
                    <SetupNextButton
                        disabled={current.answer === null}
                        onNext={() => setSelected(next)}
                    />
                )}
            </Panel>
        </div>
    );
}
