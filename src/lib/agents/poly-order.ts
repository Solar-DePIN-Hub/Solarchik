import {
  concatHex,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  keccak256,
  toHex,
  type Hex,
} from "viem";
import { polygon } from "viem/chains";
import type { PrivateKeyAccount } from "viem/accounts";
import { ensureDepositWallet, submitWalletBatch, walletNonce } from "./deposit";
import { bestAsk, bestBid, readOutcomeApproved, readPolyAllowance } from "./poly";
import type { PolyTicket } from "./poly";
import { loadPolygonAccount } from "./polygon";
import { LIVE_OFF_REASON, liveTradingAllowed } from "./live-trading";

const PUSD = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB" as Hex;
const CTF = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045" as Hex;
const EXCHANGE = "0xE111180000d2663C0091e4f400237545B87B996B" as Hex;
const NEG_EXCHANGE = "0xe2222d279d744050d28e00520010520000310F59" as Hex;
const ADAPTER = "0xAdA100Db00Ca00073811820692005400218FcE1f" as Hex;
const NEG_ADAPTER = "0xadA2005600Dec949baf300f4C6120000bDB6eAab" as Hex;
const ZERO32 = "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;
const RPC = "https://polygon-bor-rpc.publicnode.com";
const MAX_U256 = (1n << 256n) - 1n;

const ORDER_TYPE =
  "Order(uint256 salt,address maker,address signer,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint8 side,uint8 signatureType,uint256 timestamp,bytes32 metadata,bytes32 builder)";
const EIP712_DOMAIN =
  "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)";

const orderTypes = {
  Order: [
    { name: "salt", type: "uint256" },
    { name: "maker", type: "address" },
    { name: "signer", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "makerAmount", type: "uint256" },
    { name: "takerAmount", type: "uint256" },
    { name: "side", type: "uint8" },
    { name: "signatureType", type: "uint8" },
    { name: "timestamp", type: "uint256" },
    { name: "metadata", type: "bytes32" },
    { name: "builder", type: "bytes32" },
  ],
} as const;

const authTypes = {
  ClobAuth: [
    { name: "address", type: "address" },
    { name: "timestamp", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "message", type: "string" },
  ],
} as const;

const typedDataSignTypes = {
  Order: orderTypes.Order,
  TypedDataSign: [
    { name: "contents", type: "Order" },
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
    { name: "salt", type: "bytes32" },
  ],
} as const;

