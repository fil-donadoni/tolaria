// The Limited setup's two panes (PRD #5383): the recap rail (a compact step
// strip on phones) and the active step. Every step has a default, so Create is
// live from the first render; the player may open any step from the rail. A
// single-control pick opens the following step; a multi-control step shows Next
// (issue #5934).
import { useState } from "react";
import type { PackSourceInfo } from "~/hooks/useLimitedEvent";
import { stepAfter } from "~/lib/recapRail";
import {
    LIMITED_MULTI_CONTROL_STEPS,
    LIMITED_STEP_KEYS,
    limitedSetupSteps,
    type LimitedSetup,
    type LimitedStepKey,
} from "~/lib/limited/limitedSetup";
import MatchSetupRail from "~/components/lobby/match-setup/match-setup-rail";
import { Panel, PanelBody, PanelHeader } from "~/components/ui/panel";
import SetupNextButton from "~/components/lobby/match-setup/setup-next-button";
import LimitedSetupStepBody from "./limited-setup-step-body";

export default function LimitedSetupPanes({
    setup,
    sources,
    note,
    onChange,
    canCreate,
    busy,
    error,
    onCreate,
}: {
    setup: LimitedSetup;
    sources: readonly PackSourceInfo[];
    note: string | null;
    onChange: (patch: Partial<LimitedSetup>) => void;
    canCreate: boolean;
    busy: boolean;
    error: string | null;
    onCreate: () => void;
}) {
    const [current, setCurrent] = useState<LimitedStepKey>("type");
    const steps = limitedSetupSteps(setup, sources);
    const active = steps.find((s) => s.key === current) ?? steps[0];
    const next = stepAfter(LIMITED_STEP_KEYS, active.key);
    const multiControl = LIMITED_MULTI_CONTROL_STEPS.includes(active.key);

    return (
        <div className="grid w-full grid-cols-1 gap-4 md:grid-cols-[16rem_minmax(0,1fr)]">
            <MatchSetupRail
                steps={steps}
                firstOpen={steps.length}
                current={active.key}
                onOpen={setCurrent}
                canStart={canCreate}
                busy={busy}
                error={error}
                onStart={onCreate}
                startLabel="Create Event"
                busyLabel="Creating…"
                strip
            />
            <Panel size="full" className="bg-surface/80">
                <PanelHeader title={active.title} />
                <PanelBody>
                    <LimitedSetupStepBody
                        step={active.key}
                        setup={setup}
                        sources={sources}
                        note={note}
                        onChange={onChange}
                        onAdvance={
                            next && !multiControl
                                ? () => setCurrent(next)
                                : undefined
                        }
                    />
                </PanelBody>
                {next && multiControl && (
                    <SetupNextButton
                        disabled={false}
                        onNext={() => setCurrent(next)}
                    />
                )}
            </Panel>
        </div>
    );
}
