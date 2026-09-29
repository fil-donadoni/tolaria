import { Button } from "@/components/ui/button";
import { resolveReproducer } from "@/lib/ai/bot-finding-launch";
import type { ScenarioLaunch } from "~/hooks/useScenarioTestGame";
import BotFindingCopyButton from "./bot-finding-copy-button";

/**
 * The Reproducers of a finding or a class (PRD #4174 stories 32-35, issue
 * #4178), each with the one action that can work: a saved scenario or a plain
 * board launches in one click through the scenario path; a blade entry that
 * needs setup steps offers a copy-command and NEVER a launch button.
 */
export default function BotFindingReproducers({
    labels,
    savedScenarios,
    launchingId,
    onLaunch,
}: {
    labels: readonly string[];
    savedScenarios: readonly ScenarioLaunch[];
    launchingId: string | null;
    onLaunch: (launch: ScenarioLaunch) => void;
}) {
    if (labels.length === 0) return null;
    return (
        <ul data-bot-finding-reproducers="" className="flex flex-col gap-1">
            {labels.map((label) => {
                const action = resolveReproducer(label, savedScenarios);
                return (
                    <li
                        key={label}
                        data-bot-finding-reproducer={action.kind}
                        className="flex flex-wrap items-center gap-2 text-xs text-text-muted"
                    >
                        <span className="break-words">{label}</span>
                        {action.kind === "launch" && (
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                data-bot-finding-launch=""
                                disabled={launchingId !== null}
                                onClick={() => onLaunch(action.launch)}
                            >
                                {launchingId === action.launch._id
                                    ? "Launching…"
                                    : "Launch"}
                            </Button>
                        )}
                        {action.kind === "command" && (
                            <BotFindingCopyButton
                                text={() => action.command}
                                label={`Copy the command that re-runs ${label}`}
                            />
                        )}
                    </li>
                );
            })}
        </ul>
    );
}
