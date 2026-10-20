' Playback, subtitles and Continue watching. Live channels play as before; for movies and episodes the
' position is saved to the Library when playback stops, finishes, and every two minutes while it runs.
' Movies and episodes also get English subtitles from OpenSubtitles.com through lumanest.tv (docs/extras.md): looked
' up when the title starts, listed in the subtitle menu, and side-loaded on the video as SRT only while shown.

sub initPlayer()
    m.video.observeField("state", "onVideoState")
    m.video.observeField("availableSubtitleTracks", "onSubtitleTracks")
    m.video.observeField("position", "onVideoPosition")
    m.video.notificationInterval = 1
    m.subsList.observeField("itemSelected", "onSubtitleChosen")
    m.subOptions = []
    m.subPicked = false
    m.playing = invalid
    m.playReturn = invalid
    ' What the video plays ({url, title, live, format}), so the title can be loaded again with another subtitle track.
    m.playMeta = invalid
    m.playToken = 0
    m.startAt = 0
    ' The OpenSubtitles lookup of the title playing, {answer (invalid until known), waiting}; invalid for live channels.
    m.ext = invalid
    ' The OpenSubtitles track side-loaded on the video (one at a time), or invalid.
    m.extAttached = invalid
    ' An OpenSubtitles track the viewer chose, until Roku lists it: its URL, and the seconds of playback left to wait.
    m.subWanted = ""
    m.subWait = 0
    ' With Subtitles On, playback waits at most 1.5 seconds for the lookup, so its first track is on from the start.
    m.startTimer = CreateObject("roSGNode", "Timer")
    m.startTimer.duration = 1.5
    m.startTimer.repeat = false
    m.startTimer.observeField("fire", "onStartTimer")
end sub

function streamFormatOf(url as string) as string
    lower = LCase(url)
    if lower.InStr(".m3u8") >= 0 then return "hls"
    if lower.InStr(".mkv") >= 0 then return "mkv"
    if lower.InStr(".ts") >= 0 then return "ts"
    return "mp4"
end function

' tracking is invalid for live channels, or {kind: "movie" | "episode", key, episodes, epIndex} for the Library.
' query is the movie's or episode's subtitle lookup (subtitlesQuery), "" for none (live channels never look up).
sub playStream(url as string, title as string, live as boolean, startAt as integer, tracking as dynamic, returnTo as dynamic, query as string)
    if tracking <> invalid
        tracking.pos = startAt
        tracking.dur = 0
        tracking.savedAt = startAt
    end if
    m.playToken = m.playToken + 1
    m.playMeta = {url: url, title: title, live: live, format: streamFormatOf(url)}
    m.startAt = startAt
    m.playing = tracking
    m.playReturn = returnTo
    m.subPicked = false
    m.subWanted = ""
    m.extAttached = invalid
    m.ext = invalid
    applyCaptionMode()
    m.video.visible = true
    m.video.setFocus(true)
    if not live and query <> ""
        m.ext = {answer: lookupExtras("extrasSubtitles", query, m.playToken, "onSubtitlesAnswer"), waiting: false}
        if m.ext.answer = invalid and m.settings.subtitles
            m.ext.waiting = true
            m.startTimer.control = "start"
            return
        end if
    end if
    beginPlayback()
end sub

sub onStartTimer()
    if m.ext <> invalid and m.ext.waiting then beginPlayback()
end sub

' Starts the title: with Subtitles On, the first OpenSubtitles track (when the lookup has one) is on the video from
' the start, so the automatic choice can show it without loading the title again.
sub beginPlayback()
    m.startTimer.control = "stop"
    if m.ext <> invalid then m.ext.waiting = false
    track = invalid
    if m.settings.subtitles then track = firstExternalTrack()
    loadContent(m.startAt, track)
end sub

' Sets the video's content, starting at position (seconds), with track (an OpenSubtitles track) side-loaded or none,
' and plays it. Roku fetches a side-loaded file itself, so a track goes on only when it is to be shown.
sub loadContent(position as integer, track as dynamic)
    meta = m.playMeta
    content = CreateObject("roSGNode", "ContentNode")
    content.url = meta.url
    content.title = meta.title
    content.streamFormat = meta.format
    if meta.live then content.live = true
    if position > 0 then content.PlayStart = position
    m.extAttached = track
    if track <> invalid then content.SubtitleTracks = subtitleContentTracks(track)
    m.video.content = content
    m.video.control = "play"
end sub

