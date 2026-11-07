// PROTOTYPE — throwaway. Shared derived data for the Card Profiles / Pick
// Ratings page variants (`/prototype`, UI branch, "draft bot" grill 2026-11-07).
//
// Plan: three variants of BOTH admin pages, switchable via `?variant=`, on
// the existing `/admin/card-profiles` and `/admin/pick-ratings` routes.
// Real data through the real hooks; every write is a local stub.
import { tryGetDefinition } from "@convex/cards";
import { getCardColorIdentity } from "@convex/cards/colors";
import type { Color, ManaCost } from "@convex/cards/types";
import { ARCHETYPE_REGISTRY } from "@convex/limited/archetypeRegistry";
import { CAPABILITY_REGISTRY } from "@convex/limited/capabilityRegistry";
import { manaValue } from "@convex/gre/constants";
import type { ScopeCardProfile } from "~/hooks/useCardProfiles";
import type { ScopeCardRating } from "~/hooks/useCardRatings";

export const WUBRG: readonly Color[] = ["W", "U", "B", "R", "G"];

/** Proto-only swatches (the design system has no mana-colour tokens yet —
 *  a real implementation adds them to `index.css` first). */
export const COLOR_SWATCH: Record<Color, string> = {
    W: "#e8e3c9",
    U: "#6f9fcf",
    B: "#6b5f78",
    R: "#d1725a",
    G: "#6fa05a",
    C: "#8a8a8a",
};

export type ProfileStatus = "reviewed" | "override" | "proposed" | "unprofiled";

export interface ProtoProfile {
    archetypes: string[];
    provides: string[];
    requires: string[];
    reviewed: boolean;
}

export interface ProtoCard {
    cardId: string;
    name: string;
    colors: Color[];
    manaValue: number;
    costSymbols: string[];
    rarity: string;
    typeLine: string;
    profile: ProtoProfile | null;
    status: ProfileStatus;
    /** The census's one-line reason (stub: no such field exists yet). */
    rationale: string | null;
}

export function costSymbols(cost: ManaCost | undefined): string[] {
    if (!cost) return [];
    const out: string[] = [];
    if (cost.X !== undefined)
        out.push(typeof cost.X === "string" ? "X" : String(cost.X));
    if (cost.generic) out.push(String(cost.generic));
    for (const c of ["C", "W", "U", "B", "R", "G"] as const) {
        const n = cost[c] ?? 0;
        for (let i = 0; i < n; i++) out.push(c);
    }
    return out;
}

function stubRationale(name: string, p: ProtoProfile | null): string | null {
    if (!p) return null;
    const bits: string[] = [];
    if (p.archetypes.length)
        bits.push(`cube lists tag it ${p.archetypes.join("/")}`);
    if (p.provides.length) bits.push(`offers ${p.provides.join(", ")}`);
    if (p.requires.length) bits.push(`needs ${p.requires.join(", ")}`);
    if (bits.length === 0) return `${name}: no synergy role found in reviews`;
    return `${bits.join("; ")} — per Vintage Cube set reviews (stub)`;
}

export function toProtoCard(card: ScopeCardProfile): ProtoCard {
    const def = tryGetDefinition(card.cardId);
    const effective = card.dbProfile ?? card.seedProfile;
    const profile: ProtoProfile | null = effective
        ? {
              archetypes: effective.archetypes,
              provides: effective.provides,
              requires: effective.requires,
              reviewed: effective.reviewed,
          }
        : null;
    const status: ProfileStatus =
        profile === null
            ? "unprofiled"
            : profile.reviewed
              ? "reviewed"
              : card.dbProfile
                ? "override"
                : "proposed";
    return {
        cardId: card.cardId,
        name: card.name,
        colors: def ? getCardColorIdentity(def) : [],
        manaValue: def ? manaValue(def.manaCost) : 0,
        costSymbols: costSymbols(def?.manaCost),
        rarity: def?.rarity ?? "—",
        typeLine: def
            ? [...(def.supertypes ?? []), ...def.types].join(" ") +
              (def.subtypes?.length ? ` — ${def.subtypes.join(" ")}` : "")
            : "",
        profile,
        status,
        rationale: stubRationale(card.name, profile),
    };
}