const batchTypes = {
  Call: [
    { name: "target", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
  ],
  Batch: [
    { name: "wallet", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "calls", type: "Call[]" },
  ],
} as const;

const erc20 = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

const erc1155 = [
  {
    type: "function",
    name: "setApprovalForAll",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
] as const;

const redeemAbi = [
  {
    type: "function",
    name: "redeemPositions",
    stateMutability: "nonpayable",
    inputs: [
      { name: "collateralToken", type: "address" },
      { name: "parentCollectionId", type: "bytes32" },
      { name: "conditionId", type: "bytes32" },
      { name: "indexSets", type: "uint256[]" },
    ],
    outputs: [],
  },
] as const;

type OrderMessage = {
  salt: bigint;
  maker: Hex;
  signer: Hex;
  tokenId: bigint;
  makerAmount: bigint;
  takerAmount: bigint;
  side: number;
  signatureType: number;
  timestamp: bigint;
  metadata: Hex;
  builder: Hex;
};

type WalletCall = { target: Hex; value: bigint; data: Hex };
type Creds = { key: string; secret: string; passphrase: string };

function b64url(bytes: ArrayBuffer): string {
  const raw = new Uint8Array(bytes);
  let s = "";
  raw.forEach((b) => {
    s += String.fromCharCode(b);
  });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_");
}

function b64ToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function clobDirect(
  method: string,
  path: string,
  headers: Record<string, string>,
  body: string,
): Promise<{ status: number; text: string }> {
  try {
    const res = await fetch(`https://clob.polymarket.com${path}`, {
      method,
      headers: {
        accept: "application/json",
        ...(method === "GET" ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      body: method === "GET" ? undefined : body,
    });
    return { status: res.status, text: (await res.text()).slice(0, 2000) };
  } catch (e) {
    return { status: 0, text: (e instanceof Error ? e.message : "").slice(0, 180) };
  }
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", b64ToBytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

function parseCreds(text: string): Creds | null {
  try {
    const body = JSON.parse(text) as { apiKey?: string; secret?: string; passphrase?: string };
    if (!body.apiKey || !body.secret || !body.passphrase) return null;
    return { key: body.apiKey, secret: body.secret, passphrase: body.passphrase };
  } catch {
    return null;
  }
}

async function clobCreds(address: string): Promise<Creds | null> {
  const account = await loadPolygonAccount();
  if (!account || account.address.toLowerCase() !== address.toLowerCase()) return null;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const headers = {
    POLY_ADDRESS: address,
    POLY_SIGNATURE: await account.signTypedData({
      domain: { name: "ClobAuthDomain", version: "1", chainId: 137 },
      types: authTypes,
      primaryType: "ClobAuth",
      message: {
        address: address as Hex,
        timestamp,
        nonce: 0n,
        message: "This message attests that I control the given wallet",
      },
    }),
    POLY_TIMESTAMP: timestamp,
    POLY_NONCE: "0",
  };
  const parsed = parseCreds((await clobDirect("POST", "/auth/api-key", headers, "")).text);
  if (parsed) return parsed;
  return parseCreds((await clobDirect("GET", "/auth/derive-api-key", headers, "")).text);
}

async function l2Headers(creds: Creds, address: string, method: string, path: string, body: string) {
  const ts = Math.floor(Date.now() / 1000).toString();
  return {
    POLY_ADDRESS: address,
    POLY_SIGNATURE: await hmac(creds.secret, `${ts}${method}${path}${body}`),
    POLY_TIMESTAMP: ts,
    POLY_API_KEY: creds.key,
    POLY_PASSPHRASE: creds.passphrase,
  };
}

function knownExchange(addr: string): Hex | null {
  const v = addr.toLowerCase();
  if (v === EXCHANGE.toLowerCase()) return EXCHANGE;
  if (v === NEG_EXCHANGE.toLowerCase()) return NEG_EXCHANGE;
  return null;
}

function knownAdapter(addr: string, neg: boolean): Hex | null {
  const want = neg ? NEG_ADAPTER : ADAPTER;
  return addr.toLowerCase() === want.toLowerCase() ? want : null;
}

function pub() {
  return createPublicClient({ chain: polygon, transport: http(RPC) });
}

/** Exchange domain separator goes on the wire. DepositWallet lives inside TypedDataSign. */
function wrapDepositWalletSignature(
  domain: { name: string; version: string; chainId: number; verifyingContract: Hex },
  order: OrderMessage,
  innerSignature: Hex,
): Hex {
  const appDomainSeparator = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
      [
        keccak256(toHex(EIP712_DOMAIN)),
        keccak256(toHex(domain.name)),
        keccak256(toHex(domain.version)),
        BigInt(domain.chainId),
        domain.verifyingContract,
      ],
    ),
  );
  const contentsHash = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint8" },
        { type: "uint8" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        keccak256(toHex(ORDER_TYPE)),
        order.salt,
        order.maker,
        order.signer,
        order.tokenId,
        order.makerAmount,
        order.takerAmount,
        order.side,
        order.signatureType,
        order.timestamp,
        order.metadata,
        order.builder,
      ],
    ),
  );
  return concatHex([
    innerSignature,
    appDomainSeparator,
    contentsHash,
    toHex(ORDER_TYPE),
    toHex(ORDER_TYPE.length, { size: 2 }),
  ]);
}

async function movePusd(account: PrivateKeyAccount, deposit: Hex): Promise<string | null> {
  const client = pub();
  const bal = await client.readContract({
    address: PUSD,
    abi: erc20,
    functionName: "balanceOf",
    args: [account.address],
  });
  if (bal === 0n) return null;
  const wallet = createWalletClient({ account, chain: polygon, transport: http(RPC) });
  try {
    const hash = await wallet.writeContract({
      address: PUSD,
      abi: erc20,
      functionName: "transfer",
      args: [deposit, bal],
    });
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 25_000 });
    if (receipt.status !== "success") return "pUSD на deposit wallet не перейшов. Ордера немає.";
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/insufficient funds/i.test(msg)) return "Немає POL на газ. Ордера немає.";
    return "pUSD на deposit wallet не перейшов. Ордера немає.";
  }
  return null;
}

