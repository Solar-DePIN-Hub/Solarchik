import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

function stubStart(): Plugin {
  const stub = "\0native-stub";
  const cryptoShim = "\0node-crypto-shim";
  const fsShim = "\0node-fs-shim";
  return {
    name: "stub-server-fns",
    enforce: "pre",
    resolveId(id) {
      const bare = id.split("?")[0] ?? id;
      if (bare === "node:crypto") return cryptoShim;
      if (bare === "node:fs" || bare === "node:fs/promises") return fsShim;
      if (bare.includes("quicknode.mjs")) return resolve(__dirname, "src/lib/agents/public-rpc.ts");
      if (
        bare.includes("askBuddy.functions") ||
        bare.includes("@tanstack/react-start") ||
        bare.includes("@tanstack/start-") ||
        bare.includes("weex.server") ||
        bare.includes("secrets.server")
      ) {
        return stub;
      }
      return null;
    },
    load(id) {
      if (id === cryptoShim) {
        return [
          "function unsupported(){ throw new Error('crypto-desk'); }",
          "export const createHmac = unsupported;",
          "export const createHash = unsupported;",
          "export const randomBytes = unsupported;",
          "export const generateKeyPairSync = unsupported;",
          "export default { createHmac, createHash, randomBytes, generateKeyPairSync };",
        ].join("\n");
      }
      if (id === fsShim) {
        return [
          "export function readFileSync(){ return ''; }",
          "export function existsSync(){ return false; }",
          "export default { readFileSync, existsSync };",
        ].join("\n");
      }
      if (id === stub) {
        return [
          "function __chain(){ const api = function(){ return Promise.resolve({ ok:false, error:'offline' }); }; api.validator = () => api; api.inputValidator = () => api; api.middleware = () => api; api.handler = (fn) => fn; return api; }",
          "const __off = async () => ({ ok: false, error: 'offline' });",
          "export function createServerFn(){ return __chain(); }",
          "export function createMiddleware(){ const mw = () => mw; mw.server = () => mw; mw.client = () => mw; return mw; }",
          "export const createServerOnlyFn = (fn) => fn;",
          "export function createIsomorphicFn(){ const iso = () => iso; iso.server = () => iso; iso.client = () => iso; return iso; }",
          "export async function askBuddy(){ return { ok:false, error:'offline' }; }",
          "export async function hearBuddy(){ return { ok:false }; }",
          "export async function speakBuddy(){ return { ok:false }; }",
          "export const stepWeexOnServer = __off;",
          "export function xaiApiKey(){ return undefined; }",
          "export function geminiApiKey(){ return undefined; }",
          "export default {}",
        ].join("\n");
      }
      return null;
    },
  };
}

const emptyEnv = [
  "XAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "OPENAI_API_KEY",
  "POLYMARKET_BUILDER_API_KEY",
  "POLYMARKET_BUILDER_SECRET",
  "POLYMARKET_BUILDER_PASSPHRASE",
  "POLYMARKET_BUILDER_CODE",
  "WEEX_API_KEY",
  "WEEX_API_SECRET",
  "WEEX_API_PASSPHRASE",
  "TITAN_API_KEY",
  "TITAN_JWT",
];

export default defineConfig({
  plugins: [stubStart(), viteReact(), tailwindcss()],
  base: "./",
  publicDir: false,
  define: {
    "import.meta.env.VITE_NATIVE": JSON.stringify("1"),
    ...Object.fromEntries(emptyEnv.map((key) => [`process.env.${key}`, JSON.stringify("")])),
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: "build-native",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    rollupOptions: {
      input: resolve(__dirname, "native.html"),
      output: {
        format: "iife",
        name: "Solarchik",
        inlineDynamicImports: true,
        entryFileNames: "assets/native.js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
