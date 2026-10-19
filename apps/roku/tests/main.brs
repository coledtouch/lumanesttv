' Test package entry point (npm run build:tests). Runs the BrightScript unit tests on the Roku,
' prints each failure to the debug console (telnet <roku-ip> 8085) and shows the totals on screen.
sub Main()
    result = runBrowseLogicTests()
    summary = result.passed.ToStr() + " passed, " + result.failed.ToStr() + " failed"
    print "TUNER TESTS: " + summary
    for each failure in result.failures
        print "  FAIL " + failure
    end for
    if result.failed = 0 then print "TUNER TESTS PASSED" else print "TUNER TESTS FAILED"

    screen = CreateObject("roSGScreen")
    port = CreateObject("roMessagePort")
    screen.SetMessagePort(port)
    scene = screen.CreateScene("Scene")
    screen.Show()
    label = scene.createChild("Label")
    label.translation = [120, 120]
    label.width = 1680
    label.wrap = true
    label.font = "font:MediumSystemFont"
    text = "Tuner unit tests: " + summary + Chr(10) + "Failures are listed in the debug console (port 8085)." + Chr(10)
    for each failure in result.failures
        text = text + Chr(10) + failure
    end for
    label.text = text
    while true
        msg = wait(0, port)
        if type(msg) = "roSGScreenEvent" and msg.IsScreenClosed() then return
    end while
end sub
