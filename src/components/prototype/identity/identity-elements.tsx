// PROTOTYPE — throwaway (branch prototype/identity-v4). Board elements in the
// v4 skin: permanent stacks (same-name/same-state clusters), the real
// CardTilt3D glare + 3D tilt, an adaptive-zone demo (card size shrinks so the
// whole zone always fits), counters, attachments, plaque states, piles.
import { useState } from "react";
import CardTilt3D from "~/components/board/card-tilt-3d";
import { getImageUrl } from "~/lib/images";
import { Pile, Plaque } from "./identity-atoms";
import { AVATARS, ID } from "./identity-fixture";

function Card({
    id,
    tapped,
    w,
    children,
    tilt = true,
    cls = "",
}: {
    id: string;
    tapped?: boolean;
    w?: string;
    children?: React.ReactNode;
    tilt?: boolean;
    cls?: string;
}) {
    const face = (
        <div
            className={`px-c ${tapped ? "tapped" : ""} ${cls}`}
            style={w ? { ["--cw" as string]: w } : undefined}
        >
            <img src={getImageUrl(id)} alt="" />
            {children}
        </div>
    );
    return tilt ? (
        <CardTilt3D visualRotationDeg={tapped ? 90 : 0}>{face}</CardTilt3D>
    ) : (
        face
    );
}

