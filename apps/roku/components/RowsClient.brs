' Client for the catalog rows endpoint (docs/browse.md), run inside ApiTask. The answer is kept for
' 12 hours in cachefs: (kept between launches while the Roku has room) or tmp: (this launch only),
' and a stale copy is used whenever a refresh fails. With no copy and no answer the app falls back
' to the provider's own categories, timestamps and ratings (source "none").

function rowsUrl() as string
    return "https://lumanest.tv/api/catalog/rows?v=1"
end function

function rowsMaxAge() as integer
    return 12 * 3600
end function

function rowsCachePaths() as object
    return ["cachefs:/catalog-rows-v1.txt", "tmp:/catalog-rows-v1.txt"]
end function

function nowSeconds() as integer
    return CreateObject("roDateTime").AsSeconds()
end function

' The cached answer as {at (seconds), body}, or invalid. The file is "<seconds>\n<body>".
function rowsReadCache() as dynamic
    files = CreateObject("roFileSystem")
    for each path in rowsCachePaths()
        text = ""
        if files.Exists(path) then text = ReadAsciiFile(path)
        newline = Instr(1, text, Chr(10))
        if newline > 1
            at = Left(text, newline - 1).Trim().ToInt()
            body = Mid(text, newline + 1)
            if at > 0 and body <> "" then return {at: at, body: body}
        end if
    end for
    return invalid
end function

sub rowsWriteCache(body as string)
    text = nowSeconds().ToStr() + Chr(10) + body
    for each path in rowsCachePaths()
        if WriteAsciiFile(path, text) then return
    end for
end sub

' Starts the request in the background, unless the cached copy is less than 12 hours old, so it
' runs while the catalogue loads. Pass the result to rowsFinish.
function rowsBegin(force as boolean) as object
    job = {cache: rowsReadCache(), transfer: invalid, port: invalid, clock: invalid}
    if not force and job.cache <> invalid and isFreshCache(job.cache.at, nowSeconds(), rowsMaxAge()) then return job
    port = CreateObject("roMessagePort")
    transfer = CreateObject("roUrlTransfer")
    transfer.SetMessagePort(port)
    transfer.SetUrl(rowsUrl())
    transfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
    transfer.InitClientCertificates()
    transfer.EnableEncodings(true)
    transfer.AddHeader("User-Agent", "LumaNestTuner/Roku")
    transfer.AddHeader("Accept", "application/json")
    if transfer.AsyncGetToString()
        job.transfer = transfer
        job.port = port
        job.clock = CreateObject("roTimespan")
        job.clock.Mark()
    end if
    return job
end function

' The parsed rows (parseRowsPayload). The request rowsBegin started gets 20 seconds in all, counted from
' its start, so a slow server never adds 20 seconds after the catalogue has loaded. Anything but a 200
' (such as the 503 the server sends when TMDB fails and it has no copy) keeps the cached copy.
function rowsFinish(job as object) as object
    if job.transfer <> invalid
        remaining = 20000 - job.clock.TotalMilliseconds()
        ' wait(0) would wait for ever; 1 ms still picks up an answer that has already arrived.
        if remaining < 1 then remaining = 1
        msg = wait(remaining, job.port)
        body = ""
        if type(msg) = "roUrlEvent"
            if msg.GetResponseCode() = 200 then body = msg.GetString()
        else
            job.transfer.AsyncCancel()
        end if
        if body <> ""
            payload = parseRowsPayload(body)
            if payload.valid
                rowsWriteCache(body)
                return payload
            end if
        end if
    end if
    if job.cache <> invalid then return parseRowsPayload(job.cache.body)
    return parseRowsPayload("")
end function
