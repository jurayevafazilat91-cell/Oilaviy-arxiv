declare module "heic-decode" {
  function decode(input: { buffer: ArrayBufferLike | Uint8Array }): Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
  export default decode;
}
