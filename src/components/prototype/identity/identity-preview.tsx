// PROTOTYPE — throwaway (branch prototype/identity-v4). Card Preview Overlay
// in the v4 skin: the printed card (real CardTilt3D glare/tilt) beside the
// live Oracle panel + the engine view (#2704). Desktop lateral zoom shown as
// a second, compact instance. Cards switch from a small strip.
import { useState } from "react";
import CardTilt3D from "~/components/board/card-tilt-3d";
import { getImageUrl } from "~/lib/images";
import { Mana } from "./identity-atoms";
import IdentityEnginePanel, { engineTree } from "./identity-engine-panel";
import { ID } from "./identity-fixture";

const SAMPLES = [
    ID.bolt,
    ID.serra,
    ID.ftk,
    ID.cursedScroll,
    ID.jackalPup,
    ID.meddling,
    ID.fof,
];

export default function IdentityPreview() {
    const [cur, setCur] = useState(SAMPLES[0]);
    const t = engineTree(cur);
    return (
        <div className="px-stage">
            <div className="px-strip">
                {SAMPLES.map((id) => (
                    <button
                        key={id}
                        type="button"
                        className={`px-thumb ${id === cur ? "on" : ""}`}
                        onClick={() => setCur(id)}
                    >
                        <img src={getImageUrl(id)} alt="" />
                    </button>
                ))}
                <span
                    className="p-faint"
                    style={{ fontSize: 11, marginLeft: 10 }}
                >
                    hover the card: real CardTilt3D glare + tilt · Esc / tap
                    backdrop closes
                </span>
            </div>

            {/* full overlay */}
            <div className="px-overlay">
                <div className="px-card">
                    <CardTilt3D>
                        <img src={getImageUrl(cur)} alt={t?.name ?? ""} />
                    </CardTilt3D>
                </div>
                <div className="pp px-text">
                    <div className="px-text-head">
                        <div>
                            <div className="px-name">{t?.name ?? "—"}</div>
                            <div className="p-muted" style={{ fontSize: 12.5 }}>
                                {t?.type}
                            </div>
                        </div>
                        {t?.mana.length ? <Mana symbols={t.mana} /> : null}
                    </div>
                    <div className="p-rule" style={{ margin: "10px 0" }} />
                    <div className="p-eyebrow" style={{ marginBottom: 6 }}>
                        Oracle · live
                    </div>
                    <p className="px-oracle">{t?.oracle}</p>
                    <IdentityEnginePanel cardId={cur} />
                    <div className="px-text-foot">
                        <span className="pchip">Esc</span>
                        <span className="p-faint" style={{ fontSize: 11 }}>
                            close · ‹ › step cards in zone
                        </span>
                    </div>
                </div>
            </div>

            {/* desktop lateral zoom, compact */}
            <div className="pp px-lateral">
                <div className="p-eyebrow" style={{ padding: "10px 12px 6px" }}>
                    Lateral zoom (desktop hover)
                </div>
                <div className="px-lateral-body">
                    <img src={getImageUrl(cur)} alt="" />
                    <div>
                        <div className="px-name" style={{ fontSize: 20 }}>
                            {t?.name}
                        </div>
                        <p
                            className="px-oracle"
                            style={{ fontSize: 12.5, marginTop: 4 }}
                        >
                            {t?.oracle}
                        </p>
                        <span
                            className={`pchip ${t?.protocol ? "pending" : "self"}`}
                        >
                            {t?.protocol ? "protocol" : "DSL"}
                        </span>
                        <span
                            className="p-faint"
                            style={{ fontSize: 11, marginLeft: 8 }}
                        >
                            Alt: engine view
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}
