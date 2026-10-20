"use client";

import { Upload, type DetailedError } from "tus-js-client";

/**
 * Browser upload straight to Supabase Storage with a one-time signed token
 * (never through an app server route, so Vercel's request size limit never
 * applies). Large files use the resumable TUS protocol (6 MB chunks,
 * automatic retries, resumable after a dropped connection); if the
 * resumable endpoint refuses the signed token, a single signed PUT is used
 * instead, with progress. Both can be cancelled.
 */
export type UploadTarget = {
  supabaseUrl: string;
  publishableKey: string;
  bucket: string;
  path: string;
  token: string;
  contentType: string;
};

export type UploadHandle = { promise: Promise<void>; cancel: () => void };

export class UploadError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

const CHUNK = 6 * 1024 * 1024;

function friendly(status: number | undefined): UploadError {
  if (status === 413) return new UploadError("The file is larger than storage accepts.", false);
  if (status === 415 || status === 422) return new UploadError("Storage refused this file type.", false);
  if (status === 401 || status === 403) return new UploadError("The upload link expired or isn't allowed. Start the upload again.", false);
  if (status === 409 || status === 400) return new UploadError("This file was already uploaded, or the upload link was used.", false);
  return new UploadError("The connection was interrupted. Retry to continue.", true);
}

function putUpload(t: UploadTarget, file: Blob, onProgress: (sent: number, total: number) => void): UploadHandle {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<void>((resolve, reject) => {
    const url = `${t.supabaseUrl}/storage/v1/object/upload/sign/${t.bucket}/${t.path.split("/").map(encodeURIComponent).join("/")}?token=${encodeURIComponent(t.token)}`;
    xhr.open("PUT", url);
    xhr.setRequestHeader("apikey", t.publishableKey);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("content-type", t.contentType);
    xhr.setRequestHeader("cache-control", "max-age=3600");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded, e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(friendly(xhr.status)));
    xhr.onerror = () => reject(new UploadError("The connection was interrupted. Retry to continue.", true));
    xhr.onabort = () => reject(new UploadError("Upload cancelled.", false));
    xhr.send(file);
  });
  return { promise, cancel: () => xhr.abort() };
}

export function startUpload(t: UploadTarget, file: File, onProgress: (sent: number, total: number) => void): UploadHandle {
  let fallback: UploadHandle | null = null;
  let cancelled = false;
  let tus: Upload | null = null;
  const promise = new Promise<void>((resolve, reject) => {
    // Small files: one request is simplest and just as reliable.
    if (file.size <= CHUNK) {
      fallback = putUpload(t, file, onProgress);
      fallback.promise.then(resolve, reject);
      return;
    }
    tus = new Upload(file, {
      endpoint: `${t.supabaseUrl}/storage/v1/upload/resumable/sign`,
      retryDelays: [0, 2000, 5000, 10000, 20000],
      chunkSize: CHUNK,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      headers: { apikey: t.publishableKey, "x-signature": t.token, "x-upsert": "false" },
      metadata: { bucketName: t.bucket, objectName: t.path, contentType: t.contentType, cacheControl: "3600" },
      onProgress: (sent, total) => onProgress(sent, total),
      onSuccess: () => resolve(),
      onError: (err) => {
        if (cancelled) return reject(new UploadError("Upload cancelled.", false));
        const status = (err as DetailedError).originalResponse?.getStatus();
        // The resumable endpoint didn't accept the signed token: fall back.
        if (status === 404 || status === 405 || status === 400) {
          fallback = putUpload(t, file, onProgress);
          fallback.promise.then(resolve, reject);
          return;
        }
        reject(friendly(status));
      },
    });
    tus.findPreviousUploads().then((previous) => {
      if (previous.length) tus!.resumeFromPreviousUpload(previous[0]);
      tus!.start();
    });
  });
  return {
    promise,
    cancel: () => {
      cancelled = true;
      if (tus) void tus.abort(true);
      fallback?.cancel();
    },
  };
}

/** Reads duration and size of audio/video in the browser before upload. */
export function probeMedia(file: File): Promise<{ duration: number | null; width: number | null; height: number | null; playable: boolean }> {
  return new Promise((resolve) => {
    const isVideo = file.type.startsWith("video/") || /\.mp4$/i.test(file.name);
    const el = document.createElement(isVideo ? "video" : "audio") as HTMLVideoElement;
    const url = URL.createObjectURL(file);
    const done = (r: { duration: number | null; width: number | null; height: number | null; playable: boolean }) => {
      URL.revokeObjectURL(url);
      el.removeAttribute("src");
      resolve(r);
    };
    const timer = setTimeout(() => done({ duration: null, width: null, height: null, playable: false }), 15_000);
    el.preload = "metadata";
    el.muted = true;
    el.onloadedmetadata = () => {
      clearTimeout(timer);
      const d = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null;
      const w = isVideo ? el.videoWidth || null : null;
      const h = isVideo ? el.videoHeight || null : null;
      done({ duration: d, width: w, height: h, playable: !isVideo || !!w });
    };
    el.onerror = () => {
      clearTimeout(timer);
      done({ duration: null, width: null, height: null, playable: false });
    };
    el.src = url;
  });
}

/** SHA-256 of a file in the browser (duplicate detection before upload). */
export async function fileHash(file: File): Promise<string | null> {
  if (!crypto?.subtle || file.size > 60 * 1024 * 1024) return null;
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
