' Tiny assertion helpers for the BrightScript tests; tests/brightscript.test.cjs reads the printed results.
sub assertEqual(actual as Dynamic, expected as Dynamic, label as String)
    if m.passed = invalid then m.passed = 0
    if valueKind(actual) = valueKind(expected) and utilStr(actual) = utilStr(expected)
        m.passed = m.passed + 1
    else
        print "FAIL " + label + ": expected [" + utilStr(expected) + "] got [" + utilStr(actual) + "] (" + type(actual) + ")"
    end if
end sub

' Groups boxed and unboxed types, so "a" and roString "a" compare equal but "5" and 5 do not.
function valueKind(value as Dynamic) as String
    t = LCase(type(value))
    if t = "string" or t = "rostring" then return "string"
    if t = "boolean" or t = "roboolean" then return "boolean"
    if t = "invalid" or t = "roinvalid" then return "invalid"
    if Instr(1, t, "int") > 0 or Instr(1, t, "float") > 0 or Instr(1, t, "double") > 0 then return "number"
    return t
end function

sub assertInvalid(actual as Dynamic, label as String)
    if m.passed = invalid then m.passed = 0
    if actual = invalid
        m.passed = m.passed + 1
    else
        print "FAIL " + label + ": expected invalid"
    end if
end sub

sub finish()
    print "PASSED " + m.passed.ToStr()
end sub
