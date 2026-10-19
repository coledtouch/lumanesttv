' Playback, subtitles and Continue watching. Live channels play as before; for movies and episodes the
' position is saved to the Library when playback stops, finishes, and every two minutes while it runs.

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
end sub

' tracking is invalid for live channels, or {kind: "movie" | "episode", key, episodes, epIndex} for the Library.
sub playStream(url as string, title as string, live as boolean, startAt as integer, tracking as dynamic, returnTo as dynamic)
    content = CreateObject("roSGNode", "ContentNode")
    content.url = url
    content.title = title
    lower = LCase(url)
    if lower.InStr(".m3u8") >= 0
        content.streamFormat = "hls"
    else if lower.InStr(".mkv") >= 0
        content.streamFormat = "mkv"
    else if lower.InStr(".ts") >= 0
        content.streamFormat = "ts"
    else
        content.streamFormat = "mp4"
    end if
    if live then content.live = true
    if startAt > 0 then content.PlayStart = startAt
    if tracking <> invalid
        tracking.pos = startAt
        tracking.dur = 0
        tracking.savedAt = startAt
    end if
    m.playing = tracking
    m.playReturn = returnTo
    m.subPicked = false
    applyCaptionMode()
    m.video.content = content
    m.video.visible = true
    m.video.control = "play"
    m.video.setFocus(true)
end sub

sub playLive(item as object, returnTo as object)
    playStream(item.url, item.name, true, 0, invalid, returnTo)
end sub

sub playTitle(item as object, startAt as integer, returnTo as object)
    url = asText(item.url)
    if url = "" then url = m.catalog.moviePrefix + item.id + "." + item.ext
    playStream(url, item.name, false, startAt, {kind: "movie", key: item.key}, returnTo)
end sub

sub playEpisode(index as integer, startAt as integer, returnTo as object)
    d = m.detail
    episode = d.episodes[index]
    playStream(episode.url, d.item.name + "  ·  " + episode.name, false, startAt, {kind: "episode", key: d.item.key, episodes: d.episodes, epIndex: index}, returnTo)
end sub

sub onVideoPosition()
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
    m.video.control = "stop"
    m.video.visible = false
    m.playing = invalid
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
' draws itself when globalCaptionMode is On. Movies and episodes can carry text subtitle tracks.

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

' Picks a track once the stream reports its tracks: the language chosen last time, then English, then the first.
sub onSubtitleTracks()
    if not m.settings.subtitles or m.subPicked then return
    track = preferredTrack(subtitleTracks())
    if track <> invalid then m.video.subtitleTrack = trackName(track)
    if m.subs.visible then showSubtitleMenu()
end sub

function preferredTrack(tracks as object) as dynamic
    if tracks.Count() = 0 then return invalid
    if m.settings.subLang <> ""
        for each track in tracks
            if LCase(trackField(track, "Language")) = m.settings.subLang then return track
        end for
    end if
    for each track in tracks
        if isEnglish(trackField(track, "Language")) then return track
    end for
    return tracks[0]
end function

function isEnglish(code as string) as boolean
    lower = LCase(code)
    return lower = "en" or lower = "eng" or Left(lower, 3) = "en-" or Left(lower, 3) = "en_" or lower = "english"
end function

function trackField(track as object, name as string) as string
    v = track[name]
    if v = invalid then return ""
    if type(v) = "roString" or type(v) = "String" then return v
    return ""
end function

function trackName(track as object) as string
    return trackField(track, "TrackName")
end function

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

sub showSubtitleMenu()
    tracks = subtitleTracks()
    current = m.video.subtitleTrack
    captionsOn = m.video.globalCaptionMode <> "Off"
    m.subOptions = [{action: "off"}]
    labels = ["Off"]
    if not captionsOn then labels[0] = "Off (current)"
    if tracks.Count() = 0
        m.subsNote.text = "No subtitles in this stream. Broadcast captions (CC), if the channel sends them, show when you turn them on."
        m.subOptions.Push({action: "on"})
        if captionsOn then labels.Push("On: broadcast captions (current)") else labels.Push("On: broadcast captions")
    else
        m.subsNote.text = "Choose a subtitle track."
        for i = 0 to tracks.Count() - 1
            track = tracks[i]
            label = trackLabel(track, i)
            if captionsOn and trackName(track) = current then label = label + " (current)"
            m.subOptions.Push({action: "track", track: track})
            labels.Push(label)
        end for
    end if
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
    if option.action = "off"
        setSubtitles(false)
        showToast("Subtitles off.")
    else if option.action = "on"
        setSubtitles(true)
        showToast("Captions on. They appear when the channel sends them.")
    else
        setSubtitles(true)
        m.video.subtitleTrack = trackName(option.track)
        lang = LCase(trackField(option.track, "Language"))
        if lang <> ""
            m.settings.subLang = lang
            m.reg.Write("subLang", lang)
            m.reg.Flush()
        end if
        showToast("Subtitles: " + trackLabel(option.track, index - 1) + ".")
    end if
    closeSubtitleMenu(true)
end sub

sub setSubtitles(enabled as boolean)
    m.settings.subtitles = enabled
    if enabled then m.reg.Write("subtitles", "1") else m.reg.Write("subtitles", "0")
    m.reg.Flush()
    applyCaptionMode()
end sub
