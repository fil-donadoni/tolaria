// The setup flow's two panes (PRD #5334 stories 16–18, 59): the recap rail on
// the left, the active step on the right; stacked below `md`, rail first.
//
// The active step is the first unanswered one unless the player re-opened an
// answered step from the rail; answering a step hands control back to the
// first open one, so the flow always moves forward after an edit.
import { useState } from "react";
import type { LobbyDeck } from "~/lib/deckTypes";
import {
    firstOpenStep,
    setupSteps,
    type MatchSetup,
    type StepKey,
} from "~/lib/matchSetup";
import { Panel, PanelBody, PanelHeader } from "~/components/ui/panel";
import MatchSetupRail from "./match-setup-rail";
import MatchSetupStepBody from "./match-setup-step-body";

export default function MatchSetupPanes({
    setup,
    decks,
    onChange,
    canStart,
    busy,
    error,
    onStart,
}: {
    setup: MatchSetup;
    decks: readonly LobbyDeck[];
    onChange: (patch: Partial<MatchSetup>) => void;
    canStart: boolean;
    busy: boolean;
    error: string | null;
    onStart: () => void;
}) {
    const [reopened, setReopened] = useState<StepKey | null>(null);
    const steps = setupSteps(setup, decks);
    const firstOpen = firstOpenStep(steps);
    const current =
        steps.find((s, i) => s.key === reopened && i <= firstOpen) ??
        steps[Math.min(firstOpen, steps.length - 1)];

    return (
        <div className="grid w-full grid-cols-1 gap-4 md:grid-cols-[16rem_minmax(0,1fr)]">
            <MatchSetupRail
                steps={steps}
                firstOpen={firstOpen}
                current={current.key}
                onOpen={setReopened}
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
                        onChange={(patch) => {
                            onChange(patch);
                            setReopened(null);
                        }}
                    />
                </PanelBody>
            </Panel>
        </div>
    );
}
