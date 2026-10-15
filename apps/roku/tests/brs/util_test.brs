sub Main()
    assertEqual(utilNormalizeServer("example.com:8080"), "http://example.com:8080", "bare host gets a scheme")
    assertEqual(utilNormalizeServer(" https://tv.example/ "), "https://tv.example", "trailing slash trimmed")
    assertEqual(utilNormalizeServer("http://h:80/player_api.php?username=a&password=b"), "http://h:80", "player_api link reduced to server")
    assertEqual(utilNormalizeServer("HTTP://H:80/get.php?x=1"), "HTTP://H:80", "get.php link reduced, scheme case kept")
    assertEqual(utilNormalizeServer(""), "", "empty server")

    login = utilFromGetPhp("http://h.tv:8080/get.php?username=u%40x&password=p%2Bw&type=m3u_plus&output=ts")
    assertEqual(login.type, "xtream", "get.php becomes an Xtream login")
    assertEqual(login.server, "http://h.tv:8080", "get.php server")
    assertEqual(login.username, "u@x", "get.php username unescaped")
    assertEqual(login.password, "p+w", "get.php password unescaped")
    assertInvalid(utilFromGetPhp("http://h.tv/get.php?username=u"), "get.php without password")
    assertInvalid(utilFromGetPhp("http://h.tv/list.m3u"), "plain M3U link")

    source = {server: "http://h:1", username: "u s", password: "p&w"}
    assertEqual(utilXtreamApi(source, "get_live_streams"), "http://h:1/player_api.php?username=u%20s&password=p%26w&action=get_live_streams", "API query escapes the login")
    assertEqual(utilXtreamStream(source, "live", "42", "m3u8"), "http://h:1/live/u s/p&w/42.m3u8", "stream path")

    assertEqual(utilStr(5), "5", "integer to string")
    assertEqual(utilStr(invalid), "", "invalid to string")
    assertEqual(utilStr("  a "), "a", "string trimmed")
    assertEqual(utilStr(true), "true", "boolean to string")
    assertEqual(utilStreamFormat("http://x/1.m3u8?token=1"), "hls", "hls with query")
    assertEqual(utilStreamFormat("MKV"), "mkv", "mkv extension")
    assertEqual(utilStreamFormat("mp4"), "mp4", "mp4 extension")
    assertEqual(utilStreamFormat("http://x/live/1.ts"), "", "transport stream left to the player")
    finish()
end sub
