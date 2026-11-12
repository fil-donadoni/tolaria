// PROTOTYPE (zone-target highlight) — throwaway, never merged (branch
// prototype/zone-target-highlight). Question: when a spell/ability on the
// stack targets cards in a graveyard (or exile), the arrow lands on the PILE —
// how does the board show WHICH cards are targeted? Four structurally
// different answers mounted over the REAL board (sub-shape A):
//   /game/<id>?zoneProto=<scenario>&variant=<A|B|C|D>
// scenario: real (stack's own graveyard-card targets) | one | three | split |
// exile (simulated from the real zones). Dev builds only.
import { useMemo, useState } from "react";
import type { Player, StackItem } from "~/types/game";
import { deriveGroups, useAnchors } from "./use-zone-target-model";
import ZoneProtoSwitcher, {
    readZoneProto,
    writeZoneProto,
    type ZoneProtoParams,
} from "./zone-proto-switcher";
import VariantAFan, { VARIANT_A_NAME } from "./variant-a-fan";
import VariantBManifest, { VARIANT_B_NAME } from "./variant-b-manifest";
import VariantCLift, { VARIANT_C_NAME } from "./variant-c-lift";
import VariantDPeek, { VARIANT_D_NAME } from "./variant-d-peek";

const VARIANTS = [
    { key: "A", name: VARIANT_A_NAME, C: VariantAFan },
    { key: "B", name: VARIANT_B_NAME, C: VariantBManifest },
    { key: "C", name: VARIANT_C_NAME, C: VariantCLift },
    { key: "D", name: VARIANT_D_NAME, C: VariantDPeek },
];

export default function ZoneTargetPrototype({
    stack,
    players,
    viewerId,
}: {
    stack: StackItem[];
    players: Player[];
    viewerId: string;
}) {
    const [params, setParams] = useState<ZoneProtoParams | null>(() =>
        import.meta.env.DEV ? readZoneProto() : null
    );
    const scenario = params?.scenario ?? "real";
    const groups = useMemo(
        () => deriveGroups(scenario, stack, players, viewerId),
        [scenario, stack, players, viewerId]
    );
    const anchors = useAnchors(groups);
    if (!params) return null;
    const variant =
        VARIANTS.find((v) => v.key === params.variant) ?? VARIANTS[0];
    const change = (p: ZoneProtoParams) => {
        writeZoneProto(p);
        setParams(p);
    };
    const missing = groups.filter((g) => !anchors[g.key]?.zone).length;
    return (
        <>
            <variant.C
                groups={groups}
                anchors={anchors}
                drawBase={scenario !== "real"}
            />
            <ZoneProtoSwitcher
                variants={VARIANTS}
                params={params}
                onChange={change}
                status={`${groups.length} group(s) · ${groups.reduce(
                    (n, g) => n + g.cards.length,
                    0
                )} card(s)${missing ? ` · ${missing} pile anchor(s) unmeasured` : ""}`}
            />
        </>
    );
}
