' Poster tile used by every row and grid of movies and series (and channels in Search).

sub init()
    m.tile = m.top.findNode("tile")
    m.name = m.top.findNode("name")
    m.poster = m.top.findNode("poster")
    m.captionBack = m.top.findNode("captionBack")
    m.caption = m.top.findNode("caption")
    m.progressBack = m.top.findNode("progressBack")
    m.progressBar = m.top.findNode("progressBar")
    m.badge = m.top.findNode("badge")
    m.observed = invalid
    layout()
end sub

sub layout()
    w = m.top.width
    h = m.top.height
    if w <= 0 or h <= 0 then return
    m.tile.width = w
    m.tile.height = h
    m.name.translation = [12, 12]
    m.name.width = w - 24
    m.name.height = h - 24
    m.poster.width = w
    m.poster.height = h
    m.poster.loadWidth = w
    m.poster.loadHeight = h
    m.captionBack.translation = [0, h - 56]
    m.captionBack.width = w
    m.captionBack.height = 56
    m.caption.translation = [8, h - 56]
    m.caption.width = w - 16
    m.caption.height = 56
    m.progressBack.translation = [0, h - 10]
    m.progressBack.width = w
    m.progressBack.height = 10
    m.progressBar.translation = [0, h - 10]
    m.progressBar.height = 10
    m.badge.translation = [w - 52, 8]
    showProgress()
end sub

sub showContent()
    content = m.top.itemContent
    if m.observed <> invalid
        m.observed.unobserveFieldScoped("fav")
        m.observed.unobserveFieldScoped("prog")
        m.observed = invalid
    end if
    if content = invalid then return
    kind = content.tile
    m.name.text = content.title
    m.caption.text = content.title
    m.caption.visible = kind = "live"
    m.captionBack.visible = kind = "live"
    if kind = "seeall"
        m.tile.color = "0x3B2A6BFF"
        m.name.font = "font:MediumBoldSystemFont"
        m.poster.uri = ""
    else if kind = "live"
        ' Channel logos keep their shape on a dark tile, with the channel name underneath.
        m.tile.color = "0x221C38FF"
        m.name.font = "font:SmallBoldSystemFont"
        m.poster.loadDisplayMode = "scaleToFit"
        m.poster.uri = content.HDPosterUrl
    else
        m.tile.color = "0x221C38FF"
        m.name.font = "font:SmallBoldSystemFont"
        m.poster.loadDisplayMode = "scaleToZoom"
        m.poster.uri = content.HDPosterUrl
    end if
    ' Favorites and progress can change while the tile is on screen.
    if content.hasField("fav")
        content.observeFieldScoped("fav", "showBadge")
        content.observeFieldScoped("prog", "showProgress")
        m.observed = content
    end if
    showBadge()
    showProgress()
end sub

sub showBadge()
    content = m.top.itemContent
    m.badge.visible = content <> invalid and content.hasField("fav") and content.fav = true
end sub

sub showProgress()
    content = m.top.itemContent
    fraction = 0
    if content <> invalid and content.hasField("prog") then fraction = content.prog
    m.progressBack.visible = fraction > 0
    m.progressBar.visible = fraction > 0
    m.progressBar.width = m.top.width * fraction
end sub
