// heic-decode ships no types. Only the API used by src/lib/media/images.ts.
declare module "heic-decode" {
  type Decoded = { width: number; height: number; data: Uint8ClampedArray };
  type Image = { width: number; height: number; decode: () => Promise<Decoded> };
  function decode(options: { buffer: ArrayBufferLike | Uint8Array }): Promise<Decoded>;
  namespace decode {
    function all(options: { buffer: ArrayBufferLike | Uint8Array }): Promise<Image[] & { dispose: () => void }>;
  }
  export default decode;
}
