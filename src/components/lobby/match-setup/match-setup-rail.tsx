// The recap rail (PRD #5334 stories 16–18, 52): every step this setup walks
// with its current answer, Start at its foot. Start is enabled only once
// every step is answered — the same readiness `startRequest` checks.
import type { RecapStep } from "~/lib/recapRail";
import { cn } from "~/lib/utils";
import { Banner } from "~/components/ui/banner";
import { Button } from "~/components/ui/button";
import { Panel } from "~/components/ui/panel";
import MatchSetupRailStep from "./match-setup-rail-step";

export default function MatchSetupRail<Key extends string>({
    steps,
    firstOpen,
    current,
    onOpen,
    canStart,
    busy,
    error,
    onStart,
    startLabel = "Start match",
    busyLabel = "Starting…",
    strip = false,
}: {
    steps: readonly RecapStep<Key>[];
    /** Index of the first unanswered step; every step after it is disabled. */
    firstOpen: number;
    current: Key;
    onOpen: (key: Key) => void;
    canStart: boolean;
    busy: boolean;
    error: string | null;
    onStart: () => void;
    startLabel?: string;
    busyLabel?: string;
    /** Phones: the steps run as a compact horizontal strip above the footer. */
    strip?: boolean;
}) {
    return (
        <Panel size="full" density="compact" className="bg-surface/80">
            <nav
                aria-label="Setup steps"
                className={cn(
                    "flex gap-1",
                    strip ? "overflow-x-auto md:flex-col" : "flex-col"
                )}
            >
                {steps.map((step, i) => (
                    <MatchSetupRailStep
                        key={step.key}
                        step={step}
                        strip={strip}
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
                    {busy ? busyLabel : startLabel}
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
