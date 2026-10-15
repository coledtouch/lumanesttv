' Channel entry point. The SceneGraph scene does the work; this loop only keeps the channel alive
' until the scene asks to exit or the screen closes.
sub Main(args as Dynamic)
    screen = CreateObject("roSGScreen")
    port = CreateObject("roMessagePort")
    screen.SetMessagePort(port)
    scene = screen.CreateScene("MainScene")
    screen.Show()
    scene.ObserveField("exitApp", port)
    ' Deep links and voice launch arrive as roInputEvent; certification requires listening for them.
    input = CreateObject("roInput")
    input.SetMessagePort(port)
    while true
        msg = wait(0, port)
        msgType = type(msg)
        if msgType = "roSGScreenEvent"
            if msg.IsScreenClosed() then return
        else if msgType = "roSGNodeEvent"
            if msg.GetField() = "exitApp" and msg.GetData() = true then return
        end if
    end while
end sub
