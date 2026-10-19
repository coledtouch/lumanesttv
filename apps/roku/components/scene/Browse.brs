' Home, Discover, Library and Search: posters of movies and series built from the catalogue with the
' rules in source/lib/BrowseLogic.brs, and the Library kept in the registry.

sub initBrowse()
    m.homeRows.observeField("rowItemFocused", "onHomeFocused")
    m.homeRows.observeField("rowItemSelected", "onHomeSelected")
    m.libraryRows.observeField("rowItemFocused", "onLibraryFocused")
    m.libraryRows.observeField("rowItemSelected", "onLibrarySelected")
    m.discoverGrid.observeField("itemFocused", "onDiscoverFocused")
    m.discoverGrid.observeField("itemSelected", "onDiscoverSelected")
    m.filters.observeField("chosen", "onFilterChosen")
    m.pickerList.observeField("itemSelected", "onPickerChosen")
    m.keyboard.observeField("text", "onSearchText")
    m.searchGrid.observeField("itemFocused", "onSearchFocused")
    m.searchGrid.observeField("itemSelected", "onSearchSelected")
    m.searchTimer = CreateObject("roSGNode", "Timer")
    m.searchTimer.duration = 0.4
    m.searchTimer.repeat = false
    m.searchTimer.observeField("fire", "runSearch")
    m.discover = {type: "movies", list: "", genre: ""}
    m.discoverOpts = invalid
    m.discoverCursor = 0
    m.searchLive = []
    m.pickerKind = ""
    m.pickerOptions = []
    markBrowseDirty()
end sub

sub markBrowseDirty()
    m.homeDirty = true
    m.libraryDirty = true
    m.discoverDirty = true
    m.searchDirty = true
    m.liveDirty = true
end sub

function browseOpts(genre as string) as object
    return {usOnly: m.settings.vodUsOnly, adultOk: m.adultUnlocked, genre: genre, seen: exactKeys()}
end function

function hasTmdb() as boolean
    return m.rowsSource = "tmdb"
end function

function catalogItem(refType as string, idx as integer) as dynamic
    if m.catalog = invalid then return invalid
    section = m.catalog[refType]
    if section = invalid or idx < 0 or idx >= section.items.Count() then return invalid
    return section.items[idx]
end function

function typeName(refType as string) as string
    if refType = "series" then return "Series"
    return "Movies"
end function

function listName(key as string) as string
    for each list in discoverLists(true)
        if list.key = key then return list.name
    end for
    return key
end function

' ------------------------------------------------------------------ Library store

function lineFingerprint() as string
    if m.account = invalid then return ""
    text = asText(m.account.type) + "|" + asText(m.account.server) + "|" + asText(m.account.username) + "|" + asText(m.account.m3uUrl)
    bytes = CreateObject("roByteArray")
    bytes.FromAsciiString(text)
    digest = CreateObject("roEVPDigest")
    digest.Setup("md5")
    return Left(LCase(digest.Process(bytes)), 12)
end function

sub libraryLoad()
    raw = m.reg.Read("library")
    stored = invalid
    if raw <> "" then stored = ParseJson(raw)
    m.library = libraryFor(stored, lineFingerprint())
    libraryIndex()
end sub

sub librarySave()
    m.reg.Write("library", FormatJson(m.library))
    m.reg.Flush()
    libraryIndex()
end sub

' Lookups for the tiles: favorites by key and progress by key, letter case included ("m1a" and "m1A" are two titles).
sub libraryIndex()
    m.favSet = exactKeys()
    for each key in m.library.fav
        m.favSet[key] = true
    end for
    m.progByKey = exactKeys()
    for each entry in m.library.prog
        m.progByKey[entry.k] = entry
    end for
end sub

sub toggleFavorite(item as object)
    added = libraryToggleFavorite(m.library, item.key)
    librarySave()
    syncFavoriteTiles(item.key, added)
    m.libraryDirty = true
    if m.section = "library" and not m.details.visible
        ' A title removed with * inside the Library leaves its row at once.
        buildLibrary()
        if contentCount(m.libraryRows) = 0 then focusNav()
    end if
    describeFocused()
    if added then showToast("Added to your Library.") else showToast("Removed from your Library.")
end sub

