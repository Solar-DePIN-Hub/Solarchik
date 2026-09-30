package net.solardepin.solarchik.wallet

import android.content.Context
import android.net.Uri
import com.solana.mobilewalletadapter.clientlib.ActivityResultSender
import com.solana.mobilewalletadapter.clientlib.ConnectionIdentity
import com.solana.mobilewalletadapter.clientlib.MobileWalletAdapter
import com.solana.mobilewalletadapter.clientlib.RpcCluster
import com.solana.mobilewalletadapter.clientlib.TransactionResult
import com.solana.mobilewalletadapter.clientlib.protocol.MobileWalletAdapterClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import net.solardepin.solarchik.game.GameSave
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

class SolanaWallet(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("seeker-wallet", Context.MODE_PRIVATE)
    private val mainnet = SeekerDevice.isSeeker()
    val clusterName: String = if (mainnet) "mainnet" else "devnet"
    private val rpcUrl = if (mainnet) "https://api.mainnet-beta.solana.com" else "https://api.devnet.solana.com"

    private val adapter = MobileWalletAdapter(
        connectionIdentity = ConnectionIdentity(
            identityUri = Uri.parse("https://solardepin.net"),
            iconUri = Uri.parse("https://solardepin.net/favicon.ico"),
            identityName = "Solarchik",
        )
    ).apply {
        rpcCluster = if (mainnet) RpcCluster.MainnetBeta else RpcCluster.Devnet
        val saved = prefs.getString("auth", "").orEmpty()
        if (saved.isNotBlank()) authToken = saved
    }

    private fun remember(token: String?) {
        if (token.isNullOrBlank()) return
        adapter.authToken = token
        prefs.edit().putString("auth", token).apply()
    }

    suspend fun connect(sender: ActivityResultSender): Result<WalletSession> {
        return when (val result = adapter.connect(sender)) {
            is TransactionResult.Success -> {
                val auth = result.authResult
                remember(auth.authToken)
                val key = accountKey(auth) ?: return Result.failure(IllegalStateException("Wallet connected without account"))
                Result.success(WalletSession(Base58.encode(key), auth.authToken ?: ""))
            }
            is TransactionResult.NoWalletFound ->
                Result.failure(IllegalStateException("No Seeker Wallet. Open Seed Vault Wallet once, then try again."))
            is TransactionResult.Failure ->
                Result.failure(IllegalStateException(result.e.message ?: result.message ?: "Wallet connect failed"))
        }
    }

    suspend fun clockInOnChain(
        sender: ActivityResultSender,
        meters: Int,
        score: Int,
        streak: Int,
    ): Result<ClockProof> {
        val day = LocalDate.now(ZoneOffset.UTC)
        val memo = "solarchik clock $day ${meters}m s$streak ${GameSave.dayModOf(day.toString())}"
        val sent = sendMemo(sender, memo)
        if (sent.isSuccess) return sent
        val err = sent.exceptionOrNull()
        if (stopAfter(err)) return Result.failure(err ?: IllegalStateException("Wallet did not sign"))
        return signMessage(sender, memo)
    }

    private suspend fun sendMemo(sender: ActivityResultSender, memo: String): Result<ClockProof> {
        val blockhash = runCatching { fetchBlockhash() }.getOrElse {
            return Result.failure(it)
        }
        return when (
            val result = adapter.transact(sender) { auth ->
                val payer = accountKey(auth) ?: error("No account")
                val tx = MemoTx.build(payer, blockhash, memo)
                signAndSendTransactions(arrayOf(tx))
            }
        ) {
            is TransactionResult.Success -> {
                remember(result.authResult.authToken)
                val payer = accountKey(result.authResult)?.let { Base58.encode(it) } ?: ""
                val sig = result.payload.signatures.firstOrNull()?.let { Base58.encode(it) } ?: ""
                if (sig.isBlank()) Result.failure(IllegalStateException("Wallet sent no signature"))
                else Result.success(ClockProof(payer, sig, clusterName, "tx", result.authResult.authToken ?: ""))
            }
            is TransactionResult.NoWalletFound ->
                Result.failure(IllegalStateException("No Seeker Wallet. Open Seed Vault Wallet once, then try again."))
            is TransactionResult.Failure ->
                Result.failure(IllegalStateException(result.e.message ?: result.message ?: "Send failed"))
        }
    }

    private suspend fun signMessage(sender: ActivityResultSender, message: String): Result<ClockProof> {
        val bytes = message.encodeToByteArray()
        return when (
            val result = adapter.transact(sender) { auth ->
                val key = accountKey(auth) ?: error("No account")
                signMessagesDetached(arrayOf(bytes), arrayOf(key))
            }
        ) {
            is TransactionResult.Success -> {
                remember(result.authResult.authToken)
                val signed = result.payload.messages.firstOrNull()
                    ?: return Result.failure(IllegalStateException("Wallet signed without a message"))
                val rawSig = signed.signatures.firstOrNull()
                    ?: return Result.failure(IllegalStateException("Wallet sent no signature"))
                val sig = Base58.encode(rawSig)
                if (sig.length < 32) return Result.failure(IllegalStateException("Wallet sent no signature"))
                val fromMsg = signed.addresses.firstOrNull()?.let { Base58.encode(it) }.orEmpty()
                val payer = fromMsg.ifBlank {
                    accountKey(result.authResult)?.let { Base58.encode(it) } ?: ""
                }
                if (payer.isBlank()) Result.failure(IllegalStateException("Wallet signed without account"))
                else Result.success(ClockProof(payer, sig, clusterName, "message", result.authResult.authToken ?: ""))
            }
            is TransactionResult.NoWalletFound ->
                Result.failure(IllegalStateException("No Seeker Wallet. Open Seed Vault Wallet once, then try again."))
            is TransactionResult.Failure ->
                Result.failure(IllegalStateException(result.e.message ?: result.message ?: "Sign failed"))
        }
    }

    private fun stopAfter(error: Throwable?): Boolean {
        val message = (error?.message ?: "").lowercase()
        return message.contains("no seeker") ||
            message.contains("no wallet") ||
            message.contains("declin") ||
            message.contains("reject") ||
            message.contains("cancel") ||
            message.contains("denied")
    }

    private fun accountKey(auth: MobileWalletAdapterClient.AuthorizationResult): ByteArray? {
        val accounts = auth.accounts
        if (accounts != null && accounts.isNotEmpty()) return accounts[0].publicKey
        return auth.publicKey
    }

    private suspend fun fetchBlockhash(): ByteArray = withContext(Dispatchers.IO) {
        val body = """{"jsonrpc":"2.0","id":1,"method":"getLatestBlockhash","params":[{"commitment":"confirmed"}]}"""
        val conn = (URL(rpcUrl).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            connectTimeout = 8000
            readTimeout = 8000
        }
        conn.outputStream.use { it.write(body.toByteArray()) }
        val text = conn.inputStream.bufferedReader().readText()
        val hash = JSONObject(text).getJSONObject("result").getJSONObject("value").getString("blockhash")
        Base58.decode(hash)
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