' Where playback is, in whole seconds: the video's position, else the last one seen, else where it started.
function currentPosition() as integer
    position = Int(m.video.position)
    if position > 0 then return position
    if m.playing <> invalid and m.playing.pos > 0 then return m.playing.pos
    return m.startAt
end function

sub playLive(item as object, returnTo as object)
    playStream(item.url, item.name, true, 0, invalid, returnTo, "")
end sub

sub playTitle(item as object, startAt as integer, returnTo as object)
    url = asText(item.url)
    if url = "" then url = m.catalog.moviePrefix + item.id + "." + item.ext
    playStream(url, item.name, false, startAt, {kind: "movie", key: item.key}, returnTo, subtitlesQuery(titleSubtitlesRef(item, m.rx), m.rx))
end sub

sub playEpisode(index as integer, startAt as integer, returnTo as object)
    d = m.detail
    episode = d.episodes[index]
    query = subtitlesQuery(episodeSubtitlesRef(d.item, episode), m.rx)
    playStream(episode.url, d.item.name + "  ·  " + episode.name, false, startAt, {kind: "episode", key: d.item.key, episodes: d.episodes, epIndex: index}, returnTo, query)
end sub

sub onVideoPosition()
    if m.subWanted <> "" then waitForWantedTrack()
    p = m.playing
    if p = invalid then return
    position = m.video.position
    if position > 0 then p.pos = Int(position)
    duration = m.video.duration
    if duration > 0 then p.dur = Int(duration)
    if Abs(p.pos - p.savedAt) >= 120 then savePlayback(false)
end sub

' Writes where playback is to the Library. A finished episode makes the next one "up next".
sub savePlayback(finished as boolean)
    p = m.playing
    if p = invalid then return
    now = nowSeconds()
    position = p.pos
    duration = p.dur
    if finished and duration > 0 then position = duration
    if p.kind = "episode"
        done = finished or (duration > 0 and position >= duration * 0.95)
        if done
            nextIndex = p.epIndex + 1
            if nextIndex < p.episodes.Count()
                upNext = p.episodes[nextIndex]
                libraryRecordProgress(m.library, {k: p.key, e: upNext.id, l: upNext.label, n: nextIndex, p: 0, d: 0, nx: true}, now)
            else
                libraryRemoveProgress(m.library, p.key)
            end if
        else
            episode = p.episodes[p.epIndex]
            libraryRecordProgress(m.library, {k: p.key, e: episode.id, l: episode.label, n: p.epIndex, p: position, d: duration}, now)
        end if
    else if finished
        libraryRemoveProgress(m.library, p.key)
    else
        libraryRecordProgress(m.library, {k: p.key, p: position, d: duration}, now)
    end if
    if finished or position >= 15 then libraryRecordWatched(m.library, p.key, now)
    p.savedAt = position
    librarySave()
    m.homeDirty = true
    m.libraryDirty = true
    ' Discover and Search are not rebuilt, so their tiles of this title get the new progress bar here.
    syncProgressTiles(p.key)
end sub

sub stopVideo()
    savePlayback(false)
    closeVideo()
end sub

sub closeVideo()
    closeSubtitleMenu(false)
    m.startTimer.control = "stop"
    m.video.control = "stop"
    m.video.visible = false
    m.playing = invalid
    m.ext = invalid
    m.extAttached = invalid
    m.subWanted = ""
    if m.details.visible
        showEpisodes()
        buildDetailActions()
    end if
    target = m.playReturn
    m.playReturn = invalid
    if target <> invalid then target.setFocus(true) else focusNav()
end sub

sub onVideoState()
    state = m.video.state
    if state = "error"
        message = m.video.errorMsg
        live = m.playing = invalid
        savePlayback(false)
        closeVideo()
        if live then showToast("This channel couldn't be played. " + message) else showToast("This title couldn't be played. " + message)
    else if state = "finished"
        savePlayback(true)
        closeVideo()
    end if
end sub

' ------------------------------------------------------------------ subtitles
' Live HLS channels usually carry CEA-608 captions (tracks named "eia608/1" and so on), which Roku
' draws itself when globalCaptionMode is On. Movies and episodes can carry text subtitle tracks, and get up to three
' English tracks from OpenSubtitles.com (docs/extras.md). Roku draws every track itself, as plain text, in step with
' the video's position, in the viewer's caption style.

