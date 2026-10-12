// PROTOTYPE (issue #4433) — throwaway, never merged (branch
// prototype/issue-4433-coin-flip). Three structurally different Random Reveal
// presentations for single / series / two-player coin flips, mounted over the
// REAL board (sub-shape A). Open any game with `?coinProto` in the URL:
//   /game/<id>?coinProto=squee&variant=B
// Mutations are stubbed: the ack and the Bot's wait are simulated locally.
import { useState } from "react";
import { useReducedMotion } from "motion/react";
import { SCENARIOS } from "./prototype-scenarios";
import { useProtoSequence } from "./use-proto-sequence";
import PrototypeSwitcher, {
    readProtoParams,
    writeProtoParams,
    type ProtoParams,
} from "./prototype-switcher";
import ProtoSummaryToast from "./proto-summary-toast";
import VariantASpotlight, { VARIANT_A_NAME } from "./variant-a-spotlight";
import VariantBLedger, { VARIANT_B_NAME } from "./variant-b-ledger";
import VariantCRibbon, { VARIANT_C_NAME } from "./variant-c-ribbon";

const VARIANTS = [
    { key: "A", name: VARIANT_A_NAME, C: VariantASpotlight },
    { key: "B", name: VARIANT_B_NAME, C: VariantBLedger },
    { key: "C", name: VARIANT_C_NAME, C: VariantCRibbon },
];

export default function CoinFlipPrototype() {
    const [params, setParams] = useState<ProtoParams | null>(() =>
        import.meta.env.DEV ? readProtoParams() : null
    );
    const [runId, setRunId] = useState(0);
    const sysReduce = useReducedMotion() ?? false;
    const scenario =
        SCENARIOS.find((s) => s.key === params?.scenario) ?? SCENARIOS[0];
    const seq = useProtoSequence(scenario, runId);
    if (!params) return null;

    const variant =
        VARIANTS.find((v) => v.key === params.variant) ?? VARIANTS[0];
    const reduceMotion = params.rm || sysReduce;
    const change = (p: ProtoParams) => {
        writeProtoParams(p);
        setParams(p);
        setRunId((n) => n + 1);
    };
    const showOverlay = seq.phase === "revealing" || seq.phase === "landed";
    return (
        <>
            {showOverlay && (
                <variant.C
                    scenario={scenario}
                    seq={seq}
                    reduceMotion={reduceMotion}
                />
            )}
            {seq.phase === "summary" && (
                <ProtoSummaryToast scenario={scenario} />
            )}
            <PrototypeSwitcher
                variants={VARIANTS}
                params={params}
                onChange={change}
                onReplay={() => setRunId((n) => n + 1)}
                seq={seq}
            />
        </>
    );
}
