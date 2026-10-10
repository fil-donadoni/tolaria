// PROTOTYPE — throwaway. Pack Source as art tiles (variant A).
import { cn } from "~/lib/utils";
import ProtoArtCard from "../proto-art-card";
import { SOURCES, artOf, packMeta, selectable } from "./setup-data";
import type { SetupApi } from "./setup-frame";
import SetupNotice from "./setup-notice";

export default function SetupPackTiles(api: SetupApi) {
    const { s, set, source } = api;
    return (
        <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
                {SOURCES.map((src) => {
                    const ok = selectable(src, s.type);
                    const on = s.sourceId === src.id;
                    return (
                        <div key={src.id} className="relative">
                            <ProtoArtCard
                                art={{ image: artOf(src) }}
                                chip={src.codes}
                                title={src.name}
                                titleClass="text-lg sm:text-xl"
                                meta={packMeta(src, s)}
                                line={
                                    ok
                                        ? `${src.pct}% implemented`
                                        : "Draft only — the cube is singleton"
                                }
                                onClick={
                                    ok
                                        ? () => set({ sourceId: src.id })
                                        : undefined
                                }
                                className={cn(
                                    "h-44 sm:h-52",
                                    on && "border-accent ring-2 ring-accent",
                                    !ok &&
                                        "cursor-not-allowed opacity-40 grayscale"
                                )}
                            />
                            {on && (
                                <span className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-accent text-sm font-bold text-surface-base">
                                    ✓
                                </span>
                            )}
                            {src.pct < 100 && ok && (
                                <span className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
                                    <span
                                        className="block h-full bg-accent"
                                        style={{ width: `${src.pct}%` }}
                                    />
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>
            <SetupNotice source={source} />
        </div>
    );
}
