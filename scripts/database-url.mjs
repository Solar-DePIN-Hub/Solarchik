// Which Postgres URL the server uses. DATABASE_URL wins; otherwise the names the
// Vercel Neon integration injects (POSTGRES_URL, DATABASE_URL_UNPOOLED via POSTGRES_URL_NON_POOLING)
// so a linked Neon store works without copying its secret into a second variable.
// Empty / whitespace values count as unset. Values are never logged.

/** Env keys tried in order. */
export const DATABASE_URL_KEYS = ["DATABASE_URL", "POSTGRES_URL", "NEON_DATABASE_URL", "POSTGRES_URL_NON_POOLING"];

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ url: string, key: string } | undefined}
 */
export function resolveDatabaseUrl(env = typeof process !== "undefined" ? process.env : {}) {
  for (const key of DATABASE_URL_KEYS) {
    const v = env[key];
    if (typeof v === "string" && v.trim()) return { url: v.trim(), key };
  }
  return undefined;
}
