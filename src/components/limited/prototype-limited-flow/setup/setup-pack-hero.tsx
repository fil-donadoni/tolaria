// PROTOTYPE — throwaway. Pack Source as a showcase: one big card + a strip (variant B).
import { useRef } from "react";
import { cn } from "~/lib/utils";
import ProtoArtCard from "../proto-art-card";
import { SOURCES, artOf, packMeta, selectable } from "./setup-data";
import type { SetupApi } from "./setup-frame";
import SetupNotice from "./setup-notice";

export default function SetupPackHero(api: SetupApi) {
    const { s, set, source } = api;
    const strip = useRef<HTMLDivElement>(null);
    const idx = SOURCES.findIndex((x) => x.id === source.id);
    const step = (d: number) => {
        for (let i = 1; i <= SOURCES.length; i++) {
            const n =
                SOURCES[(idx + d * i + SOURCES.length * 2) % SOURCES.length];
            if (selectable(n, s.type)) return set({ sourceId: n.id });
        }
    };
    return (
        <div className="flex flex-col gap-3">
            <div className="relative">
                <ProtoArtCard
                    art={{ image: artOf(source) }}
                    chip={source.codes}
                    title={source.name}
                    titleClass="text-4xl sm:text-5xl"
                    meta={packMeta(source, s)}
                    line={source.blurb}
                    className="h-72 sm:h-96"
                >
                    <div className="mt-2 flex w-full max-w-xs flex-col gap-1">
                        <div className="flex justify-between text-[10px] font-semibold uppercase tracking-[0.16em] text-parchment/85">
                            <span>Implemented</span>
                            <span>{source.pct}%</span>
                        </div>
                        <span className="h-1.5 overflow-hidden rounded-full bg-black/60">
                            <span
                                className="block h-full bg-accent"
                                style={{ width: `${source.pct}%` }}
                            />
                        </span>
                    </div>
                </ProtoArtCard>
                {(["‹", "›"] as const).map((g, k) => (
                    <button
                        key={g}
                        type="button"
                        aria-label={k === 0 ? "Previous source" : "Next source"}
                        onClick={() => step(k === 0 ? -1 : 1)}
                        className={cn(
                            "absolute top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--hairline-strong)] bg-surface-base/80 text-2xl text-parchment hover:border-accent",
                            k === 0 ? "left-2" : "right-2"
                        )}
                    >
                        {g}
                    </button>
                ))}
            </div>
            <div
                ref={strip}
                className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1"
            >
                {SOURCES.map((src) => {
                    const ok = selectable(src, s.type);
                    const on = src.id === source.id;
                    return (
                        <button
                            key={src.id}
                            type="button"
                            disabled={!ok}
                            onClick={() => set({ sourceId: src.id })}
                            className={cn(
                                "relative h-20 w-28 shrink-0 snap-start overflow-hidden rounded-sm border text-left sm:w-36",
                                on
                                    ? "border-accent ring-2 ring-accent"
                                    : "border-border-strong",
                                !ok && "cursor-not-allowed opacity-35 grayscale"
                            )}
                        >
                            <img
                                src={artOf(src)}
                                alt=""
                                className="absolute inset-0 h-full w-full object-cover"
                            />
                            <span className="absolute inset-0 bg-gradient-to-t from-black/85 to-transparent" />
                            <span className="absolute inset-x-1.5 bottom-1 truncate text-[11px] font-semibold text-parchment">
                                {src.name}
                            </span>
                            {!ok && (
                                <span className="absolute left-1.5 top-1 text-[9px] uppercase text-parchment/90">
                                    Draft only
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
            <SetupNotice source={source} />
        </div>
    );
}