export default function IdentityElements() {
    const [n, setN] = useState(6);
    const [zoneW, setZoneW] = useState(720);
    const lands = [
        ID.mountain,
        ID.mountain,
        ID.mountain,
        ID.foothills,
        ID.wasteland,
        ID.mountain,
        ID.mountain,
        ID.volcanic,
        ID.mountain,
        ID.foothills,
        ID.mountain,
        ID.mountain,
        ID.wasteland,
        ID.mountain,
    ];
    return (
        <div className="px-gallery">
            <section className="px-stagebox">
                <div className="px-stagehead">
                    <span className="p-eyebrow strong">
                        Permanent stacks · same name + same state
                    </span>
                    <span className="p-faint" style={{ fontSize: 11 }}>
                        battlefield-stacks.ts grouping preserved · count badge ·
                        untapped then tapped
                    </span>
                </div>
                <div className="px-stagebody px-board-bg">
                    <div className="px-zone-row">
                        <div className="px-stack" data-count={3}>
                            <Card id={ID.mountain} w="104px" />
                            <Card id={ID.mountain} w="104px" />
                            <Card id={ID.mountain} w="104px" />
                            <span className="px-count">×3</span>
                        </div>
                        <div className="px-stack tapped" data-count={2}>
                            <Card id={ID.mountain} w="104px" tapped />
                            <Card id={ID.mountain} w="104px" tapped />
                            <span className="px-count">×2</span>
                        </div>
                        <Card id={ID.foothills} w="104px" />
                        <div className="px-stack" data-count={2}>
                            <Card id={ID.jackalPup} w="104px" />
                            <Card id={ID.jackalPup} w="104px" />
                            <span className="px-count">×2</span>
                        </div>
                        <Card id={ID.jackalPup} w="104px" cls="alt">
                            <span className="px-counter">+1/+1 ×2</span>
                        </Card>
                    </div>
                    <p
                        className="p-faint"
                        style={{ fontSize: 11, marginTop: 10 }}
                    >
                        Identical clean permanents fan into one footprint; a
                        counter, an aura or damage breaks the clean state and
                        the card stands alone (right). Hover any card: the real
                        glare + tilt.
                    </p>
                </div>
            </section>

            <section className="px-stagebox">
                <div className="px-stagehead">
                    <span className="p-eyebrow strong">
                        Adaptive zone · everything always visible
                    </span>
                    <span className="p-faint" style={{ fontSize: 11 }}>
                        card width = min(max, (zone − gaps) / n) · no clipping,
                        no scroll inside a zone
                    </span>
                </div>
                <div className="px-stagebody px-board-bg">
                    <div className="px-controls">
                        <label>
                            cards{" "}
                            <input
                                type="range"
                                min={3}
                                max={14}
                                value={n}
                                onChange={(e) => setN(Number(e.target.value))}
                            />{" "}
                            <b>{n}</b>
                        </label>
                        <label>
                            zone width{" "}
                            <input
                                type="range"
                                min={360}
                                max={1200}
                                step={20}
                                value={zoneW}
                                onChange={(e) =>
                                    setZoneW(Number(e.target.value))
                                }
                            />{" "}
                            <b>{zoneW}px</b>
                        </label>
                    </div>
                    <div
                        className="px-adaptive"
                        style={{ width: zoneW, ["--n" as string]: n }}
                    >
                        {lands.slice(0, n).map((id, i) => (
                            <Card
                                key={i}
                                id={id}
                                tilt={false}
                                tapped={i % 3 === 2}
                                cls="fluid"
                            />
                        ))}
                    </div>
                </div>
            </section>

            <section className="px-stagebox">
                <div className="px-stagehead">
                    <span className="p-eyebrow strong">
                        Attachments · counters · states
                    </span>
                    <span className="p-faint" style={{ fontSize: 11 }}>
                        aura/equipment under the host · +1/+1 chip · damage ·
                        summoning sick · attacking · targetable
                    </span>
                </div>
                <div className="px-stagebody px-board-bg">
                    <div className="px-zone-row" style={{ gap: 26 }}>
                        <div className="px-host">
                            <Card id={ID.greaves} w="104px" cls="under" />
                            <Card id={ID.jackalPup} w="104px" />
                        </div>
                        <Card id={ID.moggFanatic} w="104px">
                            <span className="px-counter">+1/+1</span>
                            <span className="px-dmg">1</span>
                        </Card>
                        <Card id={ID.ballLightning} w="104px" cls="sick">
                            <span className="px-sick">⌛</span>
                        </Card>
                        <Card id={ID.jackalPup} w="104px" cls="attacking" />
                        <Card id={ID.serra} w="104px" cls="targetable">
                            <span className="px-tchip">TARGET</span>
                        </Card>
                        <Card id={ID.meddling} w="104px" cls="selected" />
                    </div>
                </div>
            </section>

            <section className="px-stagebox">
                <div className="px-stagehead">
                    <span className="p-eyebrow strong">
                        Plaques · piles · phase strip
                    </span>
                    <span className="p-faint" style={{ fontSize: 11 }}>
                        active / attacked / low life · library, graveyard, exile
                    </span>
                </div>
                <div className="px-stagebody px-board-bg">
                    <div
                        className="px-zone-row"
                        style={{ gap: 18, alignItems: "center" }}
                    >
                        <Plaque
                            name="You"
                            life={20}
                            avatar={AVATARS.you}
                            state="active"
                        />
                        <Plaque
                            name="Jace"
                            life={15}
                            avatar={AVATARS.opp}
                            state="attacked"
                        />
                        <div className="pplq low">
                            <div className="av">
                                <img src={getImageUrl(ID.serra)} alt="" />
                            </div>
                            <div>
                                <div className="nm">Jace</div>
                                <div className="life">3</div>
                            </div>
                        </div>
                        <Pile top={ID.swords} count={3} label="Graveyard" />
                        <Pile top={undefined} count={0} label="Exile" />
                        <div className="ppile">
                            <img src="/img/card-back.webp" alt="Library" />
                            <span className="cnt">49</span>
                        </div>
                        <div className="pp" style={{ padding: 10, width: 240 }}>
                            <div className="p-eyebrow">Turn 6 · Combat</div>
                            <div
                                className="pctrl"
                                style={{ position: "static", width: "auto" }}
                            >
                                <div
                                    className="phase"
                                    style={{ padding: "8px 0 0" }}
                                >
                                    {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                                        <i
                                            key={i}
                                            className={
                                                i < 4
                                                    ? "done"
                                                    : i === 4
                                                      ? "now"
                                                      : ""
                                            }
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}
