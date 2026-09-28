import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Panel, PanelHeader, PanelBody } from "@/components/ui/panel";
import SurfaceReadyMarker from "@/components/ui/surface-ready-marker";
import { measurementSummary } from "@/lib/botFindings";
import BotFindingRow from "./bot-finding-row";

/**
 * `/admin/bot-findings` — the Cards tab: one row per card the play Bot is
 * known to struggle with (ADR 0141, PRD #4174, issue #4176), over the tables
 * `bun run seed:bot-findings` writes from the committed measurement.
 *
 * The header states measured vs total before anything else: the rows cover
 * the measured Target Lists only, and the hand-written cards outside them
 * were never played at all — a small count here is not "few Bot problems".
 *
 * Every query is `assertIsAdmin`-gated server-side; the route gate is cosmetic.
 */
export default function BotFindingsAdminPanel() {
    const findings = useQuery(api.botFindings.listFindings, {});
    const classes = useQuery(api.botFindings.listClasses, {});
    const measurement = useQuery(api.botFindings.latestMeasurement, {});
    const loaded =
        findings !== undefined &&
        classes !== undefined &&
        measurement !== undefined;
    const classByKey = new Map((classes ?? []).map((c) => [c.key, c]));

    return (
        <Panel>
            {loaded && <SurfaceReadyMarker />}
            <PanelHeader
                title="Cards"
                subtitle={
                    !loaded
                        ? "Loading…"
                        : `${findings.filter((f) => f.outcome !== "played").length} cards the Bot does not play`
                }
            />
            <PanelBody className="flex flex-col gap-3">
                {loaded && (
                    <p
                        data-bot-findings-measurement=""
                        className="text-sm text-text-muted"
                    >
                        {measurement === null
                            ? "No measurement seeded on this deployment — run bun run seed:bot-findings."
                            : `${measurementSummary(measurement)} Measured ${measurement.measuredAt} at ${measurement.sha.slice(0, 9)}.`}
                    </p>
                )}
                {!loaded ? (
                    <span className="text-xs text-text-disabled">Loading…</span>
                ) : findings.length === 0 ? (
                    <span className="text-xs text-text-disabled">
                        No findings on this deployment
                    </span>
                ) : (
                    findings.map((finding) => (
                        <BotFindingRow
                            key={finding._id}
                            finding={finding}
                            cls={
                                finding.gap === undefined
                                    ? undefined
                                    : classByKey.get(finding.gap)
                            }
                        />
                    ))
                )}
            </PanelBody>
        </Panel>
    );
}
