import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Panel, PanelHeader, PanelBody } from "@/components/ui/panel";
import { Banner } from "@/components/ui/banner";
import SegmentedControl from "@/components/ui/segmented-control";
import {
    distinctSorted,
    filterByStaleness,
    isStaleFinding,
    matchesFindingFilters,
    measurementSummary,
    stalenessSummary,
    EMPTY_FINDING_FILTERS,
    STALENESS_FILTERS,
    type StalenessFilter,
} from "@/lib/botFindings";
import {
    FINDING_STATUS_LABEL,
    type FindingStatus,
} from "@convex/gre/ai/botFindingState";
import BotFindingRow from "./bot-finding-row";
import BotFindingsFilterSelect from "./bot-findings-filter-select";

const STATUS_OPTIONS = (
    Object.entries(FINDING_STATUS_LABEL) as [FindingStatus, string][]
).map(([value, label]) => ({ value, label }));

/**
 * `/admin/bot-findings` — the Cards tab: one row per card the play Bot is
 * known to struggle with (ADR 0141, PRD #4174, issue #4176/#4177), over the
 * tables `bun run seed:bot-findings` writes from the committed measurement.
 *
 * The header states measured vs total before anything else: the rows cover
 * the measured Target Lists only, and the hand-written cards outside them
 * were never played at all — a small count here is not "few Bot problems".
 *
 * The header also says how current the page is (issue #4181): when the
 * measurement ran, and — when the Bot has moved since — how many rows were
 * measured under an older Bot hash. Those rows carry a stale flag and can be
 * filtered to; the filter narrows the list, staleness never removes a row.
 *
 * Every query is `assertIsAdmin`-gated server-side; the route gate is cosmetic.
 */
export default function BotFindingsCardsPanel() {
    const findings = useQuery(api.botFindings.listFindings, {});
    const classes = useQuery(api.botFindings.listClasses, {});
    const measurement = useQuery(api.botFindings.latestMeasurement, {});
    const loaded =
        findings !== undefined &&
        classes !== undefined &&
        measurement !== undefined;
    const classByKey = new Map((classes ?? []).map((c) => [c.key, c]));
    const [filters, setFilters] = useState(EMPTY_FINDING_FILTERS);
    const [staleness, setStaleness] = useState<StalenessFilter>("all");

    const allTargets = [
        ...new Set((findings ?? []).flatMap((f) => f.targets)),
    ].sort();
    const causes = distinctSorted(findings ?? [], (f) => f.cause);
    const filtered = (
        loaded ? filterByStaleness(findings, staleness, measurement) : []
    ).filter((f) => matchesFindingFilters(f, filters));
    const staleNote =
        loaded && measurement !== null
            ? stalenessSummary(findings, measurement)
            : null;

    return (
        <Panel>
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
                {staleNote !== null && (
                    <Banner tone="danger" data-bot-findings-stale-banner="">
                        {staleNote}
                    </Banner>
                )}
                {loaded && measurement !== null && findings.length > 0 && (
                    <SegmentedControl
                        ariaLabel="Filter by measurement staleness"
                        options={STALENESS_FILTERS}
                        value={staleness}
                        onChange={setStaleness}
                    />
                )}
                {loaded && findings.length > 0 && (
                    <div
                        data-bot-findings-card-filters=""
                        className="flex flex-wrap gap-2"
                    >
                        <BotFindingsFilterSelect
                            label="Filter by Target List"
                            placeholder="All Target Lists"
                            value={filters.target}
                            options={allTargets.map((t) => ({
                                value: t,
                                label: t,
                            }))}
                            onChange={(target) =>
                                setFilters((f) => ({ ...f, target }))
                            }
                        />
                        <BotFindingsFilterSelect
                            label="Filter by cause"
                            placeholder="All causes"
                            value={filters.cause}
                            options={causes.map((c) => ({
                                value: c,
                                label: c,
                            }))}
                            onChange={(cause) =>
                                setFilters((f) => ({ ...f, cause }))
                            }
                        />
                        <BotFindingsFilterSelect
                            label="Filter by blame"
                            placeholder="Bot + harness"
                            value={filters.blame}
                            options={[
                                { value: "bot", label: "Bot owes a fix" },
                                {
                                    value: "harness",
                                    label: "Harness owes a fix",
                                },
                            ]}
                            onChange={(blame) =>
                                setFilters((f) => ({ ...f, blame }))
                            }
                        />
                        <BotFindingsFilterSelect
                            label="Filter by status"
                            placeholder="Every status"
                            value={filters.status}
                            options={STATUS_OPTIONS}
                            onChange={(status) =>
                                setFilters((f) => ({
                                    ...f,
                                    status: status as FindingStatus | "",
                                }))
                            }
                        />
                        <input
                            aria-label="Filter by card name"
                            placeholder="Card name…"
                            value={filters.query}
                            onChange={(e) =>
                                setFilters((f) => ({
                                    ...f,
                                    query: e.target.value,
                                }))
                            }
                            className="rounded-sm border border-border-subtle bg-surface px-2 py-1 text-xs text-text"
                        />
                    </div>
                )}
                {!loaded ? (
                    <span className="text-xs text-text-disabled">Loading…</span>
                ) : findings.length === 0 ? (
                    <span className="text-xs text-text-disabled">
                        No findings on this deployment
                    </span>
                ) : filtered.length === 0 ? (
                    <span className="text-xs text-text-disabled">
                        No card matches these filters
                    </span>
                ) : (
                    filtered.map((finding) => (
                        <BotFindingRow
                            key={finding._id}
                            finding={finding}
                            stale={
                                measurement !== null &&
                                isStaleFinding(finding, measurement)
                            }
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
