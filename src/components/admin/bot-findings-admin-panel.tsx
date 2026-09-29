import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import SurfaceReadyMarker from "@/components/ui/surface-ready-marker";
import BotFindingsCardsPanel from "./bot-findings-cards-panel";
import BotFindingsClassesPanel from "./bot-findings-classes-panel";

type BotFindingsTab = "cards" | "classes";

const TABS: { id: BotFindingsTab; label: string }[] = [
    { id: "cards", label: "Cards" },
    { id: "classes", label: "Classes" },
];

/**
 * `/admin/bot-findings` — the two tabs over the same measurement (ADR 0141,
 * PRD #4174, issue #4177): Cards (one row per card the Bot does not play) and
 * Classes (one row per Bot Gap class, ranked by leverage).
 *
 * The page's ready marker lives HERE, not in either tab: it must survive a tab
 * switch, and `check:ui`'s route guard reads only the route and its direct
 * imports (`ui-gate-surface-ready.test.ts`). The three queries are the same
 * calls, with the same args, the tabs make — Convex serves them from one
 * subscription each, so this subscribes to nothing new.
 */
export default function BotFindingsAdminPanel() {
    const [tab, setTab] = useState<BotFindingsTab>("cards");
    const findings = useQuery(api.botFindings.listFindings, {});
    const classes = useQuery(api.botFindings.listClasses, {});
    const measurement = useQuery(api.botFindings.latestMeasurement, {});
    const loaded =
        findings !== undefined &&
        classes !== undefined &&
        measurement !== undefined;

    return (
        <div className="flex flex-col gap-4">
            {loaded && <SurfaceReadyMarker />}
            <div
                role="tablist"
                aria-label="Bot Findings"
                data-bot-findings-tabs=""
                className="flex gap-1 border-b border-border-subtle/40"
            >
                {TABS.map((t) => (
                    <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={tab === t.id}
                        data-bot-findings-tab={t.id}
                        onClick={() => setTab(t.id)}
                        className={`px-3 py-1.5 text-sm font-semibold transition-colors ${
                            tab === t.id
                                ? "border-b-2 border-accent text-text"
                                : "text-text-muted hover:text-text"
                        }`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>
            {tab === "cards" ? (
                <BotFindingsCardsPanel />
            ) : (
                <BotFindingsClassesPanel />
            )}
        </div>
    );
}
