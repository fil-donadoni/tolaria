import type {
    RunnerState,
    RunnerView,
} from "../../../scripts/lib/cockpit-reading";
import type { Tone } from "../../lib/tones";
import { Section } from "../Section";
import { StateBadge } from "../StateBadge";
import { DataTable } from "./DataTable";

const STATE_TONE: Record<RunnerState, Tone> = {
    idle: "good",
    busy: "neutral",
    offline: "bad",
};

/** GitHub's self-hosted runners as the cockpit read them. */
export function RunnersPanel({ runners }: { runners: readonly RunnerView[] }) {
    const count = (s: RunnerState) =>
        runners.filter((r) => r.state === s).length;
    return (
        <Section
            id="runners"
            title="Runners"
            meta={`${count("idle")} idle · ${count("busy")} busy · ${count("offline")} offline`}
            tone={count("offline") > 0 ? "warn" : undefined}
        >
            <DataTable
                label="Runners"
                columns={[
                    {
                        header: "runner",
                        cell: (r) => (
                            <span className="font-mono">{r.name}</span>
                        ),
                    },
                    { header: "host", cell: (r) => r.host ?? "–" },
                    { header: "roles", cell: (r) => r.roles.join(", ") || "–" },
                    {
                        header: "state",
                        cell: (r) => (
                            <StateBadge
                                tone={STATE_TONE[r.state]}
                                term={r.state}
                            >
                                {r.state}
                            </StateBadge>
                        ),
                    },
                ]}
                rows={runners}
                rowKey={(r) => r.name}
                empty="no runner registered"
            />
        </Section>
    );
}
