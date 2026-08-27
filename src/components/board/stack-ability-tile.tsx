import { tryGetDefinition } from "@convex/cards";
import {
    ART_CROP_RATIO,
    getArtCropImageUrl,
    resolveCardImageFace,
    resolveCardImageId,
} from "~/lib/images";
import { formatOracleText } from "~/lib/oracle-text";
import TokenPlaceholder from "../cards/token-placeholder";

type StackAbilityTileProps = {
    cardId: string;
    abilityText: string;
    kind: "activated" | "triggered" | "delayed";
};

export default function StackAbilityTile({
    cardId,
    abilityText,
    kind,
}: StackAbilityTileProps) {
    const def = tryGetDefinition(cardId);
    const name = def?.name ?? cardId;
    const imageId = resolveCardImageId(cardId);
    // A trigger/activated-ability tile's source can be a transformed
    // permanent's back-face def id (CR 712); resolve its rendered CDN face
    // (issue #1595).
    const imageSrc = imageId
        ? getArtCropImageUrl(imageId, resolveCardImageFace(cardId))
        : null;
    const badgeLabel =
        kind === "triggered"
            ? "Trigger"
            : kind === "delayed"
              ? "Delayed Trigger"
              : "Ability";

    return (
        <div className="w-full flex flex-col rounded-lg shadow-lg bg-surface overflow-hidden ring-1 ring-border-accent">
            {/* Absolute + clip so the ratio box stays authoritative for
                PORTRAIT art too (a Saga's art_crop is 312×752) — an in-flow img
                resolves `h-full` against an `auto`-height parent and stretches
                the box instead. Same shape as `stack-row.tsx`. */}
            <div
                className="relative w-full overflow-hidden"
                style={{ aspectRatio: ART_CROP_RATIO }}
            >
                {imageSrc ? (
                    <img
                        src={imageSrc}
                        alt={name}
                        className="absolute inset-0 w-full h-full block object-cover"
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
                <div className="absolute top-1 left-1 text-[9px] uppercase tracking-wider font-semibold text-text bg-surface-base/80 border border-border-subtle px-1.5 py-0.5 rounded">
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
