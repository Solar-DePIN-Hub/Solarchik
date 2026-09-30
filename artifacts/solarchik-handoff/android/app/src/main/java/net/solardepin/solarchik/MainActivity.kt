package net.solardepin.solarchik

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import com.solana.mobilewalletadapter.clientlib.ActivityResultSender
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import net.solardepin.solarchik.game.GameSave
import net.solardepin.solarchik.game.RunActivity
import net.solardepin.solarchik.wallet.SolanaWallet

class MainActivity : ComponentActivity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var wallet: SolanaWallet
    private lateinit var sender: ActivityResultSender
    private lateinit var save: GameSave
    private var signing = false

    private val runLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        render()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        sender = ActivityResultSender(this)
        wallet = SolanaWallet(this)
        save = GameSave(this)
        findViewById<Button>(R.id.run).setOnClickListener {
            runLauncher.launch(Intent(this, RunActivity::class.java))
        }
        findViewById<Button>(R.id.clock).setOnClickListener { clockIn() }
        findViewById<TextView>(R.id.proof).setOnClickListener { openProof() }
        render()
    }

    override fun onResume() {
        super.onResume()
        render()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private fun render() {
        val clocked = save.clockedToday()
        val signed = save.signedToday()
        findViewById<TextView>(R.id.stats).text = buildString {
            append("Останній забіг  ${save.lastDistance} м\n")
            append("Найкращий  ${save.bestDistance} м\n")
            append("Очки  ${save.lastScore}   streak ${save.streak}\n")
            append("Мережа  ${wallet.clusterName}\n")
            append("Стек  Solana Mobile · MWA")
        }
        val clock = findViewById<Button>(R.id.clock)
        clock.isEnabled = clocked && !signed && !signing
        clock.text = when {
            signing -> "Підпис…"
            signed -> "Підписано сьогодні"
            clocked -> "CLOCK IN"
            else -> "Спочатку 1200 м"
        }
        findViewById<TextView>(R.id.status).text = when {
            signed && save.clockKind == "tx" -> "Транзакція на ${save.clockCluster}"
            signed && save.clockKind == "message" -> "Підпис повідомлення · ${save.clockCluster}"
            clocked -> "Забіг зараховано. Підпиши день у Seed Vault."
            else -> "Пробіжи 1200 м, потім CLOCK IN відкриє гаманець."
        }
        findViewById<TextView>(R.id.proof).text = when {
            save.clockSig.isBlank() -> ""
            save.clockKind == "message" -> shortSig(save.clockSig) + " · підпис"
            else -> shortSig(save.clockSig) + " · explorer"
        }
    }

    private fun clockIn() {
        if (!save.clockedToday() || save.signedToday() || signing) return
        signing = true
        render()
        scope.launch {
            val proof = wallet.clockInOnChain(sender, save.lastDistance, save.lastScore, save.streak)
            signing = false
            proof.onSuccess {
                save.stampClock(it.address, it.signature, it.cluster, it.kind)
            }.onFailure {
                findViewById<TextView>(R.id.status).text = it.message ?: "Гаманець не підписав. День не поставлено."
                findViewById<Button>(R.id.clock).isEnabled = save.clockedToday() && !save.signedToday()
                findViewById<Button>(R.id.clock).text = "CLOCK IN"
                return@launch
            }
            render()
        }
    }

    private fun openProof() {
        if (save.clockKind != "tx" || save.clockSig.isBlank()) return
        val url = if (save.clockCluster == "devnet") {
            "https://explorer.solana.com/tx/${save.clockSig}?cluster=devnet"
        } else {
            "https://explorer.solana.com/tx/${save.clockSig}"
        }
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
    }

    private fun shortSig(sig: String): String {
        if (sig.length < 12) return sig
        return sig.take(4) + "…" + sig.takeLast(4)
    }
}
