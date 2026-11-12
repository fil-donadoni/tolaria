// PROTOTYPE (zone-target highlight) — B2: the stack row's OWN target block.
// Rendered inside the real StackRow (only while ?zoneProto&variant=B2): one
// compact line per zone-card target — small marked thumbnail, name, whose
// zone — so the stack item itself says what it points at, and the overlay
// draws the arrow from this line to the pile.
import type { Player, StackItem } from "~/types/game";
import ProtoThumb, { Crosshair } from "./proto-thumb";
import { protoName } from "./use-zone-target-model";
import { useZoneProtoVariant } from "./zone-proto-store";

export default function ProtoStackRowTargets({
    item,
    allPlayers,
    viewerId,
}: {
    item: StackItem;
    allPlayers: readonly Player[];
    viewerId: string;
}) {
    const variant = useZoneProtoVariant();
    if (variant !== "B2") return null;
    const lines = (item.targets ?? []).flatMap((t) => {
        if (t.type !== "graveyard-card" || !t.playerId) return [];
        const owner = allPlayers.find((p) => p.id === t.playerId);
        const card = owner?.graveyard.find((c) => c.id === t.id);
        if (!owner || !card) return [];
        return [{ card, owner }];
    });
    if (lines.length === 0) return null;
    return (
        <span className="mt-0.5 flex flex-col gap-1 border-t border-border-strong/60 pt-1">
            {lines.map(({ card, owner }) => (
                <span
                    key={card.id}
                    data-proto-group={`${item.id}:${owner.id}`}
                    data-proto-measure={`b2:${item.id}:${card.id}`}
                    className="flex items-center gap-2"
                >
                    <ProtoThumb card={card} width={26} />
                    <span className="flex min-w-0 flex-col leading-tight">
                        <span className="flex items-center gap-1 text-[11px] font-medium text-text">
                            <span className="text-accent-strong">
                                <Crosshair size={11} />
                            </span>
                            <span className="truncate">{protoName(card)}</span>
                        </span>
                        <span className="text-[10px] text-text-muted">
                            in{" "}
                            {owner.id === viewerId ? "your" : `${owner.name}'s`}{" "}
                            graveyard
                        </span>
                    </span>
                </span>
            ))}
        </span>
    );
}
