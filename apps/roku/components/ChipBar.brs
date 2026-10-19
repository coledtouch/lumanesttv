' Chips for the top menu and the Discover filters. The focused chip is filled in violet only while
' the bar has focus, so the place the remote is on is always visible.

sub init()
    m.chips = []
    m.top.observeField("focusedChild", "paint")
end sub

sub layoutChips()
    m.top.removeChildrenIndex(m.top.getChildCount(), 0)
    m.chips = []
    h = m.top.chipHeight
    x = 0
    for each text in m.top.labels
        chip = m.top.createChild("Rectangle")
        label = chip.createChild("Label")
        label.font = m.top.font
        label.text = text
        w = Int(label.boundingRect().width) + 56
        if w < 120 then w = 120
        chip.translation = [x, 0]
        chip.width = w
        chip.height = h
        label.width = w
        label.height = h
        label.horizAlign = "center"
        label.vertAlign = "center"
        line = chip.createChild("Rectangle")
        line.translation = [28, h - 8]
        line.width = w - 56
        line.height = 4
        line.color = "0xB79CFBFF"
        m.chips.Push({chip: chip, label: label, line: line})
        x = x + w + 14
    end for
    if m.top.focusIndex >= m.chips.Count() then m.top.focusIndex = 0
    paint()
end sub

sub paint()
    focused = m.top.hasFocus()
    for i = 0 to m.chips.Count() - 1
        c = m.chips[i]
        isFocus = focused and i = m.top.focusIndex
        isSelected = i = m.top.selectedIndex
        if isFocus
            c.chip.color = "0xB79CFBFF"
            c.label.color = "0x141224FF"
        else if isSelected
            c.chip.color = "0x2B2349FF"
            c.label.color = "0xF6F3FBFF"
        else
            c.chip.color = "0x1A1630FF"
            c.label.color = "0xBBB2CFFF"
        end if
        c.line.visible = isSelected and not isFocus
    end for
end sub

function onKeyEvent(key as string, press as boolean) as boolean
    if not press then return false
    if key = "left" and m.top.focusIndex > 0
        m.top.focusIndex = m.top.focusIndex - 1
        return true
    else if key = "right" and m.top.focusIndex < m.chips.Count() - 1
        m.top.focusIndex = m.top.focusIndex + 1
        return true
    else if key = "OK"
        m.top.chosen = m.top.focusIndex
        return true
    end if
    return false
end function