async function submitBatch(
  account: PrivateKeyAccount,
  deposit: Hex,
  calls: WalletCall[],
): Promise<{ ok: true; hash: string } | { ok: false; error: string }> {
  const nonce = await walletNonce({ data: { owner: account.address } });
  if (!nonce.ok) return nonce;
  let nonceBn: bigint;
  try {
    nonceBn = BigInt(nonce.nonce);
  } catch {
    return { ok: false, error: "Relayer дав поганий nonce." };
  }
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const signature = await account.signTypedData({
    domain: { name: "DepositWallet", version: "1", chainId: 137, verifyingContract: deposit },
    types: batchTypes,
    primaryType: "Batch",
    message: { wallet: deposit, nonce: nonceBn, deadline, calls },
  });
  return submitWalletBatch({
    data: {
      from: account.address,
      depositWallet: deposit,
      nonce: nonce.nonce,
      signature,
      deadline: deadline.toString(),
      calls: calls.map((c) => ({ target: c.target, value: c.value.toString(), data: c.data })),
    },
  });
}

async function approveDeposit(
  account: PrivateKeyAccount,
  deposit: Hex,
  exchange: Hex,
  need: bigint,
): Promise<string | null> {
  const [have, approved] = await Promise.all([
    readPolyAllowance({ data: { owner: deposit, exchange } }),
    readOutcomeApproved({ data: { owner: deposit, operator: exchange } }),
  ]);
  if (have != null && BigInt(have) >= need && approved === true) return null;
  const sent = await submitBatch(account, deposit, [
    {
      target: PUSD,
      value: 0n,
      data: encodeFunctionData({
        abi: erc20,
        functionName: "approve",
        args: [exchange, MAX_U256],
      }),
    },
    {
      target: CTF,
      value: 0n,
      data: encodeFunctionData({
        abi: erc1155,
        functionName: "setApprovalForAll",
        args: [exchange, true],
      }),
    },
  ]);
  if (!sent.ok) return sent.error;
  const [again, shares] = await Promise.all([
    readPolyAllowance({ data: { owner: deposit, exchange } }),
    readOutcomeApproved({ data: { owner: deposit, operator: exchange } }),
  ]);
  if (again == null || shares == null) return "немає цифри";
  if (BigInt(again) < need || shares !== true) return "Дозвіл deposit wallet не пройшов. Ордера немає.";
  return null;
}

async function touchBalance(creds: Creds, address: string, tokenId: string, selling: boolean): Promise<void> {
  const path = selling
    ? `/balance-allowance/update?asset_type=CONDITIONAL&token_id=${tokenId}&signature_type=3`
    : "/balance-allowance/update?asset_type=COLLATERAL&signature_type=3";
  await clobDirect("GET", path, await l2Headers(creds, address, "GET", path, ""), "");
}

export async function cancelPolyOrder(
  orderId: string,
): Promise<{ ok: true; canceled: boolean; why: string } | { ok: false; error: string }> {
  if (!/^0x[a-fA-F0-9]{16,128}$/.test(orderId)) return { ok: false, error: "CLOB не відповів" };
  const account = await loadPolygonAccount();
  if (!account) return { ok: false, error: "Ключа Polygon немає" };
  const creds = await clobCreds(account.address);
  if (!creds) return { ok: false, error: "CLOB не відповів" };
  const body = JSON.stringify({ orderID: orderId });
  const sent = await clobDirect("DELETE", "/order", await l2Headers(creds, account.address, "DELETE", "/order", body), body);
  if (!sent.status || !sent.text) return { ok: false, error: "CLOB не відповів" };
  try {
    const parsed = JSON.parse(sent.text) as {
      canceled?: unknown;
      notCanceled?: Record<string, unknown>;
      not_canceled?: Record<string, unknown>;
      error?: unknown;
    };
    const canceled = Array.isArray(parsed.canceled) ? parsed.canceled.map(String) : [];
    if (canceled.some((id) => id.toLowerCase() === orderId.toLowerCase())) return { ok: true, canceled: true, why: "" };
    const missed = parsed.notCanceled ?? parsed.not_canceled ?? {};
    const why = missed[orderId] || Object.values(missed)[0] || parsed.error || `CLOB ${sent.status}`;
    return { ok: true, canceled: false, why: String(why).slice(0, 180) };
  } catch {
    return { ok: false, error: "CLOB не відповів" };
  }
}

