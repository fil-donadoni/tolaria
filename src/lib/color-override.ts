export type ColorOverrideDisplay = {
    name: string;
    solid: string;
    inner: string;
};

const SINGLE_COLOR: Record<string, ColorOverrideDisplay> = {
    W: { name: "White", solid: "#f0e6b8", inner: "rgba(240,230,184,0.60)" },
    U: { name: "Blue", solid: "#0a6faa", inner: "rgba(10,111,170,0.55)" },
    B: { name: "Black", solid: "#5c3d6e", inner: "rgba(92,61,110,0.60)" },
    R: { name: "Red", solid: "#c83c2e", inner: "rgba(200,60,46,0.55)" },
    G: { name: "Green", solid: "#1a734a", inner: "rgba(26,115,74,0.55)" },
};

const MULTICOLOR: ColorOverrideDisplay = {
    name: "Multicolor",
    solid: "#c9a84c",
    inner: "rgba(201,168,76,0.55)",
};

export function getColorOverrideDisplay(
    codes: string[]
): ColorOverrideDisplay | null {
    if (!codes || codes.length === 0) return null;
    if (codes.length === 1) return SINGLE_COLOR[codes[0]] ?? null;
    return {
        ...MULTICOLOR,
        name: codes.map((c) => SINGLE_COLOR[c]?.name ?? c).join(" / "),
    };
}
