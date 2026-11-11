import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadTextFile } from "../downloadTextFile";

afterEach(() => {
    vi.restoreAllMocks();
});

describe("downloadTextFile", () => {
    it("clicks an anchor naming the file over a Blob URL, then revokes it", async () => {
        const blobs: Blob[] = [];
        vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
            blobs.push(blob as Blob);
            return "blob:export";
        });
        const revoke = vi
            .spyOn(URL, "revokeObjectURL")
            .mockImplementation(() => {});
        const clicked: HTMLAnchorElement[] = [];
        vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
            function (this: HTMLAnchorElement) {
                clicked.push(this);
            }
        );

        downloadTextFile("capabilities.json", '{"capabilities":{}}\n');

        expect(clicked).toHaveLength(1);
        expect(clicked[0].download).toBe("capabilities.json");
        expect(clicked[0].href).toBe("blob:export");
        expect(await blobs[0].text()).toBe('{"capabilities":{}}\n');
        expect(revoke).toHaveBeenCalledWith("blob:export");
    });
});
