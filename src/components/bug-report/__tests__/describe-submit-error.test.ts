import { describe, it, expect } from "vitest";
import { ConvexError } from "convex/values";
import { describeSubmitError } from "../describe-submit-error";

// Convex masks the message of a plain `Error` thrown server-side in production
// ("Server Error" + request id); only a `ConvexError` payload survives the
// wire. These cases pin the extraction order the dialog relies on.
describe("describeSubmitError", () => {
    it("reads the string payload of a ConvexError", () => {
        expect(
            describeSubmitError(
                new ConvexError(
                    "Bug reporting is not configured (missing GITHUB_TOKEN)"
                )
            )
        ).toBe("Bug reporting is not configured (missing GITHUB_TOKEN)");
    });

    it("reads a { message } object payload", () => {
        expect(
            describeSubmitError(new ConvexError({ message: "GitHub 403" }))
        ).toBe("GitHub 403");
    });

    it("falls back to a plain Error message (client-side failures)", () => {
        expect(
            describeSubmitError(new Error("File too large (max 5 MB)"))
        ).toBe("File too large (max 5 MB)");
    });

    it("falls back to a generic message for a non-Error throw", () => {
        expect(describeSubmitError("boom")).toBe("Something went wrong");
        expect(describeSubmitError(new Error("   "))).toBe(
            "Something went wrong"
        );
    });
});
