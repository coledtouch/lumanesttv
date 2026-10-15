package tv.lumanest.tuner.data

/**
 * Free regional XMLTV guides from epgshare01.online, used for channels the provider's own
 * guide doesn't cover. Sizes are the compressed download.
 */
object FreeEpg {
    data class Region(val code: String, val name: String, val size: String)

    val regions = listOf(
        Region("US2", "United States · national", "6 MB"),
        Region("US_SPORTS1", "United States · sports", "0.2 MB"),
        Region("US_LOCALS1", "United States · local stations", "55 MB"),
        Region("CA2", "Canada", "6.5 MB"),
        Region("UK1", "United Kingdom", "2.8 MB"),
        Region("IE1", "Ireland", "2.5 MB"),
        Region("AU1", "Australia", "4.2 MB"),
        Region("NZ1", "New Zealand", "0.4 MB"),
        Region("MX1", "Mexico", "0.4 MB"),
        Region("IN1", "India", "4 MB"),
        Region("DE1", "Germany", "4.1 MB"),
        Region("FR1", "France", "5.2 MB"),
        Region("ES1", "Spain", "3.2 MB"),
        Region("IT1", "Italy", "1.6 MB"),
        Region("NL1", "Netherlands", "1.9 MB"),
        Region("PT1", "Portugal", "1.6 MB"),
        Region("PLEX1", "Plex free channels", "4.6 MB"),
        Region("RAKUTEN1", "Rakuten TV channels", "9.6 MB"),
        Region("PEACOCK1", "Peacock channels", "0.1 MB"),
        Region("DISTROTV1", "DistroTV", "0.1 MB"),
    )

    val defaults = listOf("US2", "US_SPORTS1")

    fun url(code: String) = "https://epgshare01.online/epgshare01/epg_ripper_$code.xml.gz"
}
