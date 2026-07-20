// WCAG contrast helpers (relative luminance, WCAG 2.x) for the design-system
// census page — ratios shown on the page are computed live from these.

export function hexLuminance(hex: string): number {
    const c = hex.replace("#", "");
    const [r, g, b] = [0, 2, 4].map((i) => {
        const v = parseInt(c.slice(i, i + 2), 16) / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
    const [hi, lo] = [hexLuminance(a), hexLuminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}
