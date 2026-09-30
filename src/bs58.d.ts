declare module "bs58" {
  const bs58: { encode: (bytes: Uint8Array) => string };
  export default bs58;
}
