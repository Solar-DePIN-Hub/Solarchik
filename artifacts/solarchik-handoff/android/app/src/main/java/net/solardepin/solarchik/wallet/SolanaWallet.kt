package net.solardepin.solarchik.wallet

import android.content.Context
import android.net.Uri
import com.solana.mobilewalletadapter.clientlib.ActivityResultSender
import com.solana.mobilewalletadapter.clientlib.ConnectionIdentity
import com.solana.mobilewalletadapter.clientlib.MobileWalletAdapter
import com.solana.mobilewalletadapter.clientlib.RpcCluster
import com.solana.mobilewalletadapter.clientlib.TransactionResult
import com.solana.mobilewalletadapter.clientlib.protocol.MobileWalletAdapterClient
import net.solardepin.solarchik.core.SolarchikConfig
import net.solardepin.solarchik.game.GameSave
import net.solardepin.solarchik.solana.LegacyTx
import net.solardepin.solarchik.solana.Rpc
import org.sol4k.PublicKey
import java.time.LocalDate
import java.time.ZoneOffset

data class WalletSession(val address: String, val authToken: String)

data class ClockProof(
    val address: String,
    val signature: String,
    val cluster: String,
    val kind: String,
    val authToken: String,
)

data class SentTx(val address: String, val signature: String, val cluster: String)

/**
 * Typed wallet failure so the UI can show a localized line. [signOnlyMayHelp]: the wallet refused
 * sign-and-send itself (not the player, not a timeout), so the sign-only fallback is worth a try.
 */
class WalletError(val kind: Kind, detail: String = "", val signOnlyMayHelp: Boolean = false, val authRejected: Boolean = false) :
    Exception(detail.ifBlank { kind.name }) {
    enum class Kind { NO_WALLET, DECLINED, NETWORK, FAILED }

    companion object {
        /**
         * Maps an MWA failure to a kind. The clientlib's own message ("User did not authorize
         * signing") and the wallet's JSON-RPC error code both count, so a decline is never retried.
         */
        fun classify(message: String?, cause: Throwable?): WalletError {
            val code = (cause as? com.solana.mobilewalletadapter.clientlib.protocol.JsonRpc20Client.JsonRpc20RemoteException)?.code
            val text = listOfNotNull(message?.takeIf { it.isNotBlank() }, cause?.message?.takeIf { it.isNotBlank() && it != message }).joinToString(" | ")
            val m = text.lowercase()
            return when {
                code == ERR_AUTH -> WalletError(Kind.DECLINED, text, authRejected = true)
                code == ERR_NOT_SIGNED -> WalletError(Kind.DECLINED, text)
                m.contains("no wallet") || m.contains("no compatible wallet") -> WalletError(Kind.NO_WALLET, text)
                m.contains("declin") || m.contains("reject") || m.contains("cancel") || m.contains("denied") ||
                    m.contains("did not authorize") || m.contains("not signed") -> WalletError(Kind.DECLINED, text)
                m.contains("auth token invalid") -> WalletError(Kind.DECLINED, text, authRejected = true)
                m.contains("timed out") || m.contains("interrupted") || m.contains("io error") || cause is java.io.IOException ->
                    WalletError(Kind.FAILED, text)
                code == ERR_NOT_SUBMITTED || m.contains("not all transactions were submitted") ||
                    code != null || m.contains("remote exception") || m.contains("json-rpc") -> WalletError(Kind.FAILED, text, signOnlyMayHelp = true)
                else -> WalletError(Kind.FAILED, text)
            }
        }

        private const val ERR_AUTH = -1
        private const val ERR_NOT_SIGNED = -3
        private const val ERR_NOT_SUBMITTED = -4
    }
}

/** One blockhash per user action: the sign-only retry signs the very same message, so if the first try did land the second is rejected as a duplicate instead of paying twice. */
class StickyBlockhash(private val fetch: suspend () -> ByteArray) {
    private var hash: ByteArray? = null
    suspend fun get(): ByteArray = hash ?: fetch().also { hash = it }
}

