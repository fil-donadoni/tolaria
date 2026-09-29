import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Panel, PanelHeader, PanelBody } from "@/components/ui/panel";
import {
    distinctSorted,
    matchesClassFilters,
    EMPTY_CLASS_FILTERS,
} from "@/lib/botFindings";
import type { FindingLaunchActions } from "@/lib/ai/bot-finding-launch";
import BotFindingClassRow from "./bot-finding-class-row";
import BotFindingsFilterSelect from "./bot-findings-filter-select";

/**
 * `/admin/bot-findings` — the Classes tab (ADR 0141, issue #4177): one row
 * per Bot Gap class, ranked by how many cards it unlocks per Target List, in
 * Target priority order (the server's `listClasses` — the same ranking the
 * Grammar Gaps use).
 */
export default function BotFindingsClassesPanel({
    actions,
}: {
    actions: FindingLaunchActions;
}) {
    const classes = useQuery(api.botFindings.listClasses, {});
    const findings = useQuery(api.botFindings.listFindings, {});
    const measurement = useQuery(api.botFindings.latestMeasurement, {});
    const loaded =
        classes !== undefined &&
        findings !== undefined &&
        measurement !== undefined;
    const [filters, setFilters] = useState(EMPTY_CLASS_FILTERS);

    const targets = useMemo(
        () =>
            [
                ...new Set(
                    (classes ?? []).flatMap((c) =>
                        c.targetCounts.map((t) => t.target)
                    )
                ),
            ].sort(),
        [classes]
    );
    const causes = distinctSorted(classes ?? [], (c) => c.cause);
    const filtered = (classes ?? []).filter((c) =>
        matchesClassFilters(c, filters)
    );

    return (
        <Panel>
            <PanelHeader
                title="Classes"
                subtitle={
                    !loaded ? "Loading…" : `${classes.length} Bot Gap class(es)`
                }
            />
            <PanelBody className="flex flex-col gap-3">
                {loaded && (
                    <div
                        data-bot-findings-class-filters=""
                        className="flex flex-wrap gap-2"
                    >
                        <BotFindingsFilterSelect
                            label="Filter by Target List"
                            placeholder="All Target Lists"
                            value={filters.target}
                            options={targets.map((t) => ({
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
                        <input
                            aria-label="Filter by Ops or keywords in the class key"
                            placeholder="Ops/keywords in class key…"
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
                ) : classes.length === 0 ? (
                    <span className="text-xs text-text-disabled">
                        No Bot Gap classes on this deployment
                    </span>
                ) : filtered.length === 0 ? (
                    <span className="text-xs text-text-disabled">
                        No class matches these filters
                    </span>
                ) : (
                    filtered.map((cls) => (
                        <BotFindingClassRow
                            key={cls.key}
                            cls={cls}
                            findings={findings}
                            measurement={measurement}
                            actions={actions}
                        />
                    ))
                )}
            </PanelBody>
        </Panel>
    );
}
