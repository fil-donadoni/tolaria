// PROTOTYPE — throwaway. Host for the three Pick Ratings page variants —
// same shape as `card-profiles-prototype.tsx`: real rows, local stub writes.
import { useMemo, useState } from "react";
import { useDraftableSets } from "~/hooks/useLimitedEvent";
import { useScopeCardRatings } from "~/hooks/useCardRatings";
import PrototypeSwitcher from "./prototype-switcher";
import { PROTO_VARIANTS, readVariant, writeVariant } from "./proto-variants";
import { toProtoRatingCard, type ProtoRatingCard } from "./proto-data";
import RatingsVariantAWorkbench from "./ratings-variant-a-workbench";
import RatingsVariantBTiers from "./ratings-variant-b-tiers";
import RatingsVariantCFocus from "./ratings-variant-c-focus";

export interface RatingsProtoApi {
    scopes: { setCode: string; label: string }[];
    scope: string | undefined;
    setScope: (s: string) => void;
    cards: ProtoRatingCard[] | undefined;
    setRating: (cardId: string, rating: number | null) => void;
    log: string[];
}

export default function PickRatingsPrototype() {
    const [variant, setVariant] = useState(readVariant);
    const draftableSets = useDraftableSets();
    const scopes = useMemo(
        () =>
            (draftableSets ?? [])
                .filter((s) => s.draftable)
                .map((s) => ({
                    setCode: s.setCode,
                    label: s.isCube ? "Vintage Cube" : s.setCode.toUpperCase(),
                }))
                .sort(
                    (a, b) =>
                        Number(b.label === "Vintage Cube") -
                        Number(a.label === "Vintage Cube")
                ),
        [draftableSets]
    );
    const [scope, setScope] = useState<string | undefined>(undefined);
    const resolvedScope = scope ?? scopes[0]?.setCode;
    const wire = useScopeCardRatings(resolvedScope);
    const [overrides, setOverrides] = useState<Map<string, number | null>>(
        () => new Map()
    );
    const [log, setLog] = useState<string[]>([]);

    const cards = useMemo(() => {
        if (!wire) return undefined;
        return wire.map((w) => {
            const base = toProtoRatingCard(w);
            if (!overrides.has(w.cardId)) return base;
            const r = overrides.get(w.cardId) ?? null;
            return {
                ...base,
                rating: r ?? base.seedRating,
                source:
                    r === null
                        ? base.seedRating === null
                            ? ("unrated" as const)
                            : ("seed" as const)
                        : ("override" as const),
            };
        });
    }, [wire, overrides]);

    const api: RatingsProtoApi = {
        scopes,
        scope: resolvedScope,
        setScope,
        cards,
        log,
        setRating: (cardId, rating) => {
            setOverrides((m) => new Map(m).set(cardId, rating));
            const name =
                cards?.find((c) => c.cardId === cardId)?.name ?? cardId;
            setLog((l) =>
                [`rating ${name} → ${rating ?? "cleared"}`, ...l].slice(0, 30)
            );
        },
    };

    return (
        <>
            {variant === "A" && <RatingsVariantAWorkbench api={api} />}
            {variant === "B" && <RatingsVariantBTiers api={api} />}
            {variant === "C" && <RatingsVariantCFocus api={api} />}
            <PrototypeSwitcher
                variants={[...PROTO_VARIANTS]}
                current={variant}
                onChange={(k) => {
                    writeVariant(k);
                    setVariant(k as typeof variant);
                }}
            />
        </>
    );
}
