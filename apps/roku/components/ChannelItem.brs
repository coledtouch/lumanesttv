sub init()
    m.logo = m.top.FindNode("logo")
    m.number = m.top.FindNode("number")
    m.name = m.top.FindNode("name")
end sub

sub onContent()
    item = m.top.itemContent
    if item = invalid then return
    m.name.text = item.title
    m.number.text = item.ShortDescriptionLine1
    m.logo.uri = item.HDPosterUrl
end sub

sub onWidth()
    m.name.width = m.top.width - 310
end sub
