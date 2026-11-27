$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$RootDir = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($RootDir)) {
    $RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}

function Resolve-VaultRoot([string]$AppDir) {
    $cfgFile = Join-Path $AppDir "vault_path.txt"
    if (Test-Path -LiteralPath $cfgFile) {
        $raw = (Get-Content -LiteralPath $cfgFile -Encoding UTF8 -Raw).Trim()
        if ($raw -and (Test-Path -LiteralPath $raw)) {
            return (Resolve-Path -LiteralPath $raw).Path
        }
    }
    $markers = @("计算机A", "微观经济学", "微积分BC", "宏观经济学", "统计学", "化学", "心理学")
    $candidates = @()
    $p1 = Split-Path -Parent $AppDir
    if ($p1) {
        $candidates += $p1
        $p2 = Split-Path -Parent $p1
        if ($p2) { $candidates += $p2 }
    }
    $candidates += (Join-Path $AppDir "AP_Vault")
    $candidates += $AppDir

    foreach ($cand in $candidates) {
        if (-not $cand -or -not (Test-Path -LiteralPath $cand)) { continue }
        foreach ($m in $markers) {
            if (Test-Path -LiteralPath (Join-Path $cand $m)) {
                return (Resolve-Path -LiteralPath $cand).Path
            }
        }
    }
    return ""
}

$VaultRoot = Resolve-VaultRoot $RootDir
$VaultFound = -not [string]::IsNullOrWhiteSpace($VaultRoot)

$csCode = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

