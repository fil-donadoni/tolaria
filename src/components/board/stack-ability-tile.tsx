import { tryGetDefinition } from "@convex/cards";
import {
    ART_CROP_RATIO,
    getArtCropImageUrl,
    resolveCardImageId,
} from "~/lib/images";
import { formatOracleText } from "~/lib/oracle-text";
import TokenPlaceholder from "../cards/token-placeholder";

type StackAbilityTileProps = {
    cardId: string;
    abilityText: string;
    kind: "activated" | "triggered";
};

export default function StackAbilityTile({
    cardId,
    abilityText,
    kind,
}: StackAbilityTileProps) {
    const def = tryGetDefinition(cardId);
    const name = def?.name ?? cardId;
    const imageId = resolveCardImageId(cardId);
    const imageSrc = imageId ? getArtCropImageUrl(imageId) : null;
    const badgeLabel = kind === "triggered" ? "Trigger" : "Ability";

    return (
        <div className="w-full flex flex-col rounded-lg shadow-lg bg-surface overflow-hidden ring-1 ring-border-accent">
            <div
                className="relative w-full"
                style={{ aspectRatio: ART_CROP_RATIO }}
            >
                {imageSrc ? (
                    <img
                        src={imageSrc}
                        alt={name}
                        className="w-full h-full block object-cover"
                        draggable={false}
                    />
                ) : (
                    <TokenPlaceholder
                        name={name}
                        types={def?.types ?? []}
                        subtypes={def?.subtypes ?? []}
                        power={def?.power}
                        toughness={def?.toughness}
                        staticAbilities={def?.staticAbilities ?? []}
                    />
                )}
                <div className="absolute top-1 left-1 text-[9px] uppercase tracking-wider font-semibold text-text bg-black/70 px-1.5 py-0.5 rounded">
                    {badgeLabel}
                </div>
            </div>
            <div className="p-2 space-y-1 text-left">
                <div className="text-[10px] font-semibold text-text truncate">
                    {name}
                </div>
                <div className="text-[10px] leading-snug text-text">
                    {formatOracleText(abilityText)}
                </div>
            </div>
        </div>
    );
}