sub applyCaptionMode()
    ' Never suppress captions; whether they show is decided by globalCaptionMode and subtitleTrack.
    m.video.suppressCaptions = false
    if m.settings.subtitles
        m.video.globalCaptionMode = "On"
    else
        m.video.globalCaptionMode = "Off"
    end if
end sub

function subtitleTracks() as object
    tracks = m.video.availableSubtitleTracks
    if type(tracks) <> "roArray" then return []
    return tracks
end function

' The OpenSubtitles tracks of the title playing ([] while the lookup runs, after a failure, and for live channels).
function externalTracks() as object
    if m.ext = invalid or m.ext.answer = invalid then return []
    return arrayOrEmpty(m.ext.answer.tracks)
end function

function firstExternalTrack() as dynamic
    tracks = externalTracks()
    if tracks.Count() = 0 then return invalid
    return tracks[0]
end function

function attachedUrl() as string
    if m.extAttached = invalid then return ""
    return m.extAttached.srt
end function

function hasTrackNamed(tracks as object, name as string) as boolean
    for each track in tracks
        if isAssoc(track) and trackName(track) = name then return true
    end for
    return false
end function

' Picks a track each time the video reports its tracks (ExtrasLogic, pickSubtitleTrack): the stream's own track in
' the language chosen last time, then in English, then the side-loaded OpenSubtitles track, then the first track.
' A track the viewer chose stays chosen; an OpenSubtitles one is shown as soon as Roku lists it.
sub onSubtitleTracks()
    tracks = subtitleTracks()
    if m.subWanted <> ""
        if hasTrackNamed(tracks, m.subWanted)
            m.video.subtitleTrack = m.subWanted
            m.subWanted = ""
        end if
    else if m.settings.subtitles and not m.subPicked
        track = pickSubtitleTrack(tracks, attachedUrl(), m.settings.subLang)
        if track <> invalid then m.video.subtitleTrack = trackName(track)
    end if
    if m.subs.visible then showSubtitleMenu()
end sub

sub onSubtitlesAnswer(event as object)
    finishTask(event)
    r = event.getData()
    rememberExtras(r)
    if m.ext = invalid or r.token <> m.playToken then return
    answer = invalid
    if r.ok then answer = r.data
    ' A failed lookup (no answer, not_configured and the like) means no OpenSubtitles tracks, silently.
    if answer = invalid then answer = {status: "", tracks: [], credit: extrasCredit()}
    m.ext.answer = answer
    if m.ext.waiting
        beginPlayback()
    else
        attachLate()
    end if
    if m.subs.visible then showSubtitleMenu()
end sub

' The lookup answered after playback started (it took over 1.5 seconds). With Subtitles On, its first track goes on
' now, by loading the title again at its position, unless the stream has its own track to show or the viewer chose.
sub attachLate()
    track = firstExternalTrack()
    if track = invalid or not m.settings.subtitles or m.subPicked or m.extAttached <> invalid then return
    if preferredOwnTrack(subtitleTracks(), "", m.settings.subLang) <> invalid then return
    loadContent(currentPosition(), track)
end sub

' A chosen OpenSubtitles track Roku hasn't listed after 12 seconds of playback couldn't be loaded: subtitles go off
' for this title with a short message (docs/extras.md, Failure).
sub waitForWantedTrack()
    m.subWait = m.subWait - 1
    if m.subWait > 0 then return
    m.subWanted = ""
    m.video.globalCaptionMode = "Off"
    if m.subs.visible then showSubtitleMenu()
    showToast("These subtitles couldn't be loaded.")
end sub

function languageName(code as string) as string
    names = {en: "English", eng: "English", es: "Spanish", spa: "Spanish", fr: "French", fre: "French", fra: "French", de: "German", ger: "German", deu: "German", it: "Italian", ita: "Italian", pt: "Portuguese", por: "Portuguese", ar: "Arabic", ara: "Arabic", ru: "Russian", rus: "Russian", tr: "Turkish", tur: "Turkish", nl: "Dutch", dut: "Dutch", nld: "Dutch", pl: "Polish", pol: "Polish", hi: "Hindi", hin: "Hindi", zh: "Chinese", chi: "Chinese", zho: "Chinese", ja: "Japanese", jpn: "Japanese", ko: "Korean", kor: "Korean"}
    lower = LCase(code)
    if names.DoesExist(lower) then return names[lower]
    if isEnglish(lower) then return "English"
    return code
end function