class SolanaWallet(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("seeker-wallet", Context.MODE_PRIVATE)

    init {
        migrateFrom01951(context.applicationContext)
    }

    /**
     * 0.19.51 kept only the MWA auth token. Its signed CLOCK IN remembered the account in the game
     * save, so an upgraded phone shows the same wallet instead of looking disconnected.
     */
    private fun migrateFrom01951(app: Context) {
        if (prefs.getString("address", "").orEmpty().isNotBlank()) return
        if (prefs.getString("auth", "").orEmpty().isBlank()) return
        val addr = app.getSharedPreferences("solarchik-game", Context.MODE_PRIVATE).getString("clockAddress", "").orEmpty()
        if (runCatching { Base58.decode(addr).size == 32 }.getOrDefault(false)) prefs.edit().putString("address", addr).apply()
    }
    val isSeeker: Boolean = SeekerDevice.isSeeker()

    /** Seeker defaults to mainnet; the player may force devnet. Everything else is devnet only. */
    var forceDevnet: Boolean
        get() = prefs.getBoolean("forceDevnet", false)
        set(value) {
            prefs.edit().putBoolean("forceDevnet", value).apply()
            adapter.rpcCluster = rpcCluster()
        }

    val mainnet: Boolean get() = isSeeker && !forceDevnet
    val clusterName: String get() = if (mainnet) "mainnet" else "devnet"
    val rpcUrl: String get() = if (mainnet) SolarchikConfig.RPC_MAINNET else SolarchikConfig.RPC_DEVNET
    val rpc: Rpc get() = Rpc(rpcUrl)

    /** Last connected account (base58) or blank. */
    val address: String get() = prefs.getString("address", "").orEmpty()
    val connected: Boolean get() = address.isNotBlank()

    private fun rpcCluster(): RpcCluster = if (mainnet) RpcCluster.MainnetBeta else RpcCluster.Devnet

    private val adapter = MobileWalletAdapter(
        connectionIdentity = ConnectionIdentity(
            identityUri = Uri.parse("https://solardepin.net"),
            iconUri = Uri.parse("https://solardepin.net/favicon.ico"),
            identityName = "Solarchik",
        )
    ).apply {
        rpcCluster = if (isSeeker && !prefs.getBoolean("forceDevnet", false)) RpcCluster.MainnetBeta else RpcCluster.Devnet
        val saved = prefs.getString("auth", "").orEmpty()
        if (saved.isNotBlank()) authToken = saved
    }

    private fun remember(token: String?, address: String? = null) {
        val edit = prefs.edit()
        if (!token.isNullOrBlank()) {
            adapter.authToken = token
            edit.putString("auth", token)
        }
        if (!address.isNullOrBlank()) edit.putString("address", address)
        edit.apply()
    }

    /** Forgets the session on this phone. The wallet app keeps its own list. */
    fun forget() {
        adapter.authToken = null
        prefs.edit().remove("auth").remove("address").apply()
    }

    suspend fun connect(sender: ActivityResultSender): Result<WalletSession> {
        adapter.rpcCluster = rpcCluster()
        return when (val result = adapter.connect(sender)) {
            is TransactionResult.Success -> {
                val auth = result.authResult
                val key = accountKey(auth) ?: return Result.failure(WalletError(WalletError.Kind.FAILED, "Wallet connected without account"))
                val addr = Base58.encode(key)
                remember(auth.authToken, addr)
                Result.success(WalletSession(addr, auth.authToken ?: ""))
            }
            is TransactionResult.NoWalletFound -> Result.failure(WalletError(WalletError.Kind.NO_WALLET))
            is TransactionResult.Failure -> Result.failure(fail(result))
        }
    }

    /**
     * Signs and sends any transaction built by [build] with the connected MWA account as fee payer.
     * [build] runs after authorization with the payer key and a fresh blockhash, and may
     * partially sign (e.g. a new Core asset keypair) before the wallet signs slot 0.
     */
    suspend fun signAndSend(
        sender: ActivityResultSender,
        build: suspend (payer: PublicKey, blockhash: ByteArray) -> LegacyTx,
    ): Result<SentTx> {
        val client = rpc
        val hash = StickyBlockhash { client.latestBlockhash() }
        val first = signAndSendOnce(sender, client, hash, build)
        val err = first.exceptionOrNull() ?: return first
        if (!shouldTrySignOnly(err)) return first
        // Some wallets (or Seed Vault builds) refuse signAndSend for a tx that already carries
        // another signer. Fall back to sign-only and broadcast through our own RPC, with the
        // same blockhash so a first attempt that did land cannot be paid twice.
        val second = signOnlyThenSend(sender, client, hash, build)
        return if (second.isSuccess) second else first
    }

    /** Only a wallet-side refusal of sign-and-send is retried; declines, timeouts and our own build errors are final. */
    internal fun shouldTrySignOnly(err: Throwable): Boolean =
        err is WalletError && err.kind == WalletError.Kind.FAILED && err.signOnlyMayHelp

    /** Classifies a failure; a rejected authorization drops the saved token so the next tap asks afresh. */
    private fun fail(result: TransactionResult.Failure<*>): WalletError {
        val e = WalletError.classify(result.message, result.e)
        if (e.authRejected) {
            adapter.authToken = null
            prefs.edit().remove("auth").apply()
        }
        return e
    }

    private suspend fun signAndSendOnce(
        sender: ActivityResultSender,
        client: Rpc,
        hash: StickyBlockhash,
        build: suspend (payer: PublicKey, blockhash: ByteArray) -> LegacyTx,
    ): Result<SentTx> {
        adapter.rpcCluster = rpcCluster()
        val cluster = clusterName
        var buildError: Throwable? = null
        val result = try {
            adapter.transact(sender) { auth ->
                val payer = PublicKey(accountKey(auth) ?: error("No account"))
                val tx = try {
                    build(payer, hash.get())
                } catch (t: Throwable) {
                    buildError = t
                    throw t
                }
                signAndSendTransactions(arrayOf(tx.serialize()))
            }
        } catch (t: Throwable) {
            if (t is kotlinx.coroutines.CancellationException && buildError == null) throw t
            return Result.failure(buildError?.let(::buildFailure) ?: WalletError.classify(t.message, t))
        }
        return when (result) {
            is TransactionResult.Success -> {
                val addr = accountKey(result.authResult)?.let { Base58.encode(it) }.orEmpty()
                remember(result.authResult.authToken, addr)
                val sig = result.payload.signatures.firstOrNull()?.let { Base58.encode(it) }.orEmpty()
                if (sig.isBlank()) Result.failure(WalletError(WalletError.Kind.FAILED, "Wallet sent no signature"))
                else Result.success(SentTx(addr, sig, cluster))
            }
            is TransactionResult.NoWalletFound -> Result.failure(WalletError(WalletError.Kind.NO_WALLET))
            is TransactionResult.Failure ->
                Result.failure(buildError?.let(::buildFailure) ?: fail(result))
        }
    }

    private suspend fun signOnlyThenSend(
        sender: ActivityResultSender,
        client: Rpc,
        hash: StickyBlockhash,
        build: suspend (payer: PublicKey, blockhash: ByteArray) -> LegacyTx,
    ): Result<SentTx> {
        adapter.rpcCluster = rpcCluster()
        val cluster = clusterName
        var buildError: Throwable? = null
        val result = try {
            adapter.transact(sender) { auth ->
                val payer = PublicKey(accountKey(auth) ?: error("No account"))
                val tx = try {
                    build(payer, hash.get())
                } catch (t: Throwable) {
                    buildError = t
                    throw t
                }
                @Suppress("DEPRECATION")
                signTransactions(arrayOf(tx.serialize()))
            }
        } catch (t: Throwable) {
            if (t is kotlinx.coroutines.CancellationException && buildError == null) throw t
            return Result.failure(buildError?.let(::buildFailure) ?: WalletError.classify(t.message, t))
        }
        return when (result) {
            is TransactionResult.Success -> {
                val addr = accountKey(result.authResult)?.let { Base58.encode(it) }.orEmpty()
                remember(result.authResult.authToken, addr)
                val signed = result.payload.signedPayloads.firstOrNull()
                    ?: return Result.failure(WalletError(WalletError.Kind.FAILED, "Wallet returned no transaction"))
                runCatching { client.sendTransaction(signed) }
                    .map { SentTx(addr, it, cluster) }
                    .recoverCatching { throw buildFailure(it) }
            }
            is TransactionResult.NoWalletFound -> Result.failure(WalletError(WalletError.Kind.NO_WALLET))
            is TransactionResult.Failure -> Result.failure(fail(result))
        }
    }

    suspend fun balanceSol(): Result<Double> = runCatching {
        val addr = address
        require(addr.isNotBlank()) { "not connected" }
        rpc.balanceLamports(addr) / SolarchikConfig.LAMPORTS_PER_SOL.toDouble()
    }

    /** Devnet only. Never called on mainnet. */
    suspend fun airdrop(): Result<String> = runCatching {
        check(!mainnet) { "airdrop is devnet only" }
        val addr = address
        require(addr.isNotBlank()) { "not connected" }
        rpc.requestAirdrop(addr, SolarchikConfig.lamports(SolarchikConfig.AIRDROP_SOL))
    }

    suspend fun clockInOnChain(
        sender: ActivityResultSender,
        meters: Int,
        score: Int,
        streak: Int,
        day: String = LocalDate.now(ZoneOffset.UTC).toString(),
    ): Result<ClockProof> {
        val memo = "solarchik clock $day ${meters}m s$streak ${GameSave.dayModOf(day)}"
        val sent = sendMemo(sender, memo)
        if (sent.isSuccess) return sent
        val err = sent.exceptionOrNull()
        if (stopAfter(err)) return Result.failure(err ?: WalletError(WalletError.Kind.DECLINED))
        return signMessage(sender, memo)
    }

    private suspend fun sendMemo(sender: ActivityResultSender, memo: String): Result<ClockProof> {
        adapter.rpcCluster = rpcCluster()
        val cluster = clusterName
        val blockhash = runCatching { rpc.latestBlockhash() }.getOrElse {
            return Result.failure(WalletError(WalletError.Kind.NETWORK, it.message ?: ""))
        }
        return when (
            val result = adapter.transact(sender) { auth ->
                val payer = accountKey(auth) ?: error("No account")
                val tx = MemoTx.build(payer, blockhash, memo)
                signAndSendTransactions(arrayOf(tx))
            }
        ) {
            is TransactionResult.Success -> {
                val payer = accountKey(result.authResult)?.let { Base58.encode(it) } ?: ""
                remember(result.authResult.authToken, payer)
                val sig = result.payload.signatures.firstOrNull()?.let { Base58.encode(it) } ?: ""
                if (sig.isBlank()) Result.failure(WalletError(WalletError.Kind.FAILED, "Wallet sent no signature"))
                else Result.success(ClockProof(payer, sig, cluster, "tx", result.authResult.authToken ?: ""))
            }
            is TransactionResult.NoWalletFound -> Result.failure(WalletError(WalletError.Kind.NO_WALLET))
            is TransactionResult.Failure -> Result.failure(fail(result))
        }
    }

    private suspend fun signMessage(sender: ActivityResultSender, message: String): Result<ClockProof> {
        val bytes = message.encodeToByteArray()
        val cluster = clusterName
        return when (
            val result = adapter.transact(sender) { auth ->
                val key = accountKey(auth) ?: error("No account")
                signMessagesDetached(arrayOf(bytes), arrayOf(key))
            }
        ) {
            is TransactionResult.Success -> {
                val signed = result.payload.messages.firstOrNull()
                    ?: return Result.failure(WalletError(WalletError.Kind.FAILED, "Wallet signed without a message"))
                val rawSig = signed.signatures.firstOrNull()
                    ?: return Result.failure(WalletError(WalletError.Kind.FAILED, "Wallet sent no signature"))
                val sig = Base58.encode(rawSig)
                if (sig.length < 32) return Result.failure(WalletError(WalletError.Kind.FAILED, "Wallet sent no signature"))
                val fromMsg = signed.addresses.firstOrNull()?.let { Base58.encode(it) }.orEmpty()
                val payer = fromMsg.ifBlank {
                    accountKey(result.authResult)?.let { Base58.encode(it) } ?: ""
                }
                remember(result.authResult.authToken, payer)
                if (payer.isBlank()) Result.failure(WalletError(WalletError.Kind.FAILED, "Wallet signed without account"))
                else Result.success(ClockProof(payer, sig, cluster, "message", result.authResult.authToken ?: ""))
            }
            is TransactionResult.NoWalletFound -> Result.failure(WalletError(WalletError.Kind.NO_WALLET))
            is TransactionResult.Failure -> Result.failure(fail(result))
        }
    }

    private fun buildFailure(t: Throwable): Throwable =
        if (t is java.io.IOException || t is net.solardepin.solarchik.solana.RpcException) WalletError(WalletError.Kind.NETWORK, t.message ?: "") else t

    private fun stopAfter(error: Throwable?): Boolean {
        if (error is WalletError) return error.kind == WalletError.Kind.NO_WALLET || error.kind == WalletError.Kind.DECLINED
        return false
    }

    private fun accountKey(auth: MobileWalletAdapterClient.AuthorizationResult): ByteArray? {
        val accounts = auth.accounts
        if (accounts != null && accounts.isNotEmpty()) return accounts[0].publicKey
        return auth.publicKey
    }
}

