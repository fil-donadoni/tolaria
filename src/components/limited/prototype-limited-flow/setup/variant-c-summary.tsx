// PROTOTYPE — throwaway. C: one screen — hero summary + rows that edit inline.
import { useState, type ReactNode } from "react";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import ProtoArtCard from "../proto-art-card";
import SetupFrame, { type SetupApi } from "./setup-frame";
import { SOURCES, artOf, packMeta, selectable, typeLabel } from "./setup-data";
import SetupNotice from "./setup-notice";
import SetupTypeStep from "./setup-type-step";
import {
    BoostersField,
    DeadlineField,
    DecklistsField,
    GamesFormatField,
    SeatsField,
    TimerField,
} from "./setup-fields";

function PackList({ s, set }: SetupApi) {
    return (
        <div className="grid gap-1.5 sm:grid-cols-2">
            {SOURCES.map((src) => {
                const ok = selectable(src, s.type);
                const on = src.id === s.sourceId;
                return (
                    <button
                        key={src.id}
                        type="button"
                        disabled={!ok}
                        onClick={() => set({ sourceId: src.id })}
                        className={cn(
                            "flex items-center gap-2.5 rounded-sm border p-1.5 text-left",
                            on
                                ? "border-accent bg-accent/10"
                                : "border-border-strong",
                            !ok && "cursor-not-allowed opacity-40"
                        )}
                    >
                        <img
                            src={artOf(src)}
                            alt=""
                            className="size-11 shrink-0 rounded-sm object-cover"
                        />
                        <span className="flex min-w-0 flex-col">
                            <span className="truncate text-sm text-parchment">
                                {src.name}
                            </span>
                            <span className="truncate text-[11px] text-text-muted">
                                {ok
                                    ? `${src.codes} · ${src.pct}%`
                                    : "Draft only"}
                            </span>
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

export default function VariantCSummary() {
    const [open, setOpen] = useState<string | null>(null);
    return (
        <SetupFrame>
            {(api) => {
                const { s, source } = api;
                const rows: {
                    key: string;
                    label: string;
                    value: string;
                    body: ReactNode;
                }[] = [
                    {
                        key: "type",
                        label: "Type",
                        value: typeLabel(s.type),
                        body: <SetupTypeStep {...api} />,
                    },
                    {
                        key: "pack",
                        label: "Pack Source",
                        value: `${source.name} · ${packMeta(source, s)}`,
                        body: (
                            <div className="flex flex-col gap-2">
                                <PackList {...api} />
                                <SetupNotice source={source} />
                            </div>
                        ),
                    },
                    {
                        key: "seats",
                        label: "Seats",
                        value: `${s.seats}`,
                        body: <SeatsField {...api} />,
                    },
                    {
                        key: "games",
                        label: "Games format",
                        value: s.gamesFormat === "bo3" ? "Bo3" : "Bo1",
                        body: <GamesFormatField {...api} />,
                    },
                    s.type === "sealed"
                        ? {
                              key: "boost",
                              label: "Boosters per seat",
                              value: `${s.boosters}`,
                              body: <BoostersField {...api} />,
                          }
                        : {
                              key: "timer",
                              label: "Pick timer",
                              value: s.timer ? "On" : "Off",
                              body: <TimerField {...api} />,
                          },
                    {
                        key: "deadline",
                        label: "Round deadline",
                        value: s.deadline ? `${s.deadlineMin} min` : "Off",
                        body: <DeadlineField {...api} />,
                    },
                    {
                        key: "open",
                        label: "Open decklists",
                        value: s.openDecklists ? "On — decks visible" : "Off",
                        body: <DecklistsField {...api} />,
                    },
                ];
                return (
                    <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                        <div className="flex flex-col gap-3 md:sticky md:top-3 md:self-start">
                            <ProtoArtCard
                                art={{ image: artOf(source) }}
                                chip={`${typeLabel(s.type)} · ${source.codes}`}
                                title={source.name}
                                titleClass="text-3xl"
                                meta={`${packMeta(source, s)} · ${s.seats} seats`}
                                line={`${source.pct}% implemented`}
                                className="h-56 md:h-72"
                            />
                            <Button className="w-full" onClick={api.create}>
                                Create {typeLabel(s.type)} event
                            </Button>
                        </div>
                        <div className="divide-y divide-[var(--hairline)] overflow-hidden rounded-[var(--panel-radius)] border border-border-strong bg-surface/80">
                            {rows.map((r) => {
                                const on = open === r.key;
                                return (
                                    <div key={r.key}>
                                        <button
                                            type="button"
                                            aria-expanded={on}
                                            onClick={() =>
                                                setOpen(on ? null : r.key)
                                            }
                                            className={cn(
                                                "flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-elevated/40",
                                                on && "bg-accent/10"
                                            )}
                                        >
                                            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                                                {r.label}
                                            </span>
                                            <span className="flex min-w-0 items-center gap-2">
                                                <span className="truncate text-sm text-parchment">
                                                    {r.value}
                                                </span>
                                                <span className="text-xs text-accent">
                                                    {on ? "Done" : "Edit"}
                                                </span>
                                            </span>
                                        </button>
                                        {on && (
                                            <div className="px-4 pb-4 pt-1">
                                                {r.body}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            }}
        </SetupFrame>
    );
}