public class APExamHttpServer
{
    private readonly string _rootDir;
    private readonly string _vaultRoot;
    private readonly bool _vaultFound;
    private readonly int _port;
    private readonly TcpListener _listener;
    private volatile bool _running;
    private Thread _acceptThread;
    private static readonly Dictionary<string, string> MimeTypes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        { ".html", "text/html; charset=utf-8" },
        { ".htm", "text/html; charset=utf-8" },
        { ".js", "application/javascript; charset=utf-8" },
        { ".mjs", "application/javascript; charset=utf-8" },
        { ".css", "text/css; charset=utf-8" },
        { ".json", "application/json; charset=utf-8" },
        { ".svg", "image/svg+xml" },
        { ".png", "image/png" },
        { ".jpg", "image/jpeg" },
        { ".jpeg", "image/jpeg" },
        { ".gif", "image/gif" },
        { ".webp", "image/webp" },
        { ".wav", "audio/wav" },
        { ".mp4", "video/mp4" },
        { ".woff2", "font/woff2" },
        { ".woff", "font/woff" },
        { ".ttf", "font/ttf" },
        { ".bcmap", "application/octet-stream" },
        { ".pdf", "application/pdf" },
        { ".md", "text/markdown; charset=utf-8" },
        { ".txt", "text/plain; charset=utf-8" }
    };

    public APExamHttpServer(string rootDir, string vaultRoot, bool vaultFound, int port)
    {
        _rootDir = Path.GetFullPath(rootDir);
        _vaultRoot = string.IsNullOrEmpty(vaultRoot) ? "" : Path.GetFullPath(vaultRoot);
        _vaultFound = vaultFound;
        _port = port;
        _listener = new TcpListener(IPAddress.Loopback, _port);
    }

    public int Port { get { return _port; } }

    public void Start()
    {
        _listener.Start(64);
        _running = true;
        _acceptThread = new Thread(AcceptLoop);
        _acceptThread.IsBackground = true;
        _acceptThread.Start();
    }

    public void Stop()
    {
        _running = false;
        try { _listener.Stop(); } catch { }
    }

    private void AcceptLoop()
    {
        while (_running)
        {
            try
            {
                TcpClient client = _listener.AcceptTcpClient();
                ThreadPool.QueueUserWorkItem(HandleClient, client);
            }
            catch
            {
                if (!_running) break;
            }
        }
    }

    private void HandleClient(object obj)
    {
        using (TcpClient client = (TcpClient)obj)
        {
            client.ReceiveTimeout = 15000;
            client.SendTimeout = 30000;
            try
            {
                using (NetworkStream stream = client.GetStream())
                {
                    Dispatch(stream);
                }
            }
            catch { }
        }
    }

    private void Dispatch(NetworkStream stream)
    {
        string headerText;
        byte[] extraBody;
        if (!ReadHttpHeaders(stream, out headerText, out extraBody)) return;

        string[] lines = headerText.Split(new[] { "\r\n" }, StringSplitOptions.None);
        if (lines.Length == 0) return;
        string[] reqParts = lines[0].Split(' ');
        if (reqParts.Length < 2) return;

        string method = reqParts[0].ToUpperInvariant();
        string rawTarget = reqParts[1];
        Dictionary<string, string> headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (int i = 1; i < lines.Length; i++)
        {
            int colon = lines[i].IndexOf(':');
            if (colon > 0)
            {
                string hk = lines[i].Substring(0, colon).Trim();
                string hv = lines[i].Substring(colon + 1).Trim();
                headers[hk] = hv;
            }
        }

        int qIdx = rawTarget.IndexOf('?');
        string pathPart = qIdx >= 0 ? rawTarget.Substring(0, qIdx) : rawTarget;
        string queryPart = qIdx >= 0 ? rawTarget.Substring(qIdx + 1) : "";
        Dictionary<string, string> query = ParseQuery(queryPart);

        int contentLen = 0;
        if (headers.ContainsKey("Content-Length"))
        {
            int.TryParse(headers["Content-Length"], out contentLen);
        }
        byte[] bodyBytes = new byte[0];
        if (contentLen > 0)
        {
            bodyBytes = ReadExactBody(stream, extraBody, contentLen);
        }

        if (method == "OPTIONS")
        {
            WriteResponse(stream, 204, "No Content", "text/plain", new byte[0], null);
            return;
        }

        if (method == "GET" && pathPart == "/health")
        {
            WriteJson(stream, 200, "{\"ok\":true}");
            return;
        }

        if (method == "GET" && pathPart == "/server-info")
        {
            string jc, jv;
            bool hasJava = FindJdkTools(out jc, out jv);
            JavaScriptSerializer js = new JavaScriptSerializer();
            string json = js.Serialize(new Dictionary<string, object>
            {
                { "platform", "windows" },
                { "pdfEngine", "pdfjs" },
                { "hasJava", hasJava },
                { "vaultFound", _vaultFound },
                { "vaultRoot", _vaultRoot }
            });
            WriteJson(stream, 200, json);
            return;
        }

        if (method == "GET" && pathPart == "/pdf-raw")
        {
            string rel = query.ContainsKey("path") ? query["path"] : "";
            string full = SafeResolve(_vaultRoot, rel);
            if (full == null || !File.Exists(full))
            {
                WriteText(stream, 404, "Not Found", "PDF not found");
                return;
            }
            ServeFile(stream, full, "application/pdf", headers);
            return;
        }

        if (method == "GET" && pathPart == "/open-pdf")
        {
            string rel = query.ContainsKey("path") ? query["path"] : "";
            string full = SafeResolve(_vaultRoot, rel);
            if (full == null || !File.Exists(full))
            {
                WriteText(stream, 404, "Not Found", "PDF not found");
                return;
            }
            Dictionary<string, string> redir = new Dictionary<string, string>();
            redir["Location"] = "/pdf-raw?path=" + Uri.EscapeDataString(rel);
            WriteResponse(stream, 302, "Found", "text/plain; charset=utf-8", new byte[0], redir);
            return;
        }

        if (method == "GET" && (pathPart == "/pdf-info" || pathPart == "/pdf-page"))
        {
            WriteJson(stream, 501, "{\"error\":\"use_pdfjs\"}");
            return;
        }

        if (method == "GET")
        {
            string decoded = Uri.UnescapeDataString(pathPart);
            if (decoded.StartsWith("/大陆统计_2026_视频/"))
            {
                string rel = decoded.TrimStart('/');
                string full = SafeResolve(_vaultRoot, "模考系统/" + rel);
                if ((full == null || !File.Exists(full)) && rel.StartsWith("大陆统计_2026_视频/CSA/"))
                {
                    string csaSub = rel.Substring("大陆统计_2026_视频/CSA/".Length);
                    full = SafeResolve(_vaultRoot, "计算机A/题目解析视频/" + csaSub);
                }
                if (full == null || !File.Exists(full))
                {
                    WriteText(stream, 404, "Not Found", "Video not found");
                    return;
                }
                ServeFile(stream, full, GetMime(full), headers);
                return;
            }

            string localRel = decoded.TrimStart('/');
            if (string.IsNullOrEmpty(localRel)) localRel = "index.html";
            string staticPath = SafeResolve(_rootDir, localRel);
            if (staticPath != null && File.Exists(staticPath))
            {
                ServeFile(stream, staticPath, GetMime(staticPath), headers);
                return;
            }
            WriteText(stream, 404, "Not Found", "File not found");
            return;
        }

        if (method == "POST" && pathPart == "/local-proxy")
        {
            HandleLocalProxy(stream, bodyBytes);
            return;
        }

        if (method == "POST" && pathPart == "/run-java")
        {
            HandleRunJava(stream, bodyBytes);
            return;
        }

        WriteText(stream, 404, "Not Found", "Unsupported route");
    }

    private void HandleLocalProxy(NetworkStream stream, byte[] bodyBytes)
    {
        try
        {
            JavaScriptSerializer js = new JavaScriptSerializer();
            js.MaxJsonLength = 64 * 1024 * 1024;
            string reqText = Encoding.UTF8.GetString(bodyBytes);
            Dictionary<string, object> payload = js.Deserialize<Dictionary<string, object>>(reqText);
            string targetUrl = payload != null && payload.ContainsKey("url") ? Convert.ToString(payload["url"]) : "";
            Uri uri;
            if (!Uri.TryCreate(targetUrl, UriKind.Absolute, out uri) ||
                (uri.Host != "127.0.0.1" && !string.Equals(uri.Host, "localhost", StringComparison.OrdinalIgnoreCase)))
            {
                WriteText(stream, 403, "Forbidden", "Only localhost targets allowed");
                return;
            }

            HttpWebRequest req = (HttpWebRequest)WebRequest.Create(uri);
            req.Proxy = null;
            req.Timeout = 15000;
            req.Method = payload.ContainsKey("method") && payload["method"] != null ? Convert.ToString(payload["method"]) : "POST";
            req.ContentType = "application/json; charset=utf-8";

            if (payload.ContainsKey("headers") && payload["headers"] is Dictionary<string, object>)
            {
                Dictionary<string, object> hdrs = (Dictionary<string, object>)payload["headers"];
                foreach (KeyValuePair<string, object> kv in hdrs)
                {
                    if (string.Equals(kv.Key, "Content-Type", StringComparison.OrdinalIgnoreCase))
                        req.ContentType = Convert.ToString(kv.Value);
                    else if (!WebHeaderCollection.IsRestricted(kv.Key))
                        req.Headers[kv.Key] = Convert.ToString(kv.Value);
                }
            }

            string innerBody = payload.ContainsKey("body") && payload["body"] != null ? Convert.ToString(payload["body"]) : "";
            byte[] outBytes = Encoding.UTF8.GetBytes(innerBody);
            if (req.Method != "GET" && req.Method != "HEAD")
            {
                req.ContentLength = outBytes.Length;
                using (Stream rs = req.GetRequestStream())
                {
                    rs.Write(outBytes, 0, outBytes.Length);
                }
            }

            using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
            using (MemoryStream ms = new MemoryStream())
            {
                Stream s = resp.GetResponseStream();
                if (s != null) s.CopyTo(ms);
                WriteResponse(stream, (int)resp.StatusCode, resp.StatusDescription, "application/json; charset=utf-8", ms.ToArray(), null);
            }
        }
        catch (Exception ex)
        {
            JavaScriptSerializer js = new JavaScriptSerializer();
            string errJson = js.Serialize(new Dictionary<string, object> { { "error", ex.Message } });
            WriteJson(stream, 502, errJson);
        }
    }

    private void HandleRunJava(NetworkStream stream, byte[] bodyBytes)
    {
        JavaScriptSerializer js = new JavaScriptSerializer();
        try
        {
            string reqText = Encoding.UTF8.GetString(bodyBytes);
            Dictionary<string, object> payload = js.Deserialize<Dictionary<string, object>>(reqText);
            string rawCode = payload != null && payload.ContainsKey("code") && payload["code"] != null ? Convert.ToString(payload["code"]) : "";
            Dictionary<string, object> res = RunJavaSnippet(rawCode);
            WriteJson(stream, 200, js.Serialize(res));
        }
        catch (Exception ex)
        {
            WriteJson(stream, 200, js.Serialize(new Dictionary<string, object>
            {
                { "ok", false },
                { "output", ex.Message }
            }));
        }
    }

    private Dictionary<string, object> RunJavaSnippet(string rawCode)
    {
        Dictionary<string, object> result = new Dictionary<string, object>();
        string trimmed = rawCode == null ? "" : rawCode.Trim();
        if (trimmed.Length == 0)
        {
            result["ok"] = false;
            result["output"] = "Editor is empty. Enter Java statements, methods, or a class first.";
            return result;
        }

        string javacPath, javaPath;
        if (!FindJdkTools(out javacPath, out javaPath))
        {
            result["ok"] = false;
            result["output"] = "未检测到本机 JDK（javac.exe）。当前电脑无需安装任何依赖即可刷题、看 PDF、用 Desmos 与错题本；如需在本地运行 CSA Java 代码，安装免费 JDK（如 Eclipse Temurin JDK 17/21）后重启即可。";
            return result;
        }

        string tmpDir = Path.Combine(Path.GetTempPath(), "apexam_java_" + Guid.NewGuid().ToString("N").Substring(0, 8));
        Directory.CreateDirectory(tmpDir);
        try
        {
            string className = "Main";
            string fileStem = "Main";
            string src = rawCode;
            bool hasMain = rawCode.Contains("static void main");

            Match mPub = Regex.Match(rawCode, @"public\s+class\s+([A-Za-z_]\w*)");
            Match mCls = Regex.Match(rawCode, @"\bclass\s+([A-Za-z_]\w*)");
            if (mPub.Success)
            {
                className = fileStem = mPub.Groups[1].Value;
                if (!hasMain && rawCode.Contains("}"))
                {
                    int idx = rawCode.LastIndexOf("}");
                    src = rawCode.Substring(0, idx) + "\n    public static void main(String[] args) { System.out.println(\"Compiled successfully! (Add static void main or call your methods inside main to run tests.)\"); }\n}\n";
                    hasMain = true;
                }
            }
            else if (mCls.Success)
            {
                className = fileStem = mCls.Groups[1].Value;
                if (!hasMain)
                {
                    src = rawCode + "\nclass _Runner {\n    public static void main(String[] args) { System.out.println(\"Compiled successfully (0 syntax errors).\"); }\n}\n";
                    className = "_Runner";
                    hasMain = true;
                }
            }
            else if (Regex.IsMatch(rawCode, @"(?:^|\n)\s*(?:public|private|static)\s+[\w<>\[\]]+\s+\w+\s*\("))
            {
                src = "import java.util.*;\npublic class Main {\n" + rawCode + "\n    public static void main(String[] args) { System.out.println(\"Method(s) compiled cleanly (0 syntax errors).\"); }\n}\n";
                hasMain = true;
            }
            else
            {
                src = "import java.util.*;\npublic class Main {\n    public static void main(String[] args) {\n" + rawCode + "\n    }\n}\n";
                hasMain = true;
            }

            string srcFile = Path.Combine(tmpDir, fileStem + ".java");
            File.WriteAllText(srcFile, src, new UTF8Encoding(false));

            string cOut;
            int cExit = RunProcess(javacPath, "-encoding UTF-8 -d \"" + tmpDir + "\" \"" + srcFile + "\"", 8000, out cOut);
            if (cExit != 0)
            {
                result["ok"] = false;
                result["output"] = string.IsNullOrEmpty(cOut) ? "Compilation failed." : cOut;
                return result;
            }
            if (!hasMain)
            {
                result["ok"] = true;
                result["output"] = "Compiled successfully (0 errors).";
                return result;
            }

            string rOut;
            int rExit = RunProcess(javaPath, "-Xmx128m -Dfile.encoding=UTF-8 -cp \"" + tmpDir + "\" " + className, 5000, out rOut);
            if (rExit == -999)
            {
                result["ok"] = false;
                result["output"] = "Execution timed out (limit: 5s).";
                return result;
            }
            result["ok"] = (rExit == 0);
            result["output"] = !string.IsNullOrEmpty(rOut) ? rOut : (rExit == 0 ? "(Program finished with exit code 0 and no stdout.)" : "Runtime error (exit " + rExit + ").");
            return result;
        }
        finally
        {
            try { Directory.Delete(tmpDir, true); } catch { }
        }
    }

    private static int RunProcess(string exe, string args, int timeoutMs, out string combinedOutput)
    {
        ProcessStartInfo psi = new ProcessStartInfo(exe, args);
        psi.CreateNoWindow = true;
        psi.UseShellExecute = false;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.StandardOutputEncoding = Encoding.UTF8;
        psi.StandardErrorEncoding = Encoding.UTF8;
        using (Process p = Process.Start(psi))
        {
            string stdout = p.StandardOutput.ReadToEnd();
            string stderr = p.StandardError.ReadToEnd();
            if (!p.WaitForExit(timeoutMs))
            {
                try { p.Kill(); } catch { }
                combinedOutput = "Timeout";
                return -999;
            }
            combinedOutput = ((stdout ?? "") + (stderr ?? "")).Trim();
            return p.ExitCode;
        }
    }

    private static bool FindJdkTools(out string javacPath, out string javaPath)
    {
        javacPath = FindExeInPath("javac.exe");
        javaPath = FindExeInPath("java.exe");
        if (!string.IsNullOrEmpty(javacPath) && !string.IsNullOrEmpty(javaPath)) return true;

        List<string> homes = new List<string>();
        string jh = Environment.GetEnvironmentVariable("JAVA_HOME");
        if (!string.IsNullOrEmpty(jh)) homes.Add(jh);
        string[] roots = new[] {
            @"C:\Program Files\Java",
            @"C:\Program Files\Eclipse Adoptium",
            @"C:\Program Files\Microsoft",
            @"C:\Program Files\Zulu",
            @"C:\Program Files\BellSoft",
            @"C:\Program Files\Amazon Corretto"
        };
        foreach (string r in roots)
        {
            try
            {
                if (Directory.Exists(r))
                {
                    foreach (string sub in Directory.GetDirectories(r)) homes.Add(sub);
                }
            }
            catch { }
        }
        foreach (string h in homes)
        {
            string jc = Path.Combine(h, "bin", "javac.exe");
            string jv = Path.Combine(h, "bin", "java.exe");
            if (File.Exists(jc) && File.Exists(jv))
            {
                javacPath = jc;
                javaPath = jv;
                return true;
            }
        }
        javacPath = "";
        javaPath = "";
        return false;
    }

    private static string FindExeInPath(string name)
    {
        string pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (string dir in pathEnv.Split(';'))
        {
            if (string.IsNullOrWhiteSpace(dir)) continue;
            try
            {
                string cand = Path.Combine(dir.Trim(), name);
                if (File.Exists(cand)) return cand;
            }
            catch { }
        }
        return "";
    }

    private void ServeFile(NetworkStream stream, string filePath, string contentType, Dictionary<string, string> headers)
    {
        FileInfo fi = new FileInfo(filePath);
        long size = fi.Length;
        string rangeHdr = headers.ContainsKey("Range") ? headers["Range"] : null;
        if (!string.IsNullOrEmpty(rangeHdr))
        {
            Match m = Regex.Match(rangeHdr.Trim(), @"bytes=(\d*)-(\d*)");
            if (m.Success)
            {
                long start = string.IsNullOrEmpty(m.Groups[1].Value) ? 0 : long.Parse(m.Groups[1].Value);
                long end = string.IsNullOrEmpty(m.Groups[2].Value) ? (size - 1) : long.Parse(m.Groups[2].Value);
                if (end >= size) end = size - 1;
                if (size == 0 || start > end || start >= size)
                {
                    Dictionary<string, string> h416 = new Dictionary<string, string>();
                    h416["Content-Range"] = "bytes */" + size;
                    WriteResponse(stream, 416, "Range Not Satisfiable", "text/plain", new byte[0], h416);
                    return;
                }
                long length = end - start + 1;
                Dictionary<string, string> h206 = new Dictionary<string, string>();
                h206["Accept-Ranges"] = "bytes";
                h206["Content-Range"] = "bytes " + start + "-" + end + "/" + size;
                WriteResponseHeader(stream, 206, "Partial Content", contentType, length, h206);
                using (FileStream fs = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                {
                    fs.Seek(start, SeekOrigin.Begin);
                    CopyExact(fs, stream, length);
                }
                stream.Flush();
                return;
            }
        }
        Dictionary<string, string> extra = new Dictionary<string, string>();
        extra["Accept-Ranges"] = "bytes";
        WriteResponseHeader(stream, 200, "OK", contentType, size, extra);
        using (FileStream fs = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
        {
            fs.CopyTo(stream);
        }
        stream.Flush();
    }

    private static void CopyExact(Stream src, Stream dst, long count)
    {
        byte[] buf = new byte[65536];
        long left = count;
        while (left > 0)
        {
            int toRead = (int)Math.Min(buf.Length, left);
            int read = src.Read(buf, 0, toRead);
            if (read <= 0) break;
            dst.Write(buf, 0, read);
            left -= read;
        }
    }

    private static string SafeResolve(string baseDir, string rel)
    {
        if (string.IsNullOrEmpty(baseDir)) return null;
        try
        {
            string cleaned = (rel ?? "").Replace('\\', '/').TrimStart('/');
            if (cleaned.Contains("..")) return null;
            string[] parts = cleaned.Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries);
            string combined = baseDir;
            foreach (string p in parts) combined = Path.Combine(combined, p);
            string fullBase = Path.GetFullPath(baseDir).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
            string fullTarget = Path.GetFullPath(combined);
            if (fullTarget.Equals(fullBase.TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase) ||
                fullTarget.StartsWith(fullBase, StringComparison.OrdinalIgnoreCase))
            {
                return fullTarget;
            }
        }
        catch { }
        return null;
    }

    private static string GetMime(string filePath)
    {
        string ext = Path.GetExtension(filePath);
        string m;
        if (!string.IsNullOrEmpty(ext) && MimeTypes.TryGetValue(ext, out m)) return m;
        return "application/octet-stream";
    }

    private static Dictionary<string, string> ParseQuery(string qs)
    {
        Dictionary<string, string> map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrEmpty(qs)) return map;
        foreach (string pair in qs.Split('&'))
        {
            if (string.IsNullOrEmpty(pair)) continue;
            int eq = pair.IndexOf('=');
            if (eq >= 0)
            {
                string k = Uri.UnescapeDataString(pair.Substring(0, eq).Replace('+', ' '));
                string v = Uri.UnescapeDataString(pair.Substring(eq + 1).Replace('+', ' '));
                map[k] = v;
            }
        }
        return map;
    }

    private static bool ReadHttpHeaders(NetworkStream stream, out string headerText, out byte[] extraBody)
    {
        MemoryStream ms = new MemoryStream();
        byte[] buf = new byte[4096];
        int endPos = -1;
        while (ms.Length < 65536)
        {
            int n = stream.Read(buf, 0, buf.Length);
            if (n <= 0) break;
            ms.Write(buf, 0, n);
            byte[] arr = ms.GetBuffer();
            int len = (int)ms.Length;
            for (int i = 0; i <= len - 4; i++)
            {
                if (arr[i] == 13 && arr[i + 1] == 10 && arr[i + 2] == 13 && arr[i + 3] == 10)
                {
                    endPos = i;
                    break;
                }
            }
            if (endPos >= 0) break;
        }
        if (endPos < 0)
        {
            headerText = "";
            extraBody = new byte[0];
            return false;
        }
        byte[] all = ms.ToArray();
        headerText = Encoding.ASCII.GetString(all, 0, endPos);
        int bodyStart = endPos + 4;
        extraBody = new byte[all.Length - bodyStart];
        if (extraBody.Length > 0) Array.Copy(all, bodyStart, extraBody, 0, extraBody.Length);
        return true;
    }

    private static byte[] ReadExactBody(NetworkStream stream, byte[] extraBody, int contentLength)
    {
        byte[] result = new byte[contentLength];
        int copied = Math.Min(extraBody.Length, contentLength);
        if (copied > 0) Array.Copy(extraBody, 0, result, 0, copied);
        int offset = copied;
        while (offset < contentLength)
        {
            int n = stream.Read(result, offset, contentLength - offset);
            if (n <= 0) break;
            offset += n;
        }
        return result;
    }

    private static void WriteJson(NetworkStream stream, int code, string json)
    {
        WriteResponse(stream, code, code == 200 ? "OK" : "Error", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(json), null);
    }

    private static void WriteText(NetworkStream stream, int code, string status, string text)
    {
        WriteResponse(stream, code, status, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(text), null);
    }

    private static void WriteResponse(NetworkStream stream, int code, string status, string contentType, byte[] body, Dictionary<string, string> extraHeaders)
    {
        WriteResponseHeader(stream, code, status, contentType, body.Length, extraHeaders);
        if (body.Length > 0) stream.Write(body, 0, body.Length);
        stream.Flush();
    }

    private static void WriteResponseHeader(NetworkStream stream, int code, string status, string contentType, long contentLength, Dictionary<string, string> extraHeaders)
    {
        StringBuilder sb = new StringBuilder();
        sb.Append("HTTP/1.1 ").Append(code).Append(' ').Append(status).Append("\r\n");
        sb.Append("Content-Type: ").Append(contentType).Append("\r\n");
        sb.Append("Content-Length: ").Append(contentLength).Append("\r\n");
        sb.Append("Access-Control-Allow-Origin: *\r\n");
        sb.Append("Access-Control-Allow-Headers: *\r\n");
        sb.Append("Cache-Control: no-cache\r\n");
        sb.Append("Connection: close\r\n");
        if (extraHeaders != null)
        {
            foreach (KeyValuePair<string, string> kv in extraHeaders)
            {
                sb.Append(kv.Key).Append(": ").Append(kv.Value).Append("\r\n");
            }
        }
        sb.Append("\r\n");
        byte[] hdrBytes = Encoding.ASCII.GetBytes(sb.ToString());
        stream.Write(hdrBytes, 0, hdrBytes.Length);
    }
}
'@

