const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;

  let n = 0n;
  for (let i = zeros; i < bytes.length; i += 1) {
    n = n * 256n + BigInt(bytes[i] ?? 0);
  }

  let out = "";
  while (n > 0n) {
    const rem = Number(n % 58n);
    out = ALPHABET[rem] + out;
    n /= 58n;
  }
  return "1".repeat(zeros) + out;
}

export function decodeBase58(text: string): Uint8Array {
  const clean = text.trim();
  if (!clean || [...clean].some((ch) => !ALPHABET.includes(ch))) {
    throw new Error("Секрет не читається");
  }
  let zeros = 0;
  while (zeros < clean.length && clean[zeros] === "1") zeros += 1;
  let n = 0n;
  for (let i = zeros; i < clean.length; i += 1) {
    n = n * 58n + BigInt(ALPHABET.indexOf(clean[i] ?? ""));
  }
  const body: number[] = [];
  while (n > 0n) {
    body.push(Number(n % 256n));
    n /= 256n;
  }
  const out = new Uint8Array(zeros + body.length);
  for (let i = 0; i < body.length; i += 1) out[out.length - 1 - i] = body[i] ?? 0;
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function randomPubkey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return encodeBase58(bytes);
}
