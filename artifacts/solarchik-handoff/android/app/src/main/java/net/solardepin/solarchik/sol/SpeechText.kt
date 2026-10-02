package net.solardepin.solarchik.sol

/**
 * 0.21.9: what the voice reads, not what the bubble shows. "Bitcoin-вікна #11" was read as "Bitcoin
 * Вікна Коло 11": `#` / `№` become "номер" / "number", a hyphen between words becomes a pause, markdown,
 * arrows, emoji and other symbols are not read aloud. The chat bubble keeps the display text. Same rules
 * as the worker's `speakable()` (applied again there; running both is harmless).
 */
object SpeechText {
    private val NUMBER_SIGN = Regex("[#№]\\s*(\\d+)")
    private val WORD_HYPHEN = Regex("(?<=\\p{L})-(?=\\p{L})")
    private val MARKDOWN = Regex("[*_`~<>|\\[\\]{}^\\\\]+")
    private val LINK = Regex("https?://\\S+")
    private val SYMBOLS = Regex("[[\\p{So}&&[^°]]\\p{Sk}\\p{Cs}\\u2190-\\u21FF\\u2600-\\u27BF\\uFE0F\\u200D#№•·→←↑↓]")
    private val SPACES = Regex("\\s+")
    private val SPACE_PUNCT = Regex("\\s+([,.!?:;])")

    fun speakable(text: String, lang: String): String {
        val word = if (lang == "uk") "номер" else "number"
        var t = text
        t = LINK.replace(t, "")
        t = NUMBER_SIGN.replace(t) { "$word ${it.groupValues[1]}" }
        t = WORD_HYPHEN.replace(t, " ")
        t = MARKDOWN.replace(t, " ")
        t = SYMBOLS.replace(t, " ")
        t = SPACES.replace(t, " ")
        t = SPACE_PUNCT.replace(t, "$1")
        return t.trim()
    }
}
