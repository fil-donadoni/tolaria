// Built deck view (issue #8899): the focused seat's Maindeck as Auto-Build
// makes it from its Pool, grouped by curve, beside the Draft Table Audit's
// per-deck fields — the very numbers the audit's Floors hold, read off the
// shared `DeckAudit` (`draftTableAudit.ts`), never re-measured. Shown once
// the draft is completed (a Pool is final only then). Writes nothing itself
// (ADR 0074): the one report action (issue #8900) arrives as `children`, so
// this panel stays pure.
import type { ReactNode } from "react";
import { Panel, PanelHeader, PanelBody } from "@/components/ui/panel";
import type { DraftLabBuiltSeat } from "@/lib/limited/draftLabEngine";
import {
    builtDeckAuditFields,
    groupMaindeckByCurve,
} from "@/lib/limited/draftLabBuiltDeck";

export default function DraftLabBuiltDeckPanel({
    seatLabel,
    built,
    children,
}: {
    seatLabel: string;
    built: DraftLabBuiltSeat;
    children?: ReactNode;
}) {
    const fields = builtDeckAuditFields(built.audit);

    return (
        <Panel density="compact" className="min-w-[320px] flex-1">
            <PanelHeader title={`${seatLabel} — built deck`} />
            <PanelBody>
                <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-[11px]">
                    {fields.map(({ label, value }) => (
                        <div key={label} className="contents">
                            <dt className="text-text-disabled">{label}</dt>
                            <dd className="text-text">{value}</dd>
                        </div>
                    ))}
                </dl>
                <div className="mt-3 flex flex-col gap-2">
                    {groupMaindeckByCurve(built.deck.cards).map((group) => (
                        <section key={group.key}>
                            <h4 className="text-[10px] font-semibold text-text-muted">
                                {group.label} (
                                {group.cards.reduce((a, c) => a + c.count, 0)})
                            </h4>
                            <p className="text-[10px] leading-tight text-text-disabled">
                                {group.cards
                                    .map((c) =>
                                        c.count > 1
                                            ? `${c.count}× ${c.cardName}`
                                            : c.cardName
                                    )
                                    .join(", ")}
                            </p>
                        </section>
                    ))}
                </div>
                {children}
            </PanelBody>
        </Panel>
    );
}
