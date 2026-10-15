sub Main()
    source = {server: "http://h:1", username: "u", password: "p"}
    cats = [{category_id: "2", category_name: "News"}, {category_id: 1, category_name: "Sports"}, {category_id: "9", category_name: "Empty"}]
    streams = [
        {stream_id: 10, name: "Sports One", category_id: "1", num: 7, stream_icon: "http://logo/1.png"},
        {stream_id: "11", name: "News One", category_id: 2, num: "3"},
        {stream_id: 12, name: "Lost", category_id: "77"},
        {name: "No id", category_id: "1"},
        "not an object"
    ]
    groups = groupXtream(source, "live", cats, streams)
    assertEqual(groups.Count(), 3, "empty categories dropped, unknown category kept")
    assertEqual(groups[0].title, "News", "provider category order kept")
    assertEqual(groups[1].title, "Sports", "numeric category ids match")
    assertEqual(groups[2].title, "Other", "unknown category named Other")
    assertEqual(groups[1].items.Count(), 1, "streams without an id skipped")
    channel = groups[1].items[0]
    assertEqual(channel.url, "http://h:1/live/u/p/10.m3u8", "live URL uses HLS")
    assertEqual(channel.streamFormat, "hls", "live format")
    assertEqual(channel.live, true, "live flag")
    assertEqual(channel.label, "7", "channel number")
    assertEqual(channel.poster, "http://logo/1.png", "channel logo")

    movies = groupXtream(source, "movies", invalid, [{stream_id: 5, name: "Film", category_id: "3", container_extension: "mkv", rating: "7.5"}, {stream_id: 6, name: "Clip", category_id: "3", rating: 0}])
    assertEqual(movies.Count(), 1, "movies without categories grouped")
    assertEqual(movies[0].items[0].url, "http://h:1/movie/u/p/5.mkv", "movie URL keeps container")
    assertEqual(movies[0].items[0].streamFormat, "mkv", "movie format")
    assertEqual(movies[0].items[0].live, false, "movie is not live")
    assertEqual(movies[0].items[0].label, "★ 7.5", "movie rating")
    assertEqual(movies[0].items[1].url, "http://h:1/movie/u/p/6.mp4", "missing container defaults to mp4")
    assertEqual(movies[0].items[1].label, "", "zero rating hidden")

    q = Chr(34)
    playlist = "#EXTM3U url-tvg=" + q + "http://epg" + q + Chr(13) + Chr(10)
    playlist = playlist + "#EXTINF:-1 tvg-id=" + q + "a" + q + " tvg-chno=" + q + "4" + q + " tvg-logo=" + q + "http://l/a.png" + q + " group-title=" + q + "News, US" + q + ",ABC News, Live" + Chr(13) + Chr(10)
    playlist = playlist + "http://s/live/a.m3u8" + Chr(13) + Chr(10)
    playlist = playlist + "#EXTINF:-1,Plain Channel" + Chr(10) + "#EXTGRP:Locals" + Chr(10) + "http://s/live/b.ts" + Chr(10)
    playlist = playlist + "#EXTINF:-1 tvg-name=" + q + "Named" + q + " group-title=" + q + "Films" + q + "," + Chr(10) + "http://s/movie/u/p/9.mp4" + Chr(10)
    playlist = playlist + "http://s/live/c.m3u8" + Chr(10)

    live = parseM3u(playlist, "live")
    assertEqual(live.Count(), 3, "live groups from group-title, #EXTGRP and fallback")
    assertEqual(live[0].title, "News, US", "group-title with a comma")
    assertEqual(live[0].items[0].title, "ABC News, Live", "title after the quoted attributes keeps commas")
    assertEqual(live[0].items[0].label, "4", "tvg-chno")
    assertEqual(live[0].items[0].poster, "http://l/a.png", "tvg-logo")
    assertEqual(live[0].items[0].streamFormat, "hls", "m3u8 detected")
    assertEqual(live[1].title, "Locals", "#EXTGRP group")
    assertEqual(live[1].items[0].title, "Plain Channel", "title without attributes")
    assertEqual(live[2].title, "Uncategorized", "entry without #EXTINF")
    assertEqual(live[2].items[0].title, "Channel 3", "fallback channel name")

    vod = parseM3u(playlist, "movies")
    assertEqual(vod.Count(), 1, "movie groups")
    assertEqual(vod[0].items[0].title, "Named", "tvg-name fallback")
    assertEqual(vod[0].items[0].live, false, "movie entries are not live")
    assertEqual(parseM3u("", "live").Count(), 0, "empty playlist")
    finish()
end sub
