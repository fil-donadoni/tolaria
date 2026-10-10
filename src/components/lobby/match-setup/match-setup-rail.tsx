// The recap rail (PRD #5334 stories 16–18, 52): every step this setup walks
// with its current answer, Start at its foot. Start is enabled only once
// every step is answered — the same readiness `startRequest` checks.
import type { StepInfo, StepKey } from "~/lib/matchSetup";
import { Banner } from "~/components/ui/banner";
import { Button } from "~/components/ui/button";
import { Panel } from "~/components/ui/panel";
import MatchSetupRailStep from "./match-setup-rail-step";

export default function MatchSetupRail({
    steps,
    firstOpen,
    current,
    onOpen,
    canStart,
    busy,
    error,
    onStart,
}: {
    steps: readonly StepInfo[];
    /** Index of the first unanswered step; every step after it is disabled. */
    firstOpen: number;
    current: StepKey;
    onOpen: (key: StepKey) => void;
    canStart: boolean;
    busy: boolean;
    error: string | null;
    onStart: () => void;
}) {
    return (
        <Panel size="full" density="compact" className="bg-surface/80">
            <nav aria-label="Setup steps" className="flex flex-col gap-1">
                {steps.map((step, i) => (
                    <MatchSetupRailStep
                        key={step.key}
                        step={step}
                        index={i}
                        active={step.key === current}
                        disabled={i > firstOpen}
                        onOpen={() => onOpen(step.key)}
                    />
                ))}
            </nav>
            <div className="mt-2 flex flex-col gap-2 border-t border-[var(--hairline)] pt-2">
                <Button
                    disabled={!canStart || busy}
                    onClick={onStart}
                    className="w-full"
                >
                    {busy ? "Starting…" : "Start match"}
                </Button>
                {error && (
                    <Banner tone="danger" role="alert">
                        {error}
                    </Banner>
                )}
            </div>
        </Panel>
    );
}