if (-not ("APExamHttpServer" -as [type])) {
    Add-Type -TypeDefinition $csCode -ReferencedAssemblies @("System.Web.Extensions")
}

$Port = 0
for ($p = 18990; $p -le 19015; $p++) {
    try {
        $probe = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $p)
        $probe.Start()
        $probe.Stop()
        $Port = $p
        break
    } catch { }
}
if ($Port -eq 0) {
    Write-Host "[ERROR] Ports 18990-19015 are all in use." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

$server = New-Object APExamHttpServer($RootDir, $VaultRoot, $VaultFound, $Port)
$server.Start()

$Url = "http://127.0.0.1:$Port/index.html"
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host " AP Exam Room (Zero-Dependency Windows Server)" -ForegroundColor Cyan
Write-Host " URL       : $Url"
Write-Host " Vault PDF : $(if ($VaultFound) { $VaultRoot } else { 'Not linked (98 native exams still offline ready!)' })"
Write-Host " PDF Mode  : Built-in Offline PDF.js (No external runtime needed)"
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "Keep this window open while using AP Exam Room."
Write-Host "Close this window (or press Ctrl+C) when finished."

function Find-Browser {
    $cands = @(
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
    )
    foreach ($c in $cands) {
        if ($c -and (Test-Path -LiteralPath $c)) { return $c }
    }
    return ""
}

$Browser = Find-Browser
try {
    if ($Browser) {
        $ProfileDir = Join-Path $env:LocalAppData "APExamRoom\Profile"
        New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
        $argStr = "--app=`"$Url`" --user-data-dir=`"$ProfileDir`" --no-first-run --no-default-browser-check --disable-features=Translate"
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        $proc = Start-Process -FilePath $Browser -ArgumentList $argStr -PassThru
        if ($proc) {
            $proc.WaitForExit()
            if ($sw.Elapsed.TotalSeconds -lt 3) {
                while ($true) { Start-Sleep -Seconds 2 }
            }
        } else {
            while ($true) { Start-Sleep -Seconds 2 }
        }
    } else {
        Start-Process $Url
        while ($true) { Start-Sleep -Seconds 2 }
    }
} finally {
    $server.Stop()
}
