// The rounding rule for an exact assertion on points that went through float
// arithmetic, and the scanner that refuses the assertion without it.
//
// A value derived by subtracting two valuations carries noise that depends on the
// weights, so `toBe` on it can flip on any refit.
//
// The rule rounds the DIFFERENCE of the two sides to 9 decimals and requires 0.
// Rounding each side instead would not hold: two twins a noise apart can straddle
// a rounding boundary, whatever the precision, and a price with a denominator of
// 3 or 11 has no grid to keep it off one. The difference has no boundary near it:
// noise is about 1e-13 at these magnitudes, 5e-10 away from rounding to anything
// but 0, and a real change is at least a fitted weight's last digit, 1e-6.

import { expect } from "vitest";
import ts from "typescript";

const POINTS_DECIMALS_FACTOR = 1e9;

/** Rounds to the rule's 9 decimals; `+ 0` turns a rounded -0 into 0. */
export function roundPoints(points: number): number {
    return (
        Math.round(points * POINTS_DECIMALS_FACTOR) / POINTS_DECIMALS_FACTOR + 0
    );
}

export function expectSamePoints(actual: number, expected: number): void {
    expect(
        roundPoints(actual - expected),
        `${actual} is not ${expected} at 9 decimals`
    ).toBe(0);
}

const POINTS_READ = ".points";

function isExactAssertionOnPoints(node: ts.CallExpression): boolean {
    const callee = node.expression;
    if (!ts.isPropertyAccessExpression(callee)) return false;
    if (callee.name.text !== "toBe") return false;
    return callee.expression.getText().includes(POINTS_READ);
}

/**
 * 1-indexed lines of the `toBe` assertions on points in a file that subtracts two
 * `.points`: there an exact assertion may be reading the noisy difference, so the
 * file asserts through `expectSamePoints`. Parsed, not matched, so a wrapped line,
 * an optional chain or a call on either side reads the same.
 */
export function findExactPointsAssertions(
    fileName: string,
    source: string
): number[] {
    if (!source.includes(POINTS_READ)) return [];
    const file = ts.createSourceFile(
        fileName,
        source,
        ts.ScriptTarget.Latest,
        true
    );
    let subtracts = false;
    const exact: number[] = [];
    const visit = (node: ts.Node): void => {
        if (
            ts.isBinaryExpression(node) &&
            node.operatorToken.kind === ts.SyntaxKind.MinusToken &&
            node.left.getText().includes(POINTS_READ) &&
            node.right.getText().includes(POINTS_READ)
        )
            subtracts = true;
        if (ts.isCallExpression(node) && isExactAssertionOnPoints(node))
            exact.push(
                file.getLineAndCharacterOfPosition(node.getStart()).line + 1
            );
        ts.forEachChild(node, visit);
    };
    visit(file);
    return subtracts ? exact : [];
}
