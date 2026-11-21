using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// Checks links and pictures before publishing. It only ever connects to public internet addresses (never the
    /// server itself or a private network), follows no redirects, and gives up after a few seconds.
    /// </summary>
    public static class LinkChecker
    {
        public static bool IsPublic(IPAddress ip)
        {
            if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
            if (IPAddress.IsLoopback(ip) || ip.Equals(IPAddress.Any) || ip.Equals(IPAddress.IPv6Any) || ip.Equals(IPAddress.Broadcast)) return false;
            var b = ip.GetAddressBytes();
            if (ip.AddressFamily == AddressFamily.InterNetwork)
                return !(b[0] == 10 || b[0] == 0 || b[0] == 127 || (b[0] == 172 && b[1] >= 16 && b[1] <= 31) || (b[0] == 192 && b[1] == 168)
                    || (b[0] == 169 && b[1] == 254) || (b[0] == 100 && b[1] >= 64 && b[1] <= 127) || b[0] >= 224);
            if (ip.AddressFamily == AddressFamily.InterNetworkV6)
                return !(ip.IsIPv6LinkLocal || ip.IsIPv6SiteLocal || ip.IsIPv6Multicast || (b[0] & 0xFE) == 0xFC);
            return false;
        }

        /// <summary>The connection step of the "linkcheck" HTTP client: refuses any address that isn't public.</summary>
        public static async ValueTask<System.IO.Stream> ConnectPublicAsync(SocketsHttpConnectionContext ctx, CancellationToken ct)
        {
            var addresses = await Dns.GetHostAddressesAsync(ctx.DnsEndPoint.Host, ct);
            var ip = addresses.FirstOrDefault(IsPublic) ?? throw new HttpRequestException("That address is not on the public internet.");
            if (addresses.Any(a => !IsPublic(a))) throw new HttpRequestException("That address is not on the public internet.");
            var socket = new Socket(ip.AddressFamily, SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
            try { await socket.ConnectAsync(new IPEndPoint(ip, ctx.DnsEndPoint.Port), ct); return new NetworkStream(socket, ownsSocket: true); }
            catch { socket.Dispose(); throw; }
        }

        public record Result(string Url, bool Ok, string Note);

        public static async Task<Result> CheckAsync(HttpClient http, string url, CancellationToken ct)
        {
            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || (uri.Scheme != "https" && uri.Scheme != "http")) return new(url, false, "Not a web address.");
            if (uri.Scheme == "http") return new(url, false, "Use https://.");
            try
            {
                using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                cts.CancelAfter(TimeSpan.FromSeconds(8));
                using var head = new HttpRequestMessage(HttpMethod.Head, uri);
                using var res = await http.SendAsync(head, HttpCompletionOption.ResponseHeadersRead, cts.Token);
                var code = (int)res.StatusCode;
                if (code is 405 or 403 or 501)
                {
                    using var get = new HttpRequestMessage(HttpMethod.Get, uri);
                    using var res2 = await http.SendAsync(get, HttpCompletionOption.ResponseHeadersRead, cts.Token);
                    code = (int)res2.StatusCode;
                }
                return code switch
                {
                    >= 200 and < 300 => new(url, true, "Works."),
                    >= 300 and < 400 => new(url, true, "Works (it moves on to another address)."),
                    404 or 410 => new(url, false, "Page not found."),
                    401 or 403 => new(url, true, "The site asks people to sign in or blocks checks; open it yourself to be sure."),
                    _ => new(url, false, $"The site answered {code}."),
                };
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested) { return new(url, false, "The site took too long to answer."); }
            catch (HttpRequestException ex) { return new(url, false, ex.Message.Contains("public internet") ? "Not a public web address." : "The site can't be reached."); }
        }

        private static readonly Regex UrlRx = new(@"https?://[^\s""'<>)\]]+", RegexOptions.Compiled);

        /// <summary>Every web address and every path on the website in a piece of content.</summary>
        public static (List<string> Links, List<string> Paths) Find(JsonNode? node)
        {
            var links = new List<string>(); var paths = new List<string>();
            void Walk(JsonNode? n, string key)
            {
                switch (n)
                {
                    case JsonObject o: foreach (var (k, v) in o) Walk(v, k); break;
                    case JsonArray a: foreach (var v in a) Walk(v, key); break;
                    case JsonValue v when v.TryGetValue<string>(out var s):
                        foreach (Match m in UrlRx.Matches(s)) links.Add(m.Value.TrimEnd('.', ',', ';'));
                        if (s.StartsWith('/') && !s.StartsWith("//") && key is "src" or "href" or "linkHref" or "to" or "profileImage" or "image") paths.Add(s.Split('#', '?')[0]);
                        break;
                }
            }
            Walk(node, "");
            return (links.Distinct().Take(30).ToList(), paths.Distinct().Take(30).ToList());
        }
    }
}