async function redeemOnEoa(
  account: PrivateKeyAccount,
  plan: { adapter: string; negRisk: boolean; conditionId: string },
): Promise<{ ok: true; hash: string } | { ok: false; error: string }> {
  const adapter = knownAdapter(plan.adapter, plan.negRisk);
  if (!adapter || !/^0x[0-9a-fA-F]{64}$/.test(plan.conditionId)) return { ok: false, error: "Редіму немає." };
  const approved = await readOutcomeApproved({ data: { owner: account.address, operator: adapter } });
  if (approved == null) return { ok: false, error: "Редіму немає." };
  const client = createWalletClient({ account, chain: polygon, transport: http(RPC) });
  const chain = pub();
  try {
    if (!approved) {
      const allow = await client.writeContract({
        address: CTF,
        abi: erc1155,
        functionName: "setApprovalForAll",
        args: [adapter, true],
      });
      if ((await chain.waitForTransactionReceipt({ hash: allow, timeout: 25_000 })).status !== "success") {
        return { ok: false, error: "Дозвіл акцій не пройшов. Редіму немає." };
      }
    }
    const hash = await client.writeContract({
      address: adapter,
      abi: redeemAbi,
      functionName: "redeemPositions",
      args: [PUSD, ZERO32, plan.conditionId as Hex, [1n, 2n]],
    });
    if ((await chain.waitForTransactionReceipt({ hash, timeout: 25_000 })).status !== "success") {
      return { ok: false, error: "Редіму немає." };
    }
    return { ok: true, hash };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/insufficient funds/i.test(msg)) return { ok: false, error: "Немає POL на газ. Редіму немає." };
    return { ok: false, error: "Редіму немає." };
  }
}

export async function redeemPolyPosition(plan: {
  adapter: string;
  negRisk: boolean;
  conditionId: string;
}): Promise<{ ok: true; hash: string } | { ok: false; error: string }> {
  const adapter = knownAdapter(plan.adapter, plan.negRisk);
  if (!adapter || !/^0x[0-9a-fA-F]{64}$/.test(plan.conditionId)) return { ok: false, error: "Редіму немає." };
  const account = await loadPolygonAccount();
  if (!account) return { ok: false, error: "Ключа Polygon немає" };
  const wallet = await ensureDepositWallet({ data: { owner: account.address } });
  if (!wallet.ok) {
    if (wallet.error.startsWith("Немає Builder ключа")) return redeemOnEoa(account, plan);
    return { ok: false, error: wallet.error };
  }
  const approved = await readOutcomeApproved({ data: { owner: wallet.address, operator: adapter } });
  if (approved == null) return { ok: false, error: "Редіму немає." };
  const calls: WalletCall[] = [];
  if (!approved) {
    calls.push({
      target: CTF,
      value: 0n,
      data: encodeFunctionData({
        abi: erc1155,
        functionName: "setApprovalForAll",
        args: [adapter, true],
      }),
    });
  }
  calls.push({
    target: adapter,
    value: 0n,
    data: encodeFunctionData({
      abi: redeemAbi,
      functionName: "redeemPositions",
      args: [PUSD, ZERO32, plan.conditionId as Hex, [1n, 2n]],
    }),
  });
  const sent = await submitBatch(account, wallet.address, calls);
  if (!sent.ok) return sent;
  return { ok: true, hash: sent.hash || "redeem" };
}