' Rewrites the focused title's line ("In your Library") in the open section.
sub describeFocused()
    if m.section = "home"
        onHomeFocused()
    else if m.section = "library"
        onLibraryFocused()
    else if m.section = "discover"
        describeTile(gridTile(m.discoverGrid), m.discoverTitle, m.discoverMeta)
    else if m.section = "search"
        onSearchFocused()
    end if
end sub

sub toggleFavoriteTile(node as dynamic)
    if node = invalid or node.tile <> "title" then return
    item = catalogItem(node.refType, node.refIdx)
    if item <> invalid then toggleFavorite(item)
end sub

' Updates the check badge on every tile of that title currently built.
sub syncFavoriteTiles(key as string, added as boolean)
    refType = libraryTypeOf(key)
    if m.catalog = invalid then return
    idx = titleIndexOf(m.catalog[refType], key)
    if idx < 0 then return
    for each list in [m.homeRows, m.libraryRows]
        if list.content <> invalid
            for r = 0 to list.content.getChildCount() - 1
                syncTiles(list.content.getChild(r), refType, idx, added)
            end for
        end if
    end for
    for each grid in [m.discoverGrid, m.searchGrid]
        if grid.content <> invalid then syncTiles(grid.content, refType, idx, added)
    end for
end sub

' Updates the progress bar on the Discover and Search tiles of that title after playback saved a position
' (Home and the Library are rebuilt instead).
sub syncProgressTiles(key as string)
    refType = libraryTypeOf(key)
    if m.catalog = invalid then return
    idx = titleIndexOf(m.catalog[refType], key)
    if idx < 0 then return
    fraction = progressFraction(m.progByKey[key])
    for each grid in [m.discoverGrid, m.searchGrid]
        if grid.content <> invalid
            for i = 0 to grid.content.getChildCount() - 1
                tile = grid.content.getChild(i)
                if tile.refIdx = idx and tile.refType = refType then tile.prog = fraction
            end for
        end if
    end for
end sub

sub syncTiles(parent as object, refType as string, idx as integer, added as boolean)
    for i = 0 to parent.getChildCount() - 1
        tile = parent.getChild(i)
        if tile.refIdx = idx and tile.refType = refType then tile.fav = added
    end for
end sub

' ------------------------------------------------------------------ tiles

function addTitleTile(parent as object, refType as string, idx as integer) as object
    item = m.catalog[refType].items[idx]
    node = parent.createChild("TileNode")
    node.title = item.name
    node.HDPosterUrl = item.icon
    node.tile = "title"
    node.refType = refType
    node.refIdx = idx
    node.fav = m.favSet.DoesExist(item.key)
    node.prog = progressFraction(m.progByKey[item.key])
    return node
end function

sub addSeeAllTile(parent as object, refType as string, list as string)
    node = parent.createChild("TileNode")
    node.title = "See all"
    node.tile = "seeall"
    node.refType = refType
    node.list = list
end sub

function tileAt(list as object, position as dynamic) as dynamic
    content = list.content
    if content = invalid or type(position) <> "roArray" or position.Count() < 2 then return invalid
    row = content.getChild(position[0])
    if row = invalid then return invalid
    return row.getChild(position[1])
end function

function gridTile(grid as object) as dynamic
    if grid.content = invalid or grid.content.getChildCount() = 0 then return invalid
    index = grid.itemFocused
    if index < 0 then index = 0
    return grid.content.getChild(index)
end function

function ratingText(rating as float) as string
    tenths = Int(rating * 10 + 0.5)
    return (tenths \ 10).ToStr() + "." + (tenths mod 10).ToStr()
end function

' "Movie · 2021 · Rated 7.8 · 42:10 left · In your Library"
function titleMeta(item as object) as string
    parts = []
    if item.kind = "series"
        parts.Push("Series")
    else if item.kind = "episode"
        parts.Push("Episode")
    else
        parts.Push("Movie")
    end if
    if item.year <> "" then parts.Push(item.year)
    if item.rating > 0 then parts.Push("Rated " + ratingText(item.rating))
    entry = m.progByKey[item.key]
    if entry <> invalid
        if isTrueValue(entry.nx)
            parts.Push("Up next: " + asText(entry.l))
        else if item.kind = "series"
            parts.Push(asText(entry.l) + " in progress")
        else if numberOf(entry.d) > 0
            parts.Push(clockText(Int(numberOf(entry.d) - numberOf(entry.p))) + " left")
        end if
    end if
    if m.favSet.DoesExist(item.key) then parts.Push("In your Library")
    return parts.Join("  ·  ")
