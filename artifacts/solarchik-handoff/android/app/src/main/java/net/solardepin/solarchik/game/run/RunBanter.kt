package net.solardepin.solarchik.game.run

import kotlin.random.Random

/** Port of the web runBanter.ts (EN/UK packs): fallback lines when the AI friend is offline. */
enum class BanterKind { GO, CHAPTER, COMBO, GOLD, HURT, DEAD, BONUS, GRIND, SHIELD, BOSS }

/** Scripted captions (string resources), web scriptedBanter keys. */
enum class ScriptLine { CLOCK_READY, FIRST_ROOF, LAST_HEART }

object RunBanter {
    private val EN = mapOf(
        BanterKind.GO to listOf("Let's go. I'm with you on the roofs.", "Start jumping. I've got your back."),
        BanterKind.CHAPTER to listOf("New rooftops ahead. Watch your step.", "The roofs changed. Stay steady."),
        BanterKind.COMBO to listOf("Nice streak. Keep that pace.", "Good rhythm. Don't rush the next jump."),
        BanterKind.GOLD to listOf("You caught a gold sun. Well done."),
        BanterKind.HURT to listOf("Careful. You still have hearts left.", "That hit hurt. Jump a little earlier."),
        BanterKind.DEAD to listOf("That's okay. We can run it again.", "We fell. Take a breath, then retry."),
        BanterKind.BONUS to listOf("We're flying. Grab the suns."),
        BanterKind.GRIND to listOf("Nice grind on the wire. Keep balanced."),
        BanterKind.SHIELD to listOf("Shield is on. You can take one hit."),
        BanterKind.BOSS to listOf("Big one ahead. Jump and stomp it."),
    )
    private val UK = mapOf(
        BanterKind.GO to listOf("Поїхали. Я з тобою на дахах.", "Починай стрибати. Я поруч."),
        BanterKind.CHAPTER to listOf("Нові дахи попереду. Дивись під ноги.", "Дахи змінились. Тримай рівновагу."),
        BanterKind.COMBO to listOf("Гарний темп. Тримай його.", "Добрий ритм. Не поспішай наступний стрибок."),
        BanterKind.GOLD to listOf("Золоте сонце. Гарна робота."),
        BanterKind.HURT to listOf("Обережно. Ще є серця.", "Вдарило. Стрибай трохи раніше."),
        BanterKind.DEAD to listOf("Нічого. Можемо пробігти ще раз.", "Впали. Переведи подих і ще раз."),
        BanterKind.BONUS to listOf("Летимо. Збирай жовті сонця."),
        BanterKind.GRIND to listOf("Гарний слайд по дроту. Тримай баланс."),
        BanterKind.SHIELD to listOf("Щит увімкнений. Можна витримати один удар."),
        BanterKind.BOSS to listOf("Великий попереду. Стрибни і натисни зверху."),
    )
    private val CH_EN = mapOf(
        ChapterId.VILLAGE to "Solar district. Glass canopies crack, keep moving.",
        ChapterId.STORM to "Storm line. Watch the cables and the wind.",
        ChapterId.NIGHT to "Night city. Follow the window lights.",
        ChapterId.SERPENT to "High roofs now. Every gap counts.",
    )
    private val CH_UK = mapOf(
        ChapterId.VILLAGE to "Сонячний квартал. Скляні навіси тріскають, не зупиняйся.",
        ChapterId.STORM to "Лінія шторму. Стеж за кабелями і вітром.",
        ChapterId.NIGHT to "Нічне місто. Тримайся вогнів у вікнах.",
        ChapterId.SERPENT to "Високі дахи. Кожен проліт важливий.",
    )

    private var lastLine = ""

    fun pool(kind: BanterKind, lang: String, chapter: ChapterId?): List<String> {
        val uk = lang == "uk"
        if (kind == BanterKind.CHAPTER && chapter != null) {
            (if (uk) CH_UK else CH_EN)[chapter]?.let { return listOf(it) }
        }
        return (if (uk) UK else EN)[kind].orEmpty()
    }

    fun pick(kind: BanterKind, lang: String, chapter: ChapterId?, rnd: Random = Random.Default): String {
        val all = pool(kind, lang, chapter)
        val list = all.filter { it.isNotEmpty() && it != lastLine }.ifEmpty { all }
        val line = if (list.isEmpty()) "" else list[rnd.nextInt(list.size)]
        lastLine = line
        return line
    }

    /** web scriptedBanter(state, events). [lastHeartSaid] is the run's one-shot flag. */
    fun scripted(meters: Double, death: DeathKind, hearts: Int, events: List<Ev>, goal: Int, lastHeartSaid: Boolean): ScriptLine? {
        if (Ev.CLOCK in events) return ScriptLine.CLOCK_READY
        if (Ev.DEAD in events) {
            if (death == DeathKind.FALL && meters < 200) return ScriptLine.FIRST_ROOF
            if (meters >= goal) return ScriptLine.CLOCK_READY
        }
        if (Ev.HURT in events && hearts == 1 && !lastHeartSaid) return ScriptLine.LAST_HEART
        return null
    }

    fun eventToBanter(ev: Ev): BanterKind? = if (ev == Ev.DEAD) BanterKind.DEAD else null

    fun context(meters: Int, chapter: ChapterId, combo: Int, suns: Int, hearts: Int): String =
        "${meters}m ${chapter.name.lowercase()} combo $combo suns $suns hearts $hearts"

    fun periodicKind(bonus: Boolean, combo: Int, hearts: Int): BanterKind = when {
        bonus -> BanterKind.BONUS
        combo >= 4 -> BanterKind.COMBO
        hearts <= 1 -> BanterKind.HURT
        else -> BanterKind.CHAPTER
    }
}
