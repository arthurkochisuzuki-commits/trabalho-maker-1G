$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:8080/")
$listener.Start()
Write-Host "Server started at http://localhost:8080/"
$baseDir = $PSScriptRoot

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $req = $context.Request
        $res = $context.Response

        $relPath = $req.Url.LocalPath
        if ($relPath -eq "/") { $relPath = "/index.html" }
        $filePath = Join-Path $baseDir ($relPath.TrimStart('/').Replace('/', '\'))

        if (Test-Path -PathType Leaf $filePath) {
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            if ($filePath.EndsWith(".html")) { $res.ContentType = "text/html; charset=utf-8" }
            elseif ($filePath.EndsWith(".css")) { $res.ContentType = "text/css; charset=utf-8" }
            elseif ($filePath.EndsWith(".js")) { $res.ContentType = "text/javascript; charset=utf-8" }
            elseif ($filePath.EndsWith(".json")) { $res.ContentType = "application/json; charset=utf-8" }
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $res.StatusCode = 404
        }
        $res.Close()
    }
} finally {
    $listener.Stop()
}
