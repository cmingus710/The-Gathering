/** Cover uploads go through a Server Action; Vercel refuses request bodies over 4.5 MB. */
export const MAX_COVER_BYTES = 4 * 1024 * 1024;
