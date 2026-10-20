' Subtitles and trailers through lumanest.tv (docs/extras.md): the lookups, kept for the app's session, the Trailer
' action on a details page and its QR dialog. The rules are in source/lib/ExtrasLogic.brs; the player's side
' (OpenSubtitles tracks in the subtitle menu and on the video) is in Player.brs. The app never calls OpenSubtitles or
' TMDB, and no key reaches the TV.

sub initExtras()
    m.extras = extrasCacheNew()
    m.trailerView = m.top.findNode("trailer")
    m.trailerQr = m.top.findNode("trailerQr")
    m.trailerQrBox = m.top.findNode("trailerQrBox")
    m.trailerShort = m.top.findNode("trailerShort")
    m.trailerClose = m.top.findNode("trailerClose")
    setList(m.trailerClose, ["Close"])
    m.trailerClose.observeField("itemSelected", "closeTrailer")
end sub

' A lookup's answer when this session already has it. Otherwise starts the request (mode extrasSubtitles or
' extrasTrailer in ApiTask) and returns invalid; handler then gets the task's response. query "" asks nothing.
function lookupExtras(mode as string, query as string, token as integer, handler as string) as dynamic
    if query = "" then return invalid
    path = "api/extras/subtitles?"
    if mode = "extrasTrailer" then path = "api/extras/trailer?"
    url = extrasBase() + path + query
    answer = extrasRecall(m.extras, url)
    if answer <> invalid then return answer
    runTask({mode: mode, url: url, token: token}, handler)
    return invalid
end function

' Keeps a finished lookup's answer for the session. Failures are not kept: the next title, or opening this one
' again, asks again.
sub rememberExtras(r as object)
    if r.ok and r.data <> invalid and r.url <> invalid then extrasRemember(m.extras, r.url, r.data)
end sub

' ------------------------------------------------------------------ Trailer

' Called when a movie or series page opens: one lookup (or the session's answer). Trailer is listed only once a
' trailer is known, after Add to Library, so it never moves the focused action.
sub requestTrailer()
    d = m.detail
    if d = invalid then return
    d.trailer = invalid
    answer = lookupExtras("extrasTrailer", trailerQuery(trailerRef(d.item), m.rx), m.detailToken, "onTrailerAnswer")
    if answer <> invalid then d.trailer = answer.trailer
end sub

sub onTrailerAnswer(event as object)
    finishTask(event)
    r = event.getData()
    rememberExtras(r)
    d = m.detail
    if d = invalid or r.token <> m.detailToken or not r.ok or r.data = invalid then return
    d.trailer = r.data.trailer
    if d.trailer <> invalid then buildDetailActions()
end sub

' Trailer always shows the QR dialog on Roku: a channel can't reliably open the YouTube channel on a video.
sub showTrailer(trailer as dynamic)
    if trailer = invalid then return
    rows = trailer.qr
    if type(rows) <> "roArray" then rows = []
    drawQr(m.trailerQr, rows, 480)
    ' Without a usable code the link under it is still there to type.
    m.trailerQrBox.visible = rows.Count() > 0
    m.trailerShort.text = trailer.short
    m.trailerView.visible = true
    m.trailerClose.jumpToItem = 0
    m.trailerClose.setFocus(true)
end sub

' Close (OK) or Back: focus goes back to Trailer, which the actions list still has focused.
sub closeTrailer()
    if not m.trailerView.visible then return
    m.trailerView.visible = false
    m.trailerQr.removeChildrenIndex(m.trailerQr.getChildCount(), 0)
    if m.details.visible then m.detailsActions.setFocus(true) else focusNav()
end sub

function trailerKey(key as string) as boolean
    if key = "back" or key = "options"
        closeTrailer()
    end if
    ' Nothing under the dialog moves while it is open.
    return true
end function
