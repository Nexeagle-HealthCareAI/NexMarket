using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using Xunit;

namespace SeemanchalOutreach.Tests
{
    /// <summary>One organisation must never see another's data. These are the rules that decide whose database, cache and files are used.</summary>
    public class OrganisationTests
    {
        private static readonly OrgInfo Alpha = new("alpha", "Alpha", "nm_alpha");
        private static readonly OrgInfo Beta = new("beta", "Beta", "nm_beta");
        private static readonly OrgInfo First = new("main", "Main", null);

        [Theory]
        [InlineData(" CityLab ", "citylab")]
        [InlineData("city-lab-2", "city-lab-2")]
        public void A_good_sign_in_name_is_accepted(string raw, string key) => Assert.Equal(key, OrgNames.Key(raw));

        [Theory]
        [InlineData("ab")]
        [InlineData("1lab")]
        [InlineData("a b")]
        [InlineData("lab;drop")]
        [InlineData("lab--x")]
        [InlineData("lab-")]
        [InlineData("x\"y")]
        [InlineData("nm_x")]
        [InlineData("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")]
        [InlineData(null)]
        public void A_bad_sign_in_name_is_refused(string? raw) => Assert.Null(OrgNames.Key(raw));

        [Fact]
        public void A_database_name_is_built_only_from_a_checked_name()
        {
            Assert.Equal("nm_city_lab", OrgNames.DatabaseFor("city-lab"));
            Assert.Throws<ArgumentException>(() => OrgNames.DatabaseFor("x; drop"));
        }

        [Fact]
        public void The_connection_points_at_the_organisations_own_database()
        {
            const string server = "Host=db;Database=nexmarket;Username=u;Password='p;x=1'";
            var c = OrgNames.Connection(server, "nm_citylab");
            Assert.Contains("nm_citylab", c, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("nexmarket", c);
            Assert.Contains("p;x=1", c);
            Assert.Equal(server, OrgNames.Connection(server, null));
        }

        [Fact]
        public async Task Work_keeps_its_own_organisation_through_waits_and_in_parallel()
        {
            Assert.Null(OrgScope.Current);
            using (OrgScope.Enter(Alpha))
            {
                await Task.Delay(5);
                Assert.Equal("alpha", OrgScope.Current?.Key);
                using (OrgScope.Enter(Beta)) { await Task.Delay(5); Assert.Equal("beta", OrgScope.Current?.Key); }
                Assert.Equal("alpha", OrgScope.Current?.Key);
            }
            Assert.Null(OrgScope.Current);

            var kept = await Task.WhenAll(Enumerable.Range(0, 200).Select(i => Task.Run(async () =>
            {
                var org = i % 2 == 0 ? Alpha : Beta;
                using (OrgScope.Enter(org)) { await Task.Delay(i % 7); return OrgScope.Current?.Key == org.Key; }
            })));
            Assert.All(kept, ok => Assert.True(ok));
        }

        [Fact]
        public void A_signed_in_person_cannot_be_moved_to_another_organisation()
        {
            Assert.Equal("alpha", OrgDirectory.KeyFor(true, "alpha", "beta", "beta", "beta"));
            Assert.Null(OrgDirectory.KeyFor(true, null, "beta", "beta", "beta"));   // an old token stays with the first organisation
        }

        [Fact]
        public void Before_sign_in_the_header_then_the_address_then_the_cookie_decide()
        {
            Assert.Equal("beta", OrgDirectory.KeyFor(false, null, "beta", "gamma", "alpha"));
            Assert.Equal("gamma", OrgDirectory.KeyFor(false, null, "", "gamma", "alpha"));
            Assert.Equal("alpha", OrgDirectory.KeyFor(false, null, "", "", "alpha"));
        }

        [Fact]
        public void Only_safe_rows_from_the_list_of_organisations_are_used()
        {
            var list = OrgDirectory.Pick(new (string, string, string?)[]
            {
                ("alpha", "Alpha", "nm_alpha"), ("main", "Fake first", "nm_x"), ("Bad Key", "x", "nm_y"),
                ("beta", "", "nm_alpha"), ("gamma", "G", null), ("alpha", "dup", "nm_z"), ("delta", "D", "nm_delta"),
            }, "main");
            Assert.Equal(new[] { "alpha", "delta" }, list.Select(o => o.Key).ToArray());
        }

        [Fact]
        public void Server_memory_is_kept_apart_per_organisation()
        {
            var cache = new OrgMemoryCache(new Microsoft.Extensions.Caching.Memory.MemoryCache(new Microsoft.Extensions.Caching.Memory.MemoryCacheOptions()));
            using (OrgScope.Enter(Alpha)) { using var e = cache.CreateEntry("lock"); e.Value = 1; }
            using (OrgScope.Enter(Beta)) Assert.False(cache.TryGetValue("lock", out _));
            Assert.False(cache.TryGetValue("lock", out _));
            using (OrgScope.Enter(Alpha)) Assert.True(cache.TryGetValue("lock", out _));
            Assert.Equal("k", OrgMemoryCache.KeyFor(First, "k"));    // the first organisation keeps its plain keys
        }

        [Fact]
        public void Live_groups_and_files_are_named_per_organisation()
        {
            Assert.Equal("dashboard", OrgKeys.Of(First, "dashboard"));
            Assert.NotEqual(OrgKeys.Of(Alpha, "user:MKT-1001"), OrgKeys.Of(Beta, "user:MKT-1001"));
            Assert.Equal("org/alpha/chat/a.jpg", OrgKeys.FileKey(Alpha, "chat/a.jpg"));
            Assert.Equal("chat/a.jpg", OrgKeys.FileKey(null, "chat/a.jpg"));
        }

        [Theory]
        [InlineData("org/alpha/chat/a.jpg", true)]
        [InlineData("org/beta/chat/a.jpg", false)]
        [InlineData("chat/a.jpg", false)]
        [InlineData("org/alpha/../beta/a.jpg", false)]
        [InlineData("org/alphabet/a.jpg", false)]
        [InlineData("", false)]
        public void An_organisation_opens_only_its_own_files(string key, bool allowed) => Assert.Equal(allowed, OrgKeys.OwnsFile(Alpha, key));

        [Fact]
        public void The_first_organisation_cannot_open_another_ones_files()
        {
            Assert.True(OrgKeys.OwnsFile(null, "chat/a.jpg"));
            Assert.False(OrgKeys.OwnsFile(null, "org/alpha/chat/a.jpg"));
        }
    }
}