export async function readPolyOrder(orderId: string): Promise<{ status: string; sizeMatched: string } | null> {
  if (!/^0x[a-fA-F0-9]{16,128}$/.test(orderId)) return null;
  const account = await loadPolygonAccount();
  if (!account) return null;
  const creds = await clobCreds(account.address);
  if (!creds) return null;
  const path = `/data/order/${orderId}`;
  const sent = await clobDirect("GET", path, await l2Headers(creds, account.address, "GET", path, ""), "");
  if (!sent.status || !sent.text) return null;
  try {
    const body = JSON.parse(sent.text) as { order?: { status?: string; size_matched?: string }; status?: string; size_matched?: string };
    const row = body.order && typeof body.order === "object" ? body.order : body;
    if (!row.status) return null;
    return { status: String(row.status), sizeMatched: String(row.size_matched ?? "") };
  } catch {
    return null;
  }
}

export async function placePolyOrder(
  ticket: PolyTicket,
): Promise<{ ok: true; orderId: string; status: string } | { ok: false; error: string }> {
  const selling = ticket.side === "SELL" || ticket.action === "sell";
  // Live gate (live-trading.ts): no new Polymarket position unless the server enabled live trading.
  if (!selling && !liveTradingAllowed()) return { ok: false, error: LIVE_OFF_REASON };
  const account = await loadPolygonAccount();
  if (!account) return { ok: false, error: "Ключа Polygon немає" };
  if (!selling && ticket.lane === "crypto") {
    const label = ticket.windowLabel;
    if (label !== "5m" && label !== "15m" && label !== "1h" && label !== "4h") {
      return { ok: false, error: "Це вікно вимкнене. Ордера немає." };
    }
    const lo = Number.isFinite(ticket.askLo) ? Number(ticket.askLo) : 0.15;
    const hi = Number.isFinite(ticket.askHi) ? Number(ticket.askHi) : 0.85;
    const px = Number(ticket.price);
    if (!(px > lo && px < hi)) return { ok: false, error: `Ask поза ${lo}–${hi}. Ордера немає.` };
  }
  if (!selling && BigInt(ticket.makerAmount) < 1_000_000n) return { ok: false, error: "Мінімум ставки 1 pUSD. Ордера немає." };
  const exchange = knownExchange(ticket.exchange);
  if (!exchange) return { ok: false, error: "Біржа не та. Ордера немає." };
  if (selling) {
    const entry = Number(ticket.entryPrice);
    if (!Number.isFinite(entry) || entry <= 0) return { ok: false, error: "Немає відкритої позиції. Закриття немає." };
    const bid = await bestBid({ data: { tokenId: ticket.tokenId } });
    if (!bid) return { ok: false, error: "Немає стакана на продаж. Закриття немає." };
    if (bid !== ticket.price) return { ok: false, error: "Стакан змінився. Ордера немає." };
    if (Number(bid) <= entry) return { ok: false, error: "Прибутку в стакані немає. Не продаю." };
  } else {
    const best = await bestAsk({ data: { tokenId: ticket.tokenId } });
    if (!best) return { ok: false, error: "Немає стакана. Ордера немає." };
    if (best !== ticket.price) return { ok: false, error: "Стакан змінився. Ордера немає." };
  }
  const wallet = await ensureDepositWallet({ data: { owner: account.address } });
  if (!wallet.ok) return { ok: false, error: wallet.error };
  if (!selling) {
    const moved = await movePusd(account, wallet.address);
    if (moved) return { ok: false, error: moved };
  }
  const allowed = await approveDeposit(account, wallet.address, exchange, selling ? 0n : BigInt(ticket.makerAmount));
  if (allowed) return { ok: false, error: allowed };
  const creds = await clobCreds(account.address);
  if (!creds) return { ok: false, error: "Немає ключа CLOB. Ордера немає." };
  await touchBalance(creds, account.address, ticket.tokenId, selling);
  const salt = BigInt(Math.floor(Math.random() * 1e15));
  const timestamp = BigInt(Date.now());
  const order: OrderMessage = {
    salt,
    maker: wallet.address,
    signer: wallet.address,
    tokenId: BigInt(ticket.tokenId),
    makerAmount: BigInt(ticket.makerAmount),
    takerAmount: BigInt(ticket.takerAmount),
    side: selling ? 1 : 0,
    signatureType: 3,
    timestamp,
    metadata: ZERO32,
    builder: ZERO32,
  };
  const domain = {
    name: "Polymarket CTF Exchange",
    version: "2",
    chainId: 137,
    verifyingContract: exchange,
  };
  const innerSignature = await account.signTypedData({
    domain,
    types: typedDataSignTypes,
    primaryType: "TypedDataSign",
    message: {
      contents: order,
      name: "DepositWallet",
      version: "1",
      chainId: 137n,
      verifyingContract: wallet.address,
      salt: ZERO32,
    },
  });
  const signature = wrapDepositWalletSignature(domain, order, innerSignature);
  const payload = {
    deferExec: false,
    order: {
      builder: ZERO32,
      expiration: "0",
      maker: wallet.address,
      makerAmount: ticket.makerAmount,
      metadata: ZERO32,
      salt: Number(salt),
      side: selling ? "SELL" : "BUY",
      signature,
      signatureType: 3,
      signer: wallet.address,
      takerAmount: ticket.takerAmount,
      timestamp: timestamp.toString(),
      tokenId: ticket.tokenId,
    },
    orderType: "GTC",
    owner: creds.key,
  };
  const body = JSON.stringify(payload);
  const sent = await clobDirect("POST", "/order", await l2Headers(creds, account.address, "POST", "/order", body), body);
  if (!sent.status) return { ok: false, error: sent.text || "CLOB 0" };
  let parsed: { orderID?: string; orderId?: string; success?: boolean; status?: string; errorMsg?: string; error?: string; message?: string };
  try {
    parsed = JSON.parse(sent.text) as typeof parsed;
  } catch {
    return { ok: false, error: sent.text.replace(/\s+/g, " ").trim().slice(0, 180) || `CLOB ${sent.status}` };
  }
  const orderId = parsed.orderID || parsed.orderId || "";
  if (sent.status !== 200 || !parsed.success || !orderId) {
    const why = parsed.errorMsg || parsed.error || parsed.message || `CLOB ${sent.status}`;
    return { ok: false, error: String(why).slice(0, 180) };
  }
  return { ok: true, orderId, status: String(parsed.status || "live") };
}