export interface ProtoRatingCard {
    cardId: string;
    name: string;
    colors: Color[];
    manaValue: number;
    costSymbols: string[];
    rarity: string;
    /** Effective rating, the reader's layering: DB → seed → scope median. */
    rating: number | null;
    source: "override" | "seed" | "fallback" | "unrated";
    seedRating: number | null;
    /** The scope's median hand rating (issue #7652): what an unrated card gets. */
    fallbackRating: number;
    typeLine: string;
    types: string[];
    /** From the scope's Card Profiles, empty where the scope has none. */
    archetypes: string[];
}

export function toProtoRatingCard(card: ScopeCardRating): ProtoRatingCard {
    const def = tryGetDefinition(card.cardId);
    return {
        cardId: card.cardId,
        name: card.name,
        colors: def ? getCardColorIdentity(def) : [],
        manaValue: def ? manaValue(def.manaCost) : 0,
        costSymbols: costSymbols(def?.manaCost),
        rarity: def?.rarity ?? "—",
        rating: card.dbRating ?? card.seedRating ?? card.fallbackRating,
        source:
            card.dbRating !== null
                ? "override"
                : card.seedRating !== null
                  ? "seed"
                  : "fallback",
        seedRating: card.seedRating,
        fallbackRating: card.fallbackRating,
        typeLine: def
            ? [...(def.supertypes ?? []), ...def.types].join(" ") +
              (def.subtypes?.length ? ` — ${def.subtypes.join(" ")}` : "")
            : "",
        types: def ? [...def.types] : [],
        archetypes: [],
    };
}

/** Colour signature of a set of cards: share of coloured cards per colour,
 *  a multicolour card counting partly toward each (the Draft Signal rule). */
export function colourSignature(
    cards: readonly { colors: Color[] }[]
): Record<Color, number> {
    const out: Record<Color, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    let total = 0;
    for (const c of cards) {
        const cols = c.colors.filter((col) => col !== "C");
        if (cols.length === 0) continue;
        for (const col of cols) out[col] += 1 / cols.length;
        total++;
    }
    if (total > 0) for (const col of WUBRG) out[col] /= total;
    return out;
}

export type RowKind = "archetype" | "provides" | "requires";

export interface CatalogueRow {
    kind: RowKind;
    id: string;
    description: string;
    tagged: number;
    proposed: number;
    reviewed: number;
    signature: Record<Color, number>;
}

export function fieldOf(kind: RowKind): "archetypes" | "provides" | "requires" {
    return kind === "archetype" ? "archetypes" : kind;
}

function cardsCarrying(cards: readonly ProtoCard[], kind: RowKind, id: string) {
    return cards.filter((c) => c.profile?.[fieldOf(kind)].includes(id));
}

export function catalogueRows(cards: readonly ProtoCard[]): CatalogueRow[] {
    const rows: CatalogueRow[] = [];
    const push = (kind: RowKind, id: string, description: string) => {
        const carrying = cardsCarrying(cards, kind, id);
        rows.push({
            kind,
            id,
            description,
            tagged: carrying.length,
            proposed: carrying.filter((c) => c.status === "proposed").length,
            reviewed: carrying.filter((c) => c.status === "reviewed").length,
            signature: colourSignature(carrying),
        });
    };
    for (const r of ARCHETYPE_REGISTRY) push("archetype", r.id, r.description);
    for (const r of CAPABILITY_REGISTRY) push("provides", r.id, r.description);
    for (const r of CAPABILITY_REGISTRY) push("requires", r.id, r.description);
    return rows;
}

export function splitDescription(d: string): { when: string; not: string } {
    const i = d.indexOf("NOT:");
    if (i === -1) return { when: d, not: "" };
    return {
        when: d
            .slice(0, i)
            .replace(/^TAG WHEN:\s*/, "")
            .trim(),
        not: d.slice(i + 4).trim(),
    };
}

export const STATUS_LABEL: Record<ProfileStatus, string> = {
    reviewed: "Reviewed",
    override: "Edited, unreviewed",
    proposed: "Census proposal",
    unprofiled: "No profile",
};
