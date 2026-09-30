import {
  concat,
  encodeAbiParameters,
  getCreate2Address,
  keccak256,
  pad,
  type Address,
  type Hex,
} from "viem";

/** Deposit Wallet factory. Docs: resources/contracts. */
export const DEPOSIT_FACTORY = "0x00000000000Fb5C9ADea0298D729A0CB3823Cc07" as const;
/** Beacon proxy used for wallets deployed after 2026-06-29. */
export const DEPOSIT_BEACON = "0x7A18EDfe055488A3128f01F563e5B479D92ffc3a" as const;

const TAIL_A = "0x60195155f3363d3d373d3d363d602036600436635c60da" as Hex;
const TAIL_B = "0x1b60e01b36527fa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6c" as Hex;
const TAIL_C = "0xb3582b35133d50545afa5036515af43d6000803e604d573d6000fd5b3d6000f3" as Hex;

function initCode(args: Hex): Hex {
  const n = (args.length - 2) / 2;
  const size = (0x52 + n).toString(16).padStart(4, "0");
  const prefix = `0x61${size}3d8160233d3973` as Hex;
  return concat([prefix, DEPOSIT_BEACON, TAIL_A, TAIL_B, TAIL_C, args]);
}

/** Beacon-proxy CREATE2 address. Same formula as the Polymarket docs. */
export function deriveDepositWallet(signer: string): Address | null {
  if (!/^0x[0-9a-fA-F]{40}$/.test(signer)) return null;
  const owner = signer as Address;
  const args = encodeAbiParameters(
    [
      { type: "address" },
      { type: "bytes32" },
    ],
    [DEPOSIT_FACTORY, pad(owner, { size: 32 })],
  );
  const salt = keccak256(args);
  return getCreate2Address({
    from: DEPOSIT_FACTORY,
    salt,
    bytecodeHash: keccak256(initCode(args)),
  });
}
