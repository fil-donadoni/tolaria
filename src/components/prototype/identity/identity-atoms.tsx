// PROTOTYPE — throwaway (branch prototype/identity-v4). Small shared atoms for
// the two surfaces. Multiple components per file on purpose: prototype code.
/* eslint-disable react-refresh/only-export-components */
import { getArtCropImageUrl, getImageUrl } from "~/lib/images";
import type { FixtureCard, FixtureColor } from "./identity-fixture";

export const BAND: Record<FixtureColor, string> = {
    W: "#e9e3c8",
    U: "#3d6fa8",
    B: "#5a4f66",
    R: "#b0412e",
    G: "#3c7a44",
    C: "#8f8a80",
    L: "#6b6458",
    M: "#b08d3a",
};

export function Crop({
    id,
    className,
    shade = true,
    alt = "",
}: {
    id: string;
    className?: string;
    shade?: boolean;
    alt?: string;
}) {
    return (
        <div className={`pcrop ${className ?? ""}`}>
            <img src={getArtCropImageUrl(id)} alt={alt} loading="lazy" />
            {shade ? <div className="shade" /> : null}
        </div>
    );
}

export function Mana({ symbols }: { symbols: string[] }) {
    return (
        <span className="p-mana">
            {symbols.map((s, i) => (
                <img
                    key={`${s}-${i}`}
                    src={`/img/symbols/${s.toUpperCase()}.svg`}
                    alt={`{${s}}`}
                />
            ))}
        </span>
    );
}

export function Pips({ colors }: { colors: FixtureColor[] }) {
    const syms = colors.flatMap((c) =>
        c === "M"
            ? ["W", "U", "B", "R", "G"]
            : c === "L" || c === "C"
              ? []
              : [c]
    );
    return <Mana symbols={syms} />;
}

export function Perm({
    card,
    mode,
}: {
    card: FixtureCard;
    mode: "crop" | "card";
}) {
    const cls = [
        "pperm",
        mode === "card" ? "card" : "",
        card.tapped ? "tapped" : "",
        card.sick ? "sick" : "",
        card.attacking ? "attacking" : "",
        card.targetable ? "targetable" : "",
    ]
        .filter(Boolean)
        .join(" ");
    return (
        <div
            className={cls}
            style={{ ["--band" as string]: BAND[card.color] }}
            title={card.name}
        >
            <div className="face">
                <img
                    src={
                        mode === "card"
                            ? getImageUrl(card.id)
                            : getArtCropImageUrl(card.id)
                    }
                    alt={card.name}
                    loading="lazy"
                />
                {mode === "crop" ? (
                    <div className="band">{card.name}</div>
                ) : null}
                {card.tapped ? <div className="tapicon">⟳</div> : null}
            </div>
            {card.pt ? <div className="pt">{card.pt}</div> : null}
            {card.targetable ? <div className="tchip">TARGET</div> : null}
        </div>
    );
}

export function Plaque({
    name,
    life,
    avatar,
    state,
}: {
    name: string;
    life: number;
    avatar: string;
    state?: "active" | "attacked";
}) {
    return (
        <div className={`pplq ${state ?? ""}`}>
            <div className="av">
                <img src={getArtCropImageUrl(avatar)} alt="" />
            </div>
            <div>
                <div className="nm">{name}</div>
                <div className="life">{life}</div>
            </div>
        </div>
    );
}

export function Pile({
    top,
    count,
    label,
}: {
    top?: string;
    count: number;
    label: string;
}) {
    return (
        <div
            className={`ppile ${top ? "" : "empty"}`}
            title={`${label} (${count})`}
        >
            {top ? (
                <img src={getImageUrl(top)} alt={label} loading="lazy" />
            ) : (
                <span>{label.slice(0, 4).toUpperCase()}</span>
            )}
            <span className="cnt">{count}</span>
        </div>
    );
}

export function Ornament({ className }: { className?: string }) {
    return (
        <div className={`p-orn ${className ?? ""}`} aria-hidden>
            <i />
        </div>
    );
}

export const CARD_BACK = "/img/card-back.webp";
