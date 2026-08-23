// PROTOTYPE — throwaway (branch prototype/identity-v4). Full board fixture:
// opponent half (hand backs, lands, permanents), combat line, own half, hand
// fan, plaques, piles, stack panel (2 items), targeting prompt, controller.
// perm=crop renders art-crop tiles with a colour band; perm=card full cards.
import { getImageUrl } from "~/lib/images";
import { CARD_BACK, Mana, Perm, Pile, Plaque } from "./identity-atoms";
import {
    AVATARS,
    GRAVEYARD_TOP,
    HAND,
    ID,
    OPP_LANDS,
    OPP_PERMS,
    OWN_LANDS,
    OWN_PERMS,
    STACK,
} from "./identity-fixture";
import type { Perm as PermMode } from "./identity-theme";

const PHASES = ["Untap", "Upkeep", "Draw", "Main 1", "Combat", "Main 2", "End"];
const NOW = 4; // Combat

export default function IdentityBoard({ perm }: { perm: PermMode }) {
    const handN = HAND.length;
    return (
        <div className="pbd">
            {/* top row: opponent hand + plaque + piles */}
            <div className="pbd-row">
                <div className="phand-opp">
                    {Array.from({ length: 6 }).map((_, i) => {
                        const rot = (i - 2.5) * 4;
                        return (
                            <div
                                key={i}
                                className="hb"
                                style={{
                                    ["--rot" as string]: `${rot}deg`,
                                    ["--ty" as string]: `${Math.abs(i - 2.5) * 2}px`,
                                }}
                            >
                                <img src={CARD_BACK} alt="" />
                            </div>
                        );
                    })}
                </div>
            </div>
            <div className="pbd-corner tl">
                <Plaque
                    name="Jace"
                    life={15}
                    avatar={AVATARS.opp}
                    state="attacked"
                />
            </div>
            <div className="pbd-corner tr">
                <Pile top={ID.brainstorm} count={2} label="Graveyard" />
                <Pile top={undefined} count={0} label="Exile" />
                <div className="ppile" title="Library (52)">
                    <img src={CARD_BACK} alt="Library" />
                    <span className="cnt">52</span>
                </div>
            </div>

            {/* opponent half */}
            <div className="pbd-half opp">
                <div
                    className="pbd-zone center"
                    style={{ ["--n" as string]: OPP_LANDS.length }}
                >
                    {OPP_LANDS.map((c, i) => (
                        <Perm key={`${c.name}-${i}`} card={c} mode={perm} />
                    ))}
                </div>
                <div
                    className="pbd-zone center"
                    style={{ ["--n" as string]: OPP_PERMS.length }}
                >
                    {OPP_PERMS.map((c, i) => (
                        <Perm key={`${c.name}-${i}`} card={c} mode={perm} />
                    ))}
                </div>
            </div>

            <div className="pbd-mid combat" />

            {/* own half */}
            <div className="pbd-half">
                <div
                    className="pbd-zone center"
                    style={{ ["--n" as string]: OWN_PERMS.length }}
                >
                    {OWN_PERMS.map((c, i) => (
                        <Perm key={`${c.name}-${i}`} card={c} mode={perm} />
                    ))}
                </div>
                <div
                    className="pbd-zone center"
                    style={{ ["--n" as string]: OWN_LANDS.length }}
                >
                    {OWN_LANDS.map((c, i) => (
                        <Perm key={`${c.name}-${i}`} card={c} mode={perm} />
                    ))}
                </div>
            </div>

            {/* hand */}
            <div className="phand">
                {HAND.map((c, i) => {
                    const rot = (i - (handN - 1) / 2) * 3.2;
                    const ty = Math.abs(i - (handN - 1) / 2) * 4;
                    return (
                        <div
                            key={`${c.name}-${i}`}
                            className={`hc ${c.playable ? "playable" : ""}`}
                            style={{
                                ["--rot" as string]: `${rot}deg`,
                                ["--ty" as string]: `${ty}px`,
                            }}
                            title={c.name}
                        >
                            <img src={getImageUrl(c.id)} alt={c.name} />
                        </div>
                    );
                })}
            </div>

            {/* own plaque + piles */}
            <div className="pbd-corner bl">
                <Plaque
                    name="You"
                    life={20}
                    avatar={AVATARS.you}
                    state="active"
                />
                <Pile top={GRAVEYARD_TOP} count={3} label="Graveyard" />
                <div className="ppile" title="Library (49)">
                    <img src={CARD_BACK} alt="Library" />
                    <span className="cnt">49</span>
                </div>
            </div>

            {/* targeting prompt */}
            <div className="pp pprompt">
                <div>
                    <div className="t">Lightning Bolt</div>
                    <div className="d">Choose any target · 3 damage</div>
                </div>
                <span className="pchip target">2 legal</span>
                <button
                    type="button"
                    className="pb ghost"
                    style={{ height: 32 }}
                >
                    Cancel
                </button>
            </div>

            {/* stack */}
            <div className="pp pstack">
                <div className="pp-head" style={{ padding: "10px 12px 8px" }}>
                    <span className="p-eyebrow strong">Stack</span>
                    <span className="pchip solid">{STACK.length}</span>
                </div>
                <div className="p-rule" style={{ margin: "0 12px" }} />
                {STACK.map((s, i) => (
                    <div
                        key={s.card.name}
                        className={`pstack-item ${i === 0 ? "top" : ""}`}
                    >
                        <img src={getImageUrl(s.card.id)} alt={s.card.name} />
                        <div>
                            <div className="n">{s.card.name}</div>
                            <div className="s">{s.note}</div>
                            <div
                                style={{
                                    marginTop: 6,
                                    display: "flex",
                                    gap: 6,
                                    alignItems: "center",
                                }}
                            >
                                <span
                                    className={`pchip ${s.owner === "you" ? "self" : "opp"}`}
                                >
                                    {s.owner === "you" ? "You" : "Jace"}
                                </span>
                                {s.card.cost ? (
                                    <Mana symbols={s.card.cost} />
                                ) : null}
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* phone-only: actions row + bottom bar (hidden on desktop) */}
            <div className="pbd-actions">
                <button
                    type="button"
                    className="pb primary"
                    style={{ flex: 1, height: 48 }}
                >
                    Pass priority
                </button>
                <button
                    type="button"
                    className="pb"
                    style={{ height: 48, padding: "0 14px" }}
                    aria-label="Pass turn"
                >
                    ⏭
                </button>
                <button
                    type="button"
                    className="pb ghost"
                    style={{ height: 48, padding: "0 12px" }}
                    aria-label="Full control"
                >
                    ⚑
                </button>
            </div>
            <div className="pbd-mobilebar">
                <div className="life">
                    <b>20</b>
                    <span className="p-eyebrow">vs 15</span>
                </div>
                <div className="piles">
                    <span className="pchip solid">GY 3</span>
                    <span className="pchip solid">LIB 49</span>
                    <span className="pchip solid">EXL 0</span>
                </div>
                <div className="phase">
                    <b>Combat</b>
                    <span className="p-eyebrow">T6 · your priority</span>
                </div>
                <button type="button" className="pmenu" aria-label="Menu">
                    ≡
                </button>
            </div>

            {/* controller */}
            <div className="pctrl">
                <div className="pp">
                    <div className="turn">
                        <div>
                            <div className="p-eyebrow">Turn 6</div>
                            <b>Combat</b>
                        </div>
                        <span className="pchip self">Your priority</span>
                    </div>
                    <div className="phase" aria-label="Phases">
                        {PHASES.map((p, i) => (
                            <i
                                key={p}
                                className={
                                    i < NOW ? "done" : i === NOW ? "now" : ""
                                }
                                title={p}
                            />
                        ))}
                    </div>
                    <div className="acts">
                        <button type="button" className="pb primary">
                            Pass priority
                        </button>
                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "1fr 1fr",
                                gap: 6,
                            }}
                        >
                            <button type="button" className="pb">
                                Pass turn
                            </button>
                            <button type="button" className="pb ghost">
                                Full ctrl
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