end function

sub describeTile(node as dynamic, titleLabel as object, metaLabel as object)
    titleLabel.text = ""
    metaLabel.text = ""
    if node = invalid then return
    if node.tile = "seeall"
        titleLabel.text = "See all"
        if node.refType = "library"
            metaLabel.text = "Open your Library"
        else
            metaLabel.text = "Every title in " + listName(node.list) + " – " + typeName(node.refType) + ", in Discover"
        end if
    else if node.tile = "live"
        titleLabel.text = node.title
        metaLabel.text = "Live channel"
    else
        item = catalogItem(node.refType, node.refIdx)
        if item = invalid then return
        titleLabel.text = item.name
        metaLabel.text = titleMeta(item)
    end if
end sub

' OK on a tile: details for a title, Discover or the Library for See all, playback for a channel.
sub openTile(node as dynamic, from as object)
    if node = invalid then return
    if node.tile = "seeall"
        if node.refType = "library"
            goSection("library")
        else
            openDiscover(node.refType, node.list)
        end if
    else if node.tile = "live"
        if node.refIdx >= 0 and node.refIdx < m.searchLive.Count() then playLive(m.searchLive[node.refIdx], from)
    else
        openDetails(node.refType, node.refIdx, from)
    end if
end sub

function rowsContent(rows as object) as object
    content = CreateObject("roSGNode", "ContentNode")
    for each row in rows
        rowNode = content.createChild("ContentNode")
        rowNode.title = row.title
        for each ref in row.refs
            addTitleTile(rowNode, ref.type, ref.idx)
        end for
        if row.list <> invalid then addSeeAllTile(rowNode, row.type, row.list)
    end for
    return content
end function

' Puts a RowList back on the row and column it was on, as far as the new rows allow.
sub restoreRowFocus(list as object, position as dynamic)
    count = contentCount(list)
    if count = 0 or type(position) <> "roArray" or position.Count() < 2 then return
    r = position[0]
    if r >= count then r = count - 1
    if r < 0 then r = 0
    c = position[1]
    columns = list.content.getChild(r).getChildCount()
    if c >= columns then c = columns - 1
    if c < 0 then c = 0
    list.jumpToRowItem = [r, c]
end sub

function noTitlesText() as string
    if m.settings.vodUsOnly then return "No movies or series on your line pass the USA only filter. To see every country, choose Settings, then Movies & Series: All."
    return "Your line has no movies or series to show here."
end function

' ------------------------------------------------------------------ Home

sub showHomeView()
    if m.catalog = invalid
        m.homeRows.content = CreateObject("roSGNode", "ContentNode")
        m.homeTitle.text = ""
        m.homeMeta.text = ""
        return
    end if
    if m.homeDirty then buildHome()
end sub

sub buildHome()
    m.homeDirty = false
    position = m.homeRows.rowItemFocused
    refs = libraryRefs(libraryKeys(m.library.prog), m.catalog, browseOpts(""))
    rows = buildHomeRows(m.catalog, hasTmdb(), browseOpts(""), refs)
    m.homeRows.content = rowsContent(rows)
    if rows.Count() = 0
        m.homeTitle.text = "Nothing to show yet"
        m.homeMeta.text = noTitlesText()
        return
    end if
    restoreRowFocus(m.homeRows, position)
    onHomeFocused()
end sub

sub onHomeFocused()
    describeTile(tileAt(m.homeRows, focusedRowItem(m.homeRows)), m.homeTitle, m.homeMeta)
end sub

' The focused [row, column], or the first tile before the list has reported one.
function focusedRowItem(list as object) as object
    position = list.rowItemFocused
    if type(position) = "roArray" and position.Count() >= 2 and position[0] >= 0 then return position
    return [0, 0]
end function

sub onHomeSelected()
    openTile(tileAt(m.homeRows, m.homeRows.rowItemSelected), m.homeRows)
end sub

' ------------------------------------------------------------------ Library

sub showLibraryView()
    if m.catalog = invalid then return
    if m.libraryDirty then buildLibrary()
end sub

