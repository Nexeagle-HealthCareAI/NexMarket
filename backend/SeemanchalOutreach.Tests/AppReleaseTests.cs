using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using SeemanchalOutreach.Infrastructure.Services;
using Xunit;

namespace SeemanchalOutreach.Tests
{
    public class AppReleaseTests
    {
        private static (PrivateFileStore Store, string Root) LocalStore()
        {
            var root = Path.Combine(Path.GetTempPath(), "nexmarket-release-" + Guid.NewGuid().ToString("N"));
            var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Files:LocalPath"] = root }).Build();
            return (new PrivateFileStore(config, NullLogger<PrivateFileStore>.Instance), root);
        }

        private static void Put(string root, string key, string text)
        {
            var path = Path.Combine(root, key.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, text);
        }

        [Fact]
        public async Task A_published_build_can_be_read_with_its_size()
        {
            var (store, root) = LocalStore();
            Put(root, "app-releases/android/latest.json", "{\"version\":\"1.0.0\",\"build\":35}");
            var f = await store.OpenReleaseAsync("app-releases/android/latest.json");
            Assert.NotNull(f);
            await using var s = f!.Value.Content;
            Assert.Equal(new FileInfo(Path.Combine(root, "app-releases", "android", "latest.json")).Length, f.Value.Length);
            Directory.Delete(root, true);
        }

        [Fact]
        public async Task Only_the_release_folder_is_open_without_signing_in()
        {
            var (store, root) = LocalStore();
            Put(root, "chat/2026/11/13/secret.pdf", "private");
            Assert.Null(await store.OpenReleaseAsync("chat/2026/11/13/secret.pdf"));
            Assert.Null(await store.OpenReleaseAsync("app-releases/../chat/2026/11/13/secret.pdf"));
            Assert.Null(await store.OpenReleaseAsync("app-releases/android/missing.apk"));
            Assert.Null(await store.OpenReleaseAsync(""));
            Directory.Delete(root, true);
        }
    }
}