object Base58 {
    private const val ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

    fun encode(input: ByteArray): String {
        if (input.isEmpty()) return ""
        val zeros = input.takeWhile { it.toInt() == 0 }.size
        val encoded = ByteArray(input.size * 2)
        var outputStart = encoded.size
        val bytes = input.copyOf()
        var start = zeros
        while (start < bytes.size) {
            var remainder = 0
            for (i in start until bytes.size) {
                val acc = (bytes[i].toInt() and 0xff) + remainder * 256
                bytes[i] = (acc / 58).toByte()
                remainder = acc % 58
            }
            encoded[--outputStart] = ALPHABET[remainder].code.toByte()
            while (start < bytes.size && bytes[start].toInt() == 0) start++
        }
        return "1".repeat(zeros) + String(encoded, outputStart, encoded.size - outputStart)
    }

    fun decode(input: String): ByteArray {
        if (input.isEmpty()) return ByteArray(0)
        val zeros = input.takeWhile { it == '1' }.length
        val bytes = ByteArray(input.length)
        var length = 0
        for (ch in input) {
            var carry = ALPHABET.indexOf(ch)
            require(carry >= 0) { "bad base58" }
            for (i in 0 until length) {
                carry += 58 * (bytes[i].toInt() and 0xff)
                bytes[i] = (carry % 256).toByte()
                carry /= 256
            }
            while (carry > 0) {
                bytes[length++] = (carry % 256).toByte()
                carry /= 256
            }
        }
        val out = ByteArray(zeros + length)
        for (i in 0 until length) out[zeros + length - 1 - i] = bytes[i]
        return out
    }
}
