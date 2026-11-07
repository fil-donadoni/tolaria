// PROTOTYPE — throwaway. Host for the three Card Profiles page variants:
// real scope list and real profile rows through the real hooks, every write
// a LOCAL stub (an override map merged over the wire rows; nothing reaches
// Convex). `?variant=A|B|C` picks the variant; the switcher writes the URL.
import { useMemo, useState } from "react";
import { useDraftableSets } from "~/hooks/useLimitedEvent";
import { useScopeCardProfiles } from "~/hooks/useCardProfiles";
import PrototypeSwitcher from "./prototype-switcher";
import { PROTO_VARIANTS, readVariant, writeVariant } from "./proto-variants";
import { toProtoCard, type ProtoCard, type ProtoProfile } from "./proto-data";
import ProfilesVariantAWorkbench from "./profiles-variant-a-workbench";
import ProfilesVariantBSweep from "./profiles-variant-b-sweep";
import ProfilesVariantCFocus from "./profiles-variant-c-focus";

export interface ProfilesProtoApi {
    scopes: { setCode: string; label: string }[];
    scope: string | undefined;
    setScope: (s: string) => void;
    cards: ProtoCard[] | undefined;
    /** Stub write: replaces the card's profile locally. */
    setProfile: (cardId: string, next: ProtoProfile) => void;
    toggleTag: (
        cardId: string,
        kind: "archetypes" | "provides" | "requires",
        id: string
    ) => void;
    markReviewed: (cardId: string, reviewed: boolean) => void;
    log: string[];
}

export default function CardProfilesPrototype() {
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
    const wire = useScopeCardProfiles(resolvedScope);

    const [overrides, setOverrides] = useState<Map<string, ProtoProfile>>(
        () => new Map()
    );
    const [log, setLog] = useState<string[]>([]);

    const cards = useMemo(() => {
        if (!wire) return undefined;
        return wire.map((w) => {
            const base = toProtoCard(w);
            const o = overrides.get(w.cardId);
            if (!o) return base;
            return {
                ...base,
                profile: o,
                status: o.reviewed
                    ? ("reviewed" as const)
                    : ("override" as const),
            };
        });
    }, [wire, overrides]);

    const api: ProfilesProtoApi = {
        scopes,
        scope: resolvedScope,
        setScope,
        cards,
        log,
        setProfile: (cardId, next) => {
            setOverrides((m) => new Map(m).set(cardId, next));
            setLog((l) =>
                [`setProfile ${cardId} ${JSON.stringify(next)}`, ...l].slice(
                    0,
                    30
                )
            );
        },
        toggleTag: (cardId, kind, id) => {
            const card = cards?.find((c) => c.cardId === cardId);
            const cur: ProtoProfile = card?.profile ?? {
                archetypes: [],
                provides: [],
                requires: [],
                reviewed: false,
            };
            const list = cur[kind].includes(id)
                ? cur[kind].filter((x) => x !== id)
                : [...cur[kind], id];
            const next = { ...cur, [kind]: list, reviewed: false };
            setOverrides((m) => new Map(m).set(cardId, next));
            setLog((l) =>
                [`toggle ${kind}:${id} on ${card?.name ?? cardId}`, ...l].slice(
                    0,
                    30
                )
            );
        },
        markReviewed: (cardId, reviewed) => {
            const card = cards?.find((c) => c.cardId === cardId);
            const cur: ProtoProfile = card?.profile ?? {
                archetypes: [],
                provides: [],
                requires: [],
                reviewed: false,
            };
            setOverrides((m) => new Map(m).set(cardId, { ...cur, reviewed }));
            setLog((l) =>
                [`reviewed=${reviewed} ${card?.name ?? cardId}`, ...l].slice(
                    0,
                    30
                )
            );
        },
    };

    return (
        <>
            {variant === "A" && <ProfilesVariantAWorkbench api={api} />}
            {variant === "B" && <ProfilesVariantBSweep api={api} />}
            {variant === "C" && <ProfilesVariantCFocus api={api} />}
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
