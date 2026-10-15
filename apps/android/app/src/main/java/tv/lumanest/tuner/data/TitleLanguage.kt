package tv.lumanest.tuner.data

import java.text.Normalizer
import java.util.Locale

/**
 * Spots foreign-language titles when a provider labels nothing (its movie categories are plain genres
 * like "Action" and "Drama"). It only drops a title on clear evidence, so English films with a foreign
 * word in the name ("Destruction Las Vegas", "Van Helsing") stay:
 * - a release tag such as FRENCH, NORDIC, SUBBED or VOSTFR;
 * - with [functionWords], two or more foreign words ("Il Mio Posto e Qui"), or a foreign article or
 *   preposition with no English words at all ("Los Domingos").
 */
object TitleLanguage {
    // Upper-case on purpose: "French Fried Vacation" is an English film, "Invisibles FRENCH" is not.
    private val releaseTags = Regex(
        "\\b(?:NORDIC|FRENCH|TRUEFRENCH|SUBFRENCH|VOSTFR|VOF|VFI|VFF|VFQ|FLEMISH|GERMAN|GER|NORWEGIAN|DANISH|SWEDISH|" +
            "FINNISH|DUTCH|ITA|ITALIAN|SPANISH|LATINO|CASTELLANO|SUBBED|DKSUBS|NORDICSUBS|SWESUB|NLSUBS|HINDI|TAMIL|" +
            "TELUGU|KOREAN|JAPANESE|CHINESE|MANDARIN|CANTONESE|TURKISH|RUSSIAN|POLISH|PORTUGUESE|BRAZILIAN|ARABIC|PERSIAN)\\b",
    )

    /** Places and names that put Spanish, French or Dutch words into English titles. */
    private val englishPhrases = Regex(
        "\\b(?:las vegas|las cruces|los angeles|los alamos|el paso|el dorado|el camino|la la land|cirque du soleil|" +
            "del rio|del mar|del toro|del rey|des moines|du jour|de niro|da vinci|les miserables|les paul|van der|van den|van de|" +
            "von trapp)\\b",
    )

    private val english = words(
        """a an i the of and to in is it you that he was for on are with as his they at be this have from or one had by but not
        what all were we when your can said there use each which she do how their if will up other about out many then them these
        so some her would make like him into time has look two more write go see number no way could people my than first been
        call who its now find long down day did get come made may part over new after where back little only round man year came
        show every good me give our under name very through just""",
    )

    private val foreign = words(
        """el los las del una unos unas por para sin que mis tus sus cuando donde todo todos nada nunca siempre vida muerte
        noche hombre mujer mujeres hombres nino nina ninos corazon senor senora dios diablo ciudad mundo tiempo dias cielo tierra
        sangre fuego agua guerra rey reina hijo hija hijos padre madre hermano hermana amigos otra otro muy pero aqui esta este
        esto eso ese esa tengo quiero nuevo nueva viejo vieja perro gato bueno buena malo mala rojo negro blanco verde azul
        les des du une et aux sur sous dans pour avec sans mon mes ton tes ses nous vous ils elle elles sont pas qui quoi cette
        ces petit petite grande homme femme femmes fille filles fils vie amour nuit jour jours monde coeur belle beau mort morts
        vivre temps enfant enfants pere mere frere soeur ami amis maison ville roi dieu enfer ciel terre feu eau mer bleu
        bleue rouge noir noire blanc blanche il gli della delle dei degli nel nella nei negli che di sono uomo uomini donne
        amore vita notte morte mio mia miei tuo tua suo sua questo questa quello quella tutti tutto sempre mai anche ancora dove
        perche ragazzo ragazza ragazzi figlio figlia fratello sorella amico amici citta giorno giorni sangue fuoco acqua regina dio
        diavolo os um uma uns umas dos das nos nas em com sem pelo pela nao mais muito minha meu seu ele eles voce homem mulher
        noite der dem und ein eine einer einen einem mit von zum zur ins nicht ich wir ist sind auf fur aus bei nach uber unter
        liebe leben tod nacht mann frau kinder haus welt zeit ve bir ile icin gibi kadar ama cok daha nasil neden
        hayat olum gece kadin kiz cocuk dunya zaman yol kalp sevgi het een niet zijn och ett att med og ikke jeg yang dari
        untuk dengan ini itu aku cinta ang mga hai aur mein hum tum dil pyaar pyar""",
    ) - english

    /** Articles and prepositions: one of these with no English words is enough. */
    private val function = words(
        """el los las del una unos unas les des du une et aux sur dans pour avec sans il gli della delle dei degli nel nella
        der dem und ein eine einer einen einem mit het een och ve bir ile dos das uma nao com sem pelo pela que qui""",
    )

    private fun words(text: String): Set<String> = text.split(Regex("\\s+")).filter { it.isNotBlank() }.toSet()
    private val year = Regex("\\(\\d{4}\\)\\s*$")
    private val marks = Regex("\\p{Mn}+")
    private val tokens = Regex("[a-z']+")

    fun looksForeign(title: String, functionWords: Boolean = true): Boolean {
        if (releaseTags.containsMatchIn(title)) return true
        if (!functionWords) return false
        val folded = marks.replace(Normalizer.normalize(year.replace(title, ""), Normalizer.Form.NFKD), "").lowercase(Locale.ROOT)
        val all = tokens.findAll(englishPhrases.replace(folded, " ")).map { it.value.trim('\'') }.filter { it.isNotEmpty() }.toList()
        val foreignHits = all.filter { it in foreign }
        val englishHits = all.count { it in english }
        if (foreignHits.size >= 2 && foreignHits.size > englishHits) return true
        return foreignHits.size == 1 && englishHits == 0 && all.size >= 2 && foreignHits[0] in function
    }
}
