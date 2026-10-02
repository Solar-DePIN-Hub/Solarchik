package net.solardepin.solarchik.agents

import org.sol4k.Keypair
import org.sol4k.PublicKey
import org.sol4k.tweetnacl.TweetNaclFast
import java.security.MessageDigest

/**
 * One Free agent per wallet on every cluster, Seeker mainnet included.
 *
 * The Free asset keypair is derived from the wallet's own Ed25519 signature of a fixed
 * text (Ed25519 signatures are deterministic), so the same wallet always gets the same
 * asset address and Metaplex Core refuses to create that account twice. Only the wallet
 * can produce the signature, so nobody else can take a wallet's Free address first.
 * Same idea as the web server's derived address (`asset:free:<wallet>`), without a server key.
 */
object FreeAsset {
    private const val SEED_TAG = "solarchik:free-asset-seed:v1"

    fun message(wallet: String): String =
        "solarchik:free-agent:v1\nwallet:$wallet\nOne free strategy agent per wallet. This signature moves no funds."

    /** Null when the signature is not this wallet's signature of [message]. */
    fun keypair(wallet: String, signature: ByteArray): Keypair? {
        if (signature.size != 64) return null
        val ok = runCatching { PublicKey(wallet).verify(signature, message(wallet).encodeToByteArray()) }.getOrDefault(false)
        if (!ok) return null
        val seed = MessageDigest.getInstance("SHA-256").digest(SEED_TAG.encodeToByteArray() + signature)
        val pair = TweetNaclFast.Signature.keyPair_fromSeed(seed)
        return Keypair.fromSecretKey(pair.secretKey)
    }
}
