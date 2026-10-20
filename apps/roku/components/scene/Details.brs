' Details for one movie or series: Play or Resume, Add to / Remove from Library, Trailer when lumanest.tv has one
' (Extras.brs), and a series' episodes.

sub initDetails()
    m.detailsActions.observeField("itemSelected", "onDetailAction")
    m.detailsEpisodes.observeField("itemSelected", "onEpisodeChosen")
    m.detail = invalid
    m.detailToken = 0
    m.detailActionsData = []
end sub

sub openDetails(refType as string, idx as integer, from as dynamic)
    item = catalogItem(refType, idx)
    if item = invalid then return
    m.detailToken = m.detailToken + 1
    m.detail = {type: refType, idx: idx, item: item, episodes: invalid, loading: false, from: from, trailer: invalid}
    m.detailsTitle.text = item.name
    m.detailsTileName.text = item.name
    m.detailsPoster.uri = item.icon
    m.detailsBackdrop.uri = item.icon
    m.detailsMeta.text = titleMeta(item)
    m.detailsPlot.text = ""
    isSeries = item.kind = "series"
    m.episodesTitle.visible = isSeries
    m.detailsEpisodes.visible = isSeries
    if isSeries
        m.detail.loading = true
        setList(m.detailsEpisodes, ["Loading episodes…"])
        runTask({mode: "seriesInfo", account: m.account, seriesId: item.id, token: m.detailToken}, "onDetailSeries")
        m.detailsHint.text = "OK chooses  ·  Right shows the episodes  ·  * adds to or removes from your Library  ·  Back returns"
    else
        setList(m.detailsEpisodes, [])
        if item.kind = "movie" and item.id <> "" then runTask({mode: "vodInfo", account: m.account, streamId: item.id, token: m.detailToken}, "onDetailMovie")
        m.detailsHint.text = "OK chooses  ·  * adds to or removes from your Library  ·  Back returns"
    end if
    requestTrailer()
    buildDetailActions()
    m.shell.visible = false
    m.details.visible = true
    m.detailsActions.jumpToItem = 0
    m.detailsActions.setFocus(true)
end sub

sub closeDetails()
    from = invalid
    if m.detail <> invalid then from = m.detail.from
    m.detail = invalid
    m.details.visible = false
    m.shell.visible = true
    ' Progress or the Library may have changed while the details were open.
    if m.section = "home" and m.homeDirty then buildHome()
    if m.section = "library" and m.libraryDirty then buildLibrary()
    if from <> invalid and contentCount(from) > 0 then focusOn(from) else focusNav()
    ' The focused title's line ("42:10 left", "In your Library") may have changed too.
    describeFocused()
end sub

sub onDetailMovie(event as object)
    finishTask(event)
    r = event.getData()
    if m.detail = invalid or r.token <> m.detailToken or not r.ok then return
    m.detailsPlot.text = r.data.plot
end sub

sub onDetailSeries(event as object)
    finishTask(event)
    r = event.getData()
    if m.detail = invalid or r.token <> m.detailToken then return
    m.detail.loading = false
    m.detail.episodes = []
    if r.ok
        m.detail.episodes = r.data.episodes
        m.detailsPlot.text = r.data.plot
    end if
    showEpisodes()
    buildDetailActions()
end sub

' The episode Continue watching points at, or -1.
function progressEpisode(episodes as object, entry as dynamic) as integer
    if entry = invalid then return -1
    id = asText(entry.e)
    for i = 0 to episodes.Count() - 1
        if episodes[i].id = id then return i
    end for
    n = Int(numberOf(entry.n))
    if n >= 0 and n < episodes.Count() then return n
    return -1
end function

sub showEpisodes()
    d = m.detail
    if d = invalid or d.episodes = invalid then return
    if d.episodes.Count() = 0
        setList(m.detailsEpisodes, ["No episodes are available for this series."])
        return
    end if
    entry = m.progByKey[d.item.key]
    current = progressEpisode(d.episodes, entry)
    labels = []
    for i = 0 to d.episodes.Count() - 1
        label = d.episodes[i].name
        if i = current
            if isTrueValue(entry.nx) then label = label + "  ·  up next" else label = label + "  ·  in progress"
        end if
        labels.Push(label)
    end for
    focus = m.detailsEpisodes.itemFocused
    setList(m.detailsEpisodes, labels)
    if focus > 0 and focus < labels.Count()
        m.detailsEpisodes.jumpToItem = focus
    else if current > 0
        m.detailsEpisodes.jumpToItem = current
    end if
