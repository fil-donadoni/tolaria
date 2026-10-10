// PROTOTYPE — throwaway. Recap rail (left) + active step (right); stacked on mobile.
import { useState, type ReactNode } from "react";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { artOf, packMeta, tableSummary, typeLabel } from "./setup-data";
import type { SetupApi } from "./setup-frame";
import SetupTypeStep from "./setup-type-step";
import TableFields from "./setup-fields";

type StepKey = "type" | "pack" | "table";

export default function SetupRailLayout({
    api,
    packStep,
}: {
    api: SetupApi;
    packStep: ReactNode;
}) {
    const [active, setActive] = useState<StepKey>("type");
    const { s, source } = api;
    const steps: {
        key: StepKey;
        title: string;
        summary: string;
        body: ReactNode;
    }[] = [
        {
            key: "type",
            title: "Type",
            summary: typeLabel(s.type),
            body: <SetupTypeStep {...api} />,
        },
        {
            key: "pack",
            title: "Pack Source",
            summary: source.name,
            body: packStep,
        },
        {
            key: "table",
            title: "Table",
            summary: tableSummary(s),
            body: <TableFields {...api} />,
        },
    ];
    const i = steps.findIndex((x) => x.key === active);
    const cur = steps[i];
    const create = (
        <Button className="w-full" onClick={api.create}>
            Create {typeLabel(s.type)} event
        </Button>
    );

    return (
        <div className="grid w-full grid-cols-1 gap-4 md:grid-cols-[17rem_minmax(0,1fr)]">
            <aside className="flex flex-col gap-1 rounded-[var(--panel-radius)] border border-border-strong bg-surface/80 p-2 md:self-start">
                <div className="grid grid-cols-3 gap-1 md:flex md:flex-col">
                    {steps.map((st, k) => (
                        <button
                            key={st.key}
                            type="button"
                            onClick={() => setActive(st.key)}
                            className={cn(
                                "flex min-w-0 flex-col rounded-sm px-2 py-1.5 text-left",
                                st.key === active
                                    ? "bg-accent/15 ring-1 ring-accent/50"
                                    : "hover:bg-surface-elevated/40"
                            )}
                        >
                            <span className="text-[10px] uppercase tracking-wide text-text-muted">
                                {k + 1}. {st.title}
                            </span>
                            <span className="flex items-center gap-2">
                                {st.key === "pack" && (
                                    <img
                                        src={artOf(source)}
                                        alt=""
                                        className="hidden size-8 shrink-0 rounded-sm object-cover md:block"
                                    />
                                )}
                                <span className="truncate text-sm text-parchment">
                                    {st.summary}
                                </span>
                            </span>
                            {st.key === "pack" && (
                                <span className="hidden truncate text-[11px] text-text-muted md:block">
                                    {packMeta(source, s)}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
                <div className="mt-1 hidden border-t border-[var(--hairline)] pt-2 md:block">
                    {create}
                </div>
            </aside>
            <section className="flex flex-col gap-4 rounded-[var(--panel-radius)] border border-border-strong bg-surface/80 p-4">
                <h2 className="font-display text-xl text-parchment">
                    {i + 1}. {cur.title}
                </h2>
                {cur.body}
                <div className="flex items-center gap-2 border-t border-[var(--hairline)] pt-3">
                    {i > 0 && (
                        <Button
                            variant="secondary"
                            onClick={() => setActive(steps[i - 1].key)}
                        >
                            Back
                        </Button>
                    )}
                    {i < steps.length - 1 && (
                        <Button
                            variant="secondary"
                            onClick={() => setActive(steps[i + 1].key)}
                        >
                            Next: {steps[i + 1].title}
                        </Button>
                    )}
                    <div className="ml-auto md:hidden">{create}</div>
                </div>
            </section>
        </div>
    );
}
