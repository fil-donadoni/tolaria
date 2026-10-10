// PROTOTYPE — throwaway. The same FLIP fly in the draft room: a pick leaves
// the pack and lands in the Pool or the Sideboard (chooser), and a card in
// either fanned strip flies to the other one.
import { useState } from "react";
import { RotateCcwIcon } from "lucide-react";
import SegmentedControl from "~/components/ui/segmented-control";
import type { ProtoCard } from "../proto-cards";
import { DEMO_PACK } from "./builder-data";
import BuilderPanel from "./builder-panel";
import DraftMiniCard from "./draft-mini-card";
import DraftStrip from "./draft-strip";
import { useFly } from "./useFly";

type Dest = "pool" | "side";
const DEST_OPTIONS = [
    { value: "pool", label: "Pool" },
    { value: "side", label: "Sideboard" },
] as const;

export default function DraftFlyDemo() {
    const [pack, setPack] = useState<ProtoCard[]>(DEMO_PACK);
    const [pool, setPool] = useState<ProtoCard[]>([]);
    const [side, setSide] = useState<ProtoCard[]>([]);
    const [dest, setDest] = useState<Dest>("pool");
    const launch = useFly();

    const pick = (c: ProtoCard, el: Element, src: string) => {
        launch(`draft:${c.name}`, el, src);
        setPack((p) => p.filter((x) => x !== c));
        (dest === "pool" ? setPool : setSide)((p) => [...p, c]);
    };
    const swap = (from: Dest) => (c: ProtoCard, el: Element, src: string) => {
        launch(`draft:${c.name}`, el, src);
        (from === "pool" ? setPool : setSide)((p) => p.filter((x) => x !== c));
        (from === "pool" ? setSide : setPool)((p) => [...p, c]);
    };
    const reset = () => {
        setPack(DEMO_PACK);
        setPool([]);
        setSide([]);
    };

    return (
        <BuilderPanel className="flex flex-col gap-3 border-dashed">
            <header className="flex flex-wrap items-center gap-2">
                <span className="rounded-sm bg-fuchsia-600/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                    Demo
                </span>
                <h3 className="font-display text-sm tracking-wide text-parchment">
                    Draft room — pick fly
                </h3>
                <div className="ml-auto flex items-center gap-2">
                    <span className="text-[11px] text-text-muted">Pick to</span>
                    <SegmentedControl
                        ariaLabel="Send picks to"
                        options={DEST_OPTIONS}
                        value={dest}
                        onChange={(v) => setDest(v as Dest)}
                    />
                    <button
                        type="button"
                        onClick={reset}
                        aria-label="Reset the pack"
                        className="segment-pill segment-inactive"
                    >
                        <RotateCcwIcon className="size-3.5" />
                    </button>
                </div>
            </header>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-disabled">
                        Pack 1 · pick {DEMO_PACK.length - pack.length + 1}
                    </span>
                    <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8 sm:gap-2">
                        {pack.map((c) => (
                            <DraftMiniCard
                                key={c.name}
                                card={c}
                                onClick={pick}
                                className="w-full"
                            />
                        ))}
                        {pack.length === 0 && (
                            <p className="col-span-full py-6 text-center text-xs text-text-muted">
                                Pack empty — reset to replay.
                            </p>
                        )}
                    </div>
                </div>
                <div className="flex min-w-0 flex-col gap-3">
                    <DraftStrip
                        title="Pool"
                        cards={pool}
                        onCardClick={swap("pool")}
                    />
                    <DraftStrip
                        title="Sideboard"
                        cards={side}
                        onCardClick={swap("side")}
                    />
                </div>
            </div>
        </BuilderPanel>
    );
}