end sub

sub buildDetailActions()
    d = m.detail
    if d = invalid then return
    item = d.item
    entry = m.progByKey[item.key]
    actions = []
    if item.kind = "series"
        if d.loading
            actions.Push({id: "wait", label: "Loading episodes…"})
        else if d.episodes = invalid or d.episodes.Count() = 0
            actions.Push({id: "wait", label: "No episodes available"})
        else
            n = progressEpisode(d.episodes, entry)
            if n >= 0 and isTrueValue(entry.nx)
                actions.Push({id: "episode", ep: n, start: 0, label: "Play next: " + d.episodes[n].label})
            else if n >= 0
                position = Int(numberOf(entry.p))
                actions.Push({id: "episode", ep: n, start: position, label: "Resume " + d.episodes[n].label + " at " + clockText(position)})
                actions.Push({id: "episode", ep: n, start: 0, label: "Play " + d.episodes[n].label + " from the start"})
            else
                actions.Push({id: "episode", ep: 0, start: 0, label: "Play " + d.episodes[0].label})
            end if
        end if
    else
        position = 0
        if entry <> invalid and not isTrueValue(entry.nx) then position = Int(numberOf(entry.p))
        if position >= 15
            actions.Push({id: "play", start: position, label: "Resume at " + clockText(position)})
            actions.Push({id: "play", start: 0, label: "Play from the start"})
        else
            actions.Push({id: "play", start: 0, label: "Play"})
        end if
    end if
    if m.favSet.DoesExist(item.key)
        actions.Push({id: "fav", label: "Remove from Library"})
    else
        actions.Push({id: "fav", label: "Add to Library"})
    end if
    ' Last, so appearing when the lookup answers never moves the focused action.
    if d.trailer <> invalid then actions.Push({id: "trailer", label: "Trailer"})
    labels = []
    for each action in actions
        labels.Push(action.label)
    end for
    focus = m.detailsActions.itemFocused
    m.detailActionsData = actions
    setList(m.detailsActions, labels)
    if focus > 0 and focus < actions.Count() then m.detailsActions.jumpToItem = focus
    m.detailsMeta.text = titleMeta(item)
end sub

sub onDetailAction()
    d = m.detail
    index = m.detailsActions.itemSelected
    if d = invalid or index < 0 or index >= m.detailActionsData.Count() then return
    action = m.detailActionsData[index]
    if action.id = "play"
        playTitle(d.item, action.start, m.detailsActions)
    else if action.id = "episode"
        playEpisode(action.ep, action.start, m.detailsActions)
    else if action.id = "fav"
        toggleFavorite(d.item)
        buildDetailActions()
    else if action.id = "trailer"
        showTrailer(d.trailer)
    end if
end sub

' An episode from the list starts from the beginning, unless it is the one in progress.
sub onEpisodeChosen()
    d = m.detail
    index = m.detailsEpisodes.itemSelected
    if d = invalid or d.episodes = invalid or index < 0 or index >= d.episodes.Count() then return
    start = 0
    entry = m.progByKey[d.item.key]
    if progressEpisode(d.episodes, entry) = index and not isTrueValue(entry.nx) then start = Int(numberOf(entry.p))
    playEpisode(index, start, m.detailsEpisodes)
end sub

function detailsKey(key as string) as boolean
    if key = "back"
        closeDetails()
        return true
    else if key = "options"
        if m.detail <> invalid
            toggleFavorite(m.detail.item)
            buildDetailActions()
        end if
        return true
    else if key = "right" and m.detailsActions.hasFocus() and m.detail <> invalid and m.detail.episodes <> invalid and m.detail.episodes.Count() > 0
        m.detailsEpisodes.setFocus(true)
        return true
    else if key = "left" and m.detailsEpisodes.hasFocus()
        m.detailsActions.setFocus(true)
        return true
    end if
    return false
end function