function trackLabel(track as object, index as integer) as string
    name = trackName(track)
    lower = LCase(name)
    lang = languageName(trackField(track, "Language"))
    desc = trackField(track, "Description")
    label = lang
    if desc <> "" and LCase(desc) <> LCase(lang)
        if label = "" then label = desc else label = label + " · " + desc
    end if
    if Left(lower, 7) = "eia608/" or Left(lower, 7) = "eia708/"
        cc = "CC" + Mid(name, 8)
        if label = "" then label = cc else label = label + " (" + cc + ")"
    end if
    if label = "" then label = "Track " + (index + 1).ToStr()
    return label
end function

' Off, the stream's own tracks, then the OpenSubtitles tracks with their labels and, under them, the credit line
' (a note, not a choice). A stream with neither offers broadcast captions (CC), as before.
sub showSubtitleMenu()
    tracks = subtitleTracks()
    ext = externalTracks()
    own = ownSubtitleTracks(tracks, ext)
    current = m.video.subtitleTrack
    captionsOn = m.video.globalCaptionMode <> "Off"
    m.subOptions = [{action: "off", label: "Off"}]
    labels = ["Off"]
    if not captionsOn then labels[0] = "Off (current)"
    if own.Count() = 0 and ext.Count() = 0
        m.subsNote.text = "No subtitles in this stream. Broadcast captions (CC), if the channel sends them, show when you turn them on."
        m.subOptions.Push({action: "on", label: "broadcast captions"})
        if captionsOn then labels.Push("On: broadcast captions (current)") else labels.Push("On: broadcast captions")
    else
        m.subsNote.text = "Choose a subtitle track."
        for i = 0 to own.Count() - 1
            track = own[i]
            label = trackLabel(track, i)
            m.subOptions.Push({action: "track", track: track, label: label})
            if captionsOn and trackName(track) = current then label = label + " (current)"
            labels.Push(label)
        end for
        for each track in ext
            label = track.label
            m.subOptions.Push({action: "ext", track: track, label: label})
            if captionsOn and (track.srt = current or track.srt = m.subWanted) then label = label + " (current)"
            labels.Push(label)
        end for
    end if
    m.subsCredit.text = ""
    if ext.Count() > 0 then m.subsCredit.text = m.ext.answer.credit
    setList(m.subsList, labels)
    m.subs.visible = true
    m.subsList.setFocus(true)
end sub

sub closeSubtitleMenu(refocus as boolean)
    if not m.subs.visible then return
    m.subs.visible = false
    if refocus and m.video.visible then m.video.setFocus(true)
end sub

sub onSubtitleChosen()
    if not m.subs.visible then return
    index = m.subsList.itemSelected
    if index < 0 or index >= m.subOptions.Count() then return
    option = m.subOptions[index]
    m.subPicked = true
    m.subWanted = ""
    if option.action = "off"
        setSubtitles(false)
        showToast("Subtitles off.")
    else if option.action = "on"
        setSubtitles(true)
        showToast("Captions on. They appear when the channel sends them.")
    else if option.action = "ext"
        setSubtitles(true)
        rememberSubtitleLanguage("eng")
        showExternalTrack(option.track)
        showToast("Subtitles: " + option.label + ".")
    else
        setSubtitles(true)
        m.video.subtitleTrack = trackName(option.track)
        rememberSubtitleLanguage(LCase(trackField(option.track, "Language")))
        showToast("Subtitles: " + option.label + ".")
    end if
    closeSubtitleMenu(true)
end sub

sub rememberSubtitleLanguage(lang as string)
    if lang = "" then return
    m.settings.subLang = lang
    m.reg.Write("subLang", lang)
    m.reg.Flush()
end sub

' Shows an OpenSubtitles track the viewer chose: at once when it is the one on the video and Roku lists it, else once
' Roku lists it, after loading the title again at its position with that track side-loaded when another (or none)
' was on. The file is fetched only now, when it is to be shown.
sub showExternalTrack(track as object)
    if attachedUrl() = track.srt and hasTrackNamed(subtitleTracks(), track.srt)
        m.video.subtitleTrack = track.srt
        return
    end if
    m.subWanted = track.srt
    m.subWait = 12
    if attachedUrl() <> track.srt then loadContent(currentPosition(), track)
end sub

sub setSubtitles(enabled as boolean)
    m.settings.subtitles = enabled
    if enabled then m.reg.Write("subtitles", "1") else m.reg.Write("subtitles", "0")
    m.reg.Flush()
    applyCaptionMode()
end sub