export async function withdrawPusd(
  to: string,
  amount: number,
): Promise<{ ok: true; hash: string } | { ok: false; error: string }> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(to)) return { ok: false, error: "Адреса Polygon не та. Нічого не відправлено." };
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000) return { ok: false, error: "Сума pUSD має бути більша за нуль." };
  const units = BigInt(Math.round(amount * 1_000_000));
  if (units < 1n) return { ok: false, error: "Сума pUSD має бути більша за нуль." };
  const account = await loadPolygonAccount();
  if (!account) return { ok: false, error: "Ключа Polygon немає." };
  if (account.address.toLowerCase() === to.toLowerCase()) return { ok: false, error: "Це адреса цього ж гаманця. Вивід скасовано." };
  const client = pub();
  const bal = await client.readContract({ address: PUSD, abi: erc20, functionName: "balanceOf", args: [account.address] });
  if (bal < units) return { ok: false, error: "На гаманці Polymarket мало pUSD." };
  const wallet = createWalletClient({ account, chain: polygon, transport: http(RPC) });
  try {
    const hash = await wallet.writeContract({
      address: PUSD,
      abi: erc20,
      functionName: "transfer",
      args: [to as Hex, units],
    });
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 25_000 });
    if (receipt.status !== "success") return { ok: false, error: "Мережа не підтвердила вивід pUSD." };
    return { ok: true, hash };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/insufficient funds/i.test(msg)) return { ok: false, error: "Немає POL на газ. pUSD не пішов." };
    return { ok: false, error: msg.replace(/\s+/g, " ").trim().slice(0, 180) || "pUSD не пішов." };
  }
}
