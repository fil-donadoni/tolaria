// PROTOTYPE — throwaway. Step 1: Draft / Sealed as two art tiles.
import { cn } from "~/lib/utils";
import ProtoArtCard from "../proto-art-card";
import { artOfCard, type EventType } from "./setup-data";
import type { SetupApi } from "./setup-frame";

const TYPES: { v: EventType; title: string; line: string; card: string }[] = [
    {
        v: "draft",
        title: "Draft",
        line: "Pick cards from packs passed around the table, then build.",
        card: "Fact or Fiction",
    },
    {
        v: "sealed",
        title: "Sealed",
        line: "Open boosters into a private pool and build from it.",
        card: "Mox Sapphire",
    },
];

export default function SetupTypeStep({ s, setType }: SetupApi) {
    return (
        <div className="grid gap-3 sm:grid-cols-2">
            {TYPES.map((t) => (
                <ProtoArtCard
                    key={t.v}
                    art={{ image: artOfCard(t.card) }}
                    title={t.title}
                    line={t.line}
                    chip={s.type === t.v ? "Selected" : undefined}
                    titleClass="text-3xl"
                    onClick={() => setType(t.v)}
                    className={cn(
                        "h-40 sm:h-52",
                        s.type === t.v
                            ? "border-accent ring-2 ring-accent"
                            : "opacity-80"
                    )}
                />
            ))}
        </div>
    );
}