sub buildLibrary()
    m.libraryDirty = false
    position = m.libraryRows.rowItemFocused
    opts = browseOpts("")
    movies = []
    series = []
    for each ref in libraryRefs(m.library.fav, m.catalog, opts)
        if ref.type = "series" then series.Push(ref) else movies.Push(ref)
    end for
    candidates = []
    candidates.Push({title: "Continue watching", refs: libraryRefs(libraryKeys(m.library.prog), m.catalog, opts)})
    candidates.Push({title: "Favorite movies", refs: movies})
    candidates.Push({title: "Favorite series", refs: series})
    candidates.Push({title: "Recently watched", refs: libraryRefs(libraryKeys(m.library.seen), m.catalog, opts)})
    rows = []
    for each row in candidates
        if row.refs.Count() > 0 then rows.Push(row)
    end for
    m.libraryRows.content = rowsContent(rows)
    m.libraryRows.visible = rows.Count() > 0
    m.libraryEmpty.visible = rows.Count() = 0
    if rows.Count() = 0
        m.libraryTitle.text = "Library"
        m.libraryMeta.text = ""
        return
    end if
    restoreRowFocus(m.libraryRows, position)
    onLibraryFocused()
end sub

sub onLibraryFocused()
    describeTile(tileAt(m.libraryRows, focusedRowItem(m.libraryRows)), m.libraryTitle, m.libraryMeta)
end sub

sub onLibrarySelected()
    openTile(tileAt(m.libraryRows, m.libraryRows.rowItemSelected), m.libraryRows)
end sub

' ------------------------------------------------------------------ Discover

' See all on Home: Discover with Type and List set and Genre back to All.
sub openDiscover(refType as string, list as string)
    m.discover = {type: refType, list: list, genre: ""}
    m.discoverDirty = true
    goSection("discover")
    if contentCount(m.discoverGrid) > 0 then focusOn(m.discoverGrid)
end sub

sub showDiscoverView()
    if m.catalog = invalid then return
    if m.discoverDirty then buildDiscover()
end sub

function defaultDiscoverList(refType as string) as string
    if hasTmdb() then return "popular"
    if m.catalog[refType].lists.recent.Count() > 0 then return "recent"
    return "az"
end function

function optionName(options as object, key as string) as string
    for each option in options
        if option.key = key then return option.name
    end for
    return ""
end function

sub buildDiscover()
    m.discoverDirty = false
    d = m.discover
    if d.type <> "series" then d.type = "movies"
    lists = discoverLists(hasTmdb())
    if optionName(lists, d.list) = "" then d.list = defaultDiscoverList(d.type)
    genres = m.catalog[d.type].genres
    genreLabel = optionName(genres, d.genre)
    if genreLabel = ""
        d.genre = ""
        genreLabel = "All"
    end if
    m.filters.labels = ["Type: " + typeName(d.type), "List: " + optionName(lists, d.list), "Genre: " + genreLabel]
    m.discoverOpts = browseOpts(d.genre)
    m.discoverCursor = 0
    m.discoverGrid.content = CreateObject("roSGNode", "ContentNode")
    appendDiscover(49)
    count = contentCount(m.discoverGrid)
    m.discoverGrid.visible = count > 0
    m.discoverEmpty.visible = count = 0
    if count = 0
        m.discoverEmpty.text = "No titles match these filters." + Chr(10) + noTitlesText()
        if not m.settings.vodUsOnly then m.discoverEmpty.text = "No titles match these filters."
        m.discoverTitle.text = ""
        m.discoverMeta.text = ""
        if m.discoverGrid.hasFocus() then focusOn(m.filters)
    else
        m.discoverGrid.jumpToItem = 0
        onDiscoverFocused()
    end if
end sub

' The grid grows as the focus nears its end, so a long list never builds thousands of tiles at once.
sub appendDiscover(count as integer)
    section = m.catalog[m.discover.type]
    result = pickTitles(section, section.lists[m.discover.list], m.discoverOpts, m.discoverCursor, count)
    m.discoverCursor = result.cursor
    content = m.discoverGrid.content
    for each idx in result.picked
        addTitleTile(content, m.discover.type, idx)
    end for
end sub

sub onDiscoverFocused()
    content = m.discoverGrid.content
    if content = invalid or m.catalog = invalid then return
    describeTile(gridTile(m.discoverGrid), m.discoverTitle, m.discoverMeta)
    if m.discoverGrid.itemFocused >= content.getChildCount() - 21 then appendDiscover(42)
end sub

sub onDiscoverSelected()
    openTile(gridTile(m.discoverGrid), m.discoverGrid)
end sub

