// The face resample worker (issue #8321): fetches a printed face's art,
// decodes it, box-filters the `object-fit: cover` crop down to the slot's
// exact device box, and posts the PNG back. Everything off the UI thread —
// the board mounts dozens of faces at once and a 488×680 decode plus a
// ~5 ms filter each would otherwise land on the main thread together.
//
// A Worker ENTRY POINT: nothing here is imported by the page. The protocol is
// `FaceResampleRequest` in, `FaceResampleReply` out, by `id`; a request that
// fails for any reason replies `{ id, blob: null }` — the client falls back to
// the srcset path and nothing is left pending.
import { boxDownscale, coverWindow } from "./boxDownscale";

export interface FaceResampleRequest {
    id: number;
    artUrl: string;
    w: number;
    h: number;
}

export interface FaceResampleReply {
    id: number;
    blob: Blob | null;
}

async function resample(req: FaceResampleRequest): Promise<Blob | null> {
    try {
        const res = await fetch(req.artUrl, {
            mode: "cors",
            credentials: "omit",
        });
        if (!res.ok) return null;
        const decoded = await createImageBitmap(await res.blob());
        try {
            const nw = decoded.width;
            const nh = decoded.height;
            if (nw < req.w || nh < req.h) return null; // upscaling is not this path's
            const full = new OffscreenCanvas(nw, nh);
            const fullCtx = full.getContext("2d", { willReadFrequently: true });
            if (!fullCtx) return null;
            fullCtx.drawImage(decoded, 0, 0);
            const pixels = fullCtx.getImageData(0, 0, nw, nh).data;
            const out = boxDownscale(
                pixels,
                nw,
                nh,
                coverWindow(nw, nh, req.w, req.h),
                req.w,
                req.h
            );
            const small = new OffscreenCanvas(req.w, req.h);
            const smallCtx = small.getContext("2d");
            if (!smallCtx) return null;
            const image = smallCtx.createImageData(req.w, req.h);
            image.data.set(out);
            smallCtx.putImageData(image, 0, 0);
            return await small.convertToBlob({ type: "image/png" });
        } finally {
            decoded.close();
        }
    } catch {
        return null;
    }
}

self.onmessage = (e: MessageEvent<FaceResampleRequest>) => {
    const req = e.data;
    void resample(req).then((blob) => {
        const reply: FaceResampleReply = { id: req.id, blob };
        self.postMessage(reply);
    });
};
