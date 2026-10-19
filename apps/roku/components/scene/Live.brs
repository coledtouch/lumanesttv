' Live TV: categories on the left and their channels on the right, as before the browse redesign.

sub initLive()
    m.liveCats = []
    m.liveItems = []
    ' Compiled once: Live TV and every Search keystroke order the live categories.
    m.liveRx = {
        leading: CreateObject("roRegex", "^[^A-Za-z0-9]+", ""),
        nonWord: CreateObject("roRegex", "[^A-Z0-9]+", ""),
        labelled: CreateObject("roRegex", "(^|[^A-Z])(US|USA|U\.S\.A?\.?|UNITED STATES)([^A-Z]|$)", ""),
        leagues: CreateObject("roRegex", "(^|[^A-Z])(NFL|NBA|WNBA|NHL|MLB|MLS|NCAA|ESPN|PPV)([^A-Z]|$)", "")
    }
    m.liveOrder = invalid
    m.cats.observeField("itemFocused", "onLiveCategoryFocused")
    m.cats.observeField("itemSelected", "onLiveCategorySelected")
    m.items.observeField("itemSelected", "onLiveItemSelected")
end sub

sub showLiveView()
    if m.catalog = invalid
        m.liveCats = []
        m.liveItems = []
        setList(m.cats, [])
        setList(m.items, [])
        return
    end if
    if not m.liveDirty then return
    m.liveDirty = false
    m.liveCats = orderedCategories("live")
    labels = []
    for each cat in m.liveCats
        labels.Push(cat.name)
    end for
    setList(m.cats, labels)
    if m.liveCats.Count() = 0
        setList(m.items, ["Nothing here yet"])
        m.liveItems = []
    else
        showLiveCategory(0)
    end if
end sub

' Live TV can be limited to US categories; the order is the customer's choice in Settings. The result is
' kept until the catalogue or one of those settings changes, so Search does not redo it on every keystroke.
function orderedCategories(key as string) as object
    stamp = key + "|" + asText(m.catalogToken) + "|" + asText(m.settings.usOnly) + "|" + m.settings.order + "|" + asText(m.adultUnlocked)
    if m.liveOrder <> invalid and m.liveOrder.stamp = stamp then return m.liveOrder.result
    result = orderCategories(key)
    m.liveOrder = {stamp: stamp, result: result}
    return result
end function

function orderCategories(key as string) as object
    data = m.catalog[key]
    result = []
    index = 0
    for each cat in data.categories
        ' Adult categories stay hidden until Settings -> Adult content is unlocked with the passcode.
        hidden = not m.adultUnlocked and isAdultCategory(cat)
        if not hidden and (key <> "live" or not m.settings.usOnly or isUsCategory(cat.name))
            result.Push({id: cat.id, name: cat.name, rank: categoryRank(cat.name), index: index, sortName: LCase(stripLeading(cat.name))})
        end if
        index = index + 1
    end for
    if m.settings.order = "az"
        result.SortBy("sortName")
    else if m.settings.order = "featured"
        for each cat in result
            cat.key = cat.rank * 100000 + cat.index
        end for
        result.SortBy("key")
    end if
    return result
end function

function stripLeading(name as string) as string
    return m.liveRx.leading.Replace(name, "")
end function

function categoryRank(name as string) as integer
    normalized = m.liveRx.nonWord.ReplaceAll(UCase(name), " ").Trim()
    if Left(normalized, 4) = "USA " then normalized = Mid(normalized, 5)
    if Left(normalized, 3) = "US " then normalized = Mid(normalized, 4)
    ranks = ["SPORTS", "PREMIUM", "NEWS", "MOVIES", "ENTERTAINMENT", "DOCUMENTARIES", "LOCAL NEWS"]
    for i = 0 to ranks.Count() - 1
        if ranks[i] = normalized then return i
    end for
    return 7
end function

' A category counts as US programming when it is labelled US/USA/United States or is a US sports league.
function isUsCategory(name as string) as boolean
    upper = UCase(name)
    return m.liveRx.labelled.IsMatch(upper) or m.liveRx.leagues.IsMatch(upper)
end function

' Adult = flagged is_adult by the Xtream server, or named XXX / Adult(s) / 18+ / Porn (but not Adult Swim).
function isAdultCategory(cat as object) as boolean
    if isTrueValue(cat.adult) then return true
    return isAdultName(cat.name, m.rx)
end function

function isAdultItem(item as object) as boolean
    return isTrueValue(item.adult)
end function

sub onLiveCategoryFocused()
    if m.catalog = invalid then return
    showLiveCategory(m.cats.itemFocused)
end sub

sub showLiveCategory(index as integer)
    if index < 0 or index >= m.liveCats.Count() then return
    list = m.catalog.live.byCat[m.liveCats[index].id]
    if list = invalid then list = []
    if not m.adultUnlocked
        visible = []
        for each item in list
            if not isAdultItem(item) then visible.Push(item)
        end for
        list = visible
    end if
    m.liveItems = list
    labels = []
    for each item in list
        labels.Push(item.name)
    end for
    setList(m.items, labels)
end sub

sub onLiveCategorySelected()
    if m.liveItems.Count() > 0 then focusOn(m.items)
end sub

sub onLiveItemSelected()
    index = m.items.itemSelected
    if index < 0 or index >= m.liveItems.Count() then return
    playLive(m.liveItems[index], m.items)
end sub

function liveKey(key as string) as boolean
    if m.items.hasFocus()
        if key = "left" or key = "back"
            focusOn(m.cats)
            return true
        else if key = "up"
            focusNav()
            return true
        end if
    else if m.cats.hasFocus()
        if key = "right" and m.liveItems.Count() > 0
            focusOn(m.items)
            return true
        else if key = "up" or key = "back"
            focusNav()
            return true
        end if
    end if
    return false
end function