sub onFilterChosen()
    if m.catalog = invalid then return
    choice = m.filters.chosen
    if choice = 0
        openPicker("Type", "type", [{key: "movies", name: "Movies"}, {key: "series", name: "Series"}], m.discover.type)
    else if choice = 1
        openPicker("List", "list", discoverLists(hasTmdb()), m.discover.list)
    else
        options = [{key: "", name: "All"}]
        options.Append(m.catalog[m.discover.type].genres)
        openPicker("Genre", "genre", options, m.discover.genre)
    end if
end sub

sub openPicker(title as string, kind as string, options as object, current as string)
    m.pickerKind = kind
    m.pickerOptions = options
    labels = []
    focus = 0
    for i = 0 to options.Count() - 1
        label = options[i].name
        if options[i].key = current
            label = label + "  (current)"
            focus = i
        end if
        labels.Push(label)
    end for
    m.pickerTitle.text = title
    setList(m.pickerList, labels)
    m.picker.visible = true
    m.pickerList.jumpToItem = focus
    m.pickerList.setFocus(true)
end sub

sub closePicker()
    m.picker.visible = false
    focusOn(m.filters)
end sub

sub onPickerChosen()
    if not m.picker.visible then return
    index = m.pickerList.itemSelected
    if index < 0 or index >= m.pickerOptions.Count() then return
    key = m.pickerOptions[index].key
    kind = m.pickerKind
    closePicker()
    if kind = "type"
        if key <> m.discover.type
            ' Movie and TV genres differ, so a new type starts on All.
            m.discover.type = key
            m.discover.genre = ""
        end if
    else if kind = "list"
        m.discover.list = key
    else
        m.discover.genre = key
    end if
    buildDiscover()
end sub

' ------------------------------------------------------------------ Search

sub showSearchView()
    if m.catalog = invalid then return
    if m.searchDirty then runSearch()
end sub

sub onSearchText()
    m.searchTimer.control = "stop"
    m.searchTimer.control = "start"
end sub

' Movies and series whose names contain the text (names starting with it first), then live channels.
sub runSearch()
    m.searchDirty = false
    content = CreateObject("roSGNode", "ContentNode")
    m.searchLive = []
    query = LCase(m.keyboard.text.Trim())
    if m.catalog = invalid or Len(query) < 2
        m.searchGrid.content = content
        m.searchGrid.visible = false
        m.searchTitle.text = ""
        m.searchMeta.text = ""
        m.searchEmpty.visible = true
        m.searchEmpty.text = "Search movies, series and live channels. Type at least 2 letters."
        return
    end if
    for each refType in ["movies", "series"]
        for each idx in searchTitles(m.catalog[refType], query, browseOpts(""), 40)
            addTitleTile(content, refType, idx)
        end for
    end for
    for each channel in searchChannels(query, 30)
        node = content.createChild("TileNode")
        node.title = channel.name
        node.HDPosterUrl = channel.icon
        node.tile = "live"
        node.refType = "live"
        node.refIdx = m.searchLive.Count()
        m.searchLive.Push(channel)
    end for
    m.searchGrid.content = content
    count = content.getChildCount()
    m.searchGrid.visible = count > 0
    m.searchEmpty.visible = count = 0
    if count = 0
        m.searchTitle.text = ""
        m.searchMeta.text = ""
        m.searchEmpty.text = "Nothing matches " + Chr(34) + m.keyboard.text.Trim() + Chr(34) + "."
        if m.searchGrid.hasFocus() then focusOn(m.keyboard)
    else
        m.searchGrid.jumpToItem = 0
        onSearchFocused()
    end if
end sub

' Live channels in the categories Live TV shows (Channels setting and adult lock apply).
function searchChannels(query as string, limit as integer) as object
    found = []
    if m.catalog = invalid then return found
    data = m.catalog.live
    for each cat in orderedCategories("live")
        for each item in arrayOrEmpty(data.byCat[cat.id])
            if found.Count() >= limit then return found
            if (m.adultUnlocked or not isAdultItem(item)) and LCase(item.name).InStr(query) >= 0 then found.Push(item)
        end for
    end for
    return found
end function

sub onSearchFocused()
    describeTile(gridTile(m.searchGrid), m.searchTitle, m.searchMeta)
end sub

sub onSearchSelected()
    openTile(gridTile(m.searchGrid), m.searchGrid)
end sub
