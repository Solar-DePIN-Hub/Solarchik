package net.solardepin.solarchik.wallet

import android.content.Context
import android.util.Base64
import org.sol4k.Keypair
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The built-in devnet wallet (0.21.9): for phones and judges without a Solana wallet app. The keypair is
 * generated on the phone; its secret is stored only encrypted (AES-256-GCM with a non-exportable key in
 * the Android Keystore). It never leaves the phone and no secret ships in the APK. Devnet test SOL only:
 * [SolanaWallet] never uses this key on mainnet.
 */
object LocalKey {
    private const val PREF = "solarchik-local-wallet"
    private const val ALIAS = "solarchik-local-wallet-v1"

    /** Encrypt/decrypt seam. Production: Android Keystore. Robolectric tests install a plain AES key. */
    interface Box {
        fun seal(plain: ByteArray): ByteArray
        fun open(sealed: ByteArray): ByteArray
    }

    @Volatile var box: Box = KeystoreBox

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREF, Context.MODE_PRIVATE)

    fun exists(ctx: Context): Boolean = prefs(ctx).getString("sealed", null) != null && address(ctx).isNotBlank()

    fun address(ctx: Context): String = prefs(ctx).getString("address", "").orEmpty()

    fun createdAt(ctx: Context): Long = prefs(ctx).getLong("createdAt", 0)

    /** Creates the key once (an existing one is kept: it may hold devnet SOL and agents). Returns the address. */
    fun create(ctx: Context): String {
        if (exists(ctx)) return address(ctx)
        val kp = Keypair.generate()
        val sealed = box.seal(kp.secret)
        val addr = kp.publicKey.toBase58()
        prefs(ctx).edit()
            .putString("sealed", Base64.encodeToString(sealed, Base64.NO_WRAP))
            .putString("address", addr)
            .putLong("createdAt", System.currentTimeMillis())
            .apply()
        return addr
    }

    /** The decrypted keypair, only for the moment of signing. Null if missing or the Keystore key is gone. */
    fun keypair(ctx: Context): Keypair? {
        val raw = prefs(ctx).getString("sealed", null) ?: return null
        return runCatching {
            val kp = Keypair.fromSecretKey(box.open(Base64.decode(raw, Base64.NO_WRAP)))
            kp.takeIf { it.publicKey.toBase58() == address(ctx) }
        }.getOrNull()
    }

    /** Deletes the key (Settings › Delete my data). Its devnet SOL is test money and is gone with it. */
    fun delete(ctx: Context) {
        prefs(ctx).edit().clear().apply()
        runCatching { (box as? KeystoreBox)?.deleteKey() }
    }

    /**
     * Signs a serialized transaction (legacy or v0) built by someone else (the strategy server) in the slot
     * that belongs to [key]. Other slots (the server's co-signature) stay as they are.
     */
    fun signSlot(tx: ByteArray, key: Keypair): ByteArray {
        val (n, sigStart) = shortvec(tx, 0)
        val msgStart = sigStart + 64 * n
        val msg = tx.copyOfRange(msgStart, tx.size)
        var p = if (msg[0].toInt() and 0x80 != 0) 1 else 0
        val required = msg[p].toInt() and 0xFF
        p += 3
        val (keys, keysAt) = shortvec(msg, p)
        val me = key.publicKey.bytes()
        val idx = (0 until minOf(required, keys, n)).firstOrNull { i -> msg.copyOfRange(keysAt + 32 * i, keysAt + 32 * i + 32).contentEquals(me) }
            ?: throw WalletError(WalletError.Kind.FAILED, "Built-in wallet is not a signer of this transaction")
        val out = tx.copyOf()
        key.sign(msg).copyInto(out, sigStart + 64 * idx)
        return out
    }

    private fun shortvec(b: ByteArray, at: Int): Pair<Int, Int> {
        var v = 0; var shift = 0; var i = at
        while (true) {
            val x = b[i++].toInt() and 0xFF
            v = v or ((x and 0x7F) shl shift)
            if (x and 0x80 == 0) break
            shift += 7
        }
        return v to i
    }

    /** AES-256-GCM, key generated inside the Android Keystore (never exportable). Stored as iv(12) + ciphertext. */
    object KeystoreBox : Box {
        private fun key(): SecretKey {
            val ks = java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
            val gen = KeyGenerator.getInstance(android.security.keystore.KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            gen.init(
                android.security.keystore.KeyGenParameterSpec.Builder(
                    ALIAS,
                    android.security.keystore.KeyProperties.PURPOSE_ENCRYPT or android.security.keystore.KeyProperties.PURPOSE_DECRYPT,
                )
                    .setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build(),
            )
            return gen.generateKey()
        }

        override fun seal(plain: ByteArray): ByteArray {
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.ENCRYPT_MODE, key())
            return c.iv + c.doFinal(plain)
        }

        override fun open(sealed: ByteArray): ByteArray {
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, sealed.copyOfRange(0, 12)))
            return c.doFinal(sealed, 12, sealed.size - 12)
        }

        fun deleteKey() {
            val ks = java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            if (ks.containsAlias(ALIAS)) ks.deleteEntry(ALIAS)
        }
    }
}
