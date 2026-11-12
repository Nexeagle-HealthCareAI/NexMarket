using System.Text;
using SeemanchalOutreach.Api;
using SeemanchalOutreach.Api.Controllers;
using SeemanchalOutreach.Api.Security;
using Xunit;

namespace SeemanchalOutreach.Tests
{
    /// <summary>Uploaded files, deleting for ever, and who may use the Team board.</summary>
    public class DocsAndAccessTests
    {
        private static readonly byte[] Pdf = Encoding.ASCII.GetBytes("%PDF-1.7 ...");
        private static readonly byte[] Zip = { 0x50, 0x4B, 3, 4, 0, 0 };
        private static readonly byte[] Exe = { 0x4D, 0x5A, 0x90, 0 };
        private static readonly byte[] Png = { 0x89, 0x50, 0x4E, 0x47, 13, 10 };

        [Fact]
        public void A_file_must_be_what_its_name_says()
        {
            Assert.True(WorkDocsController.LooksLike(".pdf", Pdf));
            Assert.True(WorkDocsController.LooksLike(".PDF", Pdf));
            Assert.True(WorkDocsController.LooksLike(".docx", Zip));
            Assert.True(WorkDocsController.LooksLike(".png", Png));
            Assert.True(WorkDocsController.LooksLike(".txt", Encoding.UTF8.GetBytes("नमस्ते plan")));
        }

        [Fact]
        public void A_renamed_program_or_a_wrong_kind_is_refused()
        {
            Assert.False(WorkDocsController.LooksLike(".pdf", Exe));
            Assert.False(WorkDocsController.LooksLike(".pdf", Zip));
            Assert.False(WorkDocsController.LooksLike(".docx", Pdf));
            Assert.False(WorkDocsController.LooksLike(".jpg", Png));
            Assert.False(WorkDocsController.LooksLike(".txt", Exe));
            Assert.False(WorkDocsController.LooksLike(".pdf", Array.Empty<byte>()));
            Assert.False(WorkDocsController.LooksLike(".html", Encoding.ASCII.GetBytes("<html>")));
        }

        [Theory]
        [InlineData(".html")]
        [InlineData(".svg")]
        [InlineData(".exe")]
        [InlineData(".js")]
        public void Nothing_a_browser_would_run_can_be_uploaded(string ext) => Assert.False(WorkDocsController.Uploads.ContainsKey(ext));

        [Fact]
        public void Only_an_admin_or_the_writer_deletes_for_ever()
        {
            Assert.True(WorkDocsController.CanErase(true, "MM-1", "ADM-1"));
            Assert.True(WorkDocsController.CanErase(false, "MM-1", "MM-1"));
            Assert.False(WorkDocsController.CanErase(false, "MM-1", "ADM-1"));
            Assert.False(WorkDocsController.CanErase(false, "", ""));
        }

        [Fact]
        public void The_team_board_needs_its_page_permission()
        {
            foreach (var controller in new[] { typeof(WorkBoardController), typeof(WorkDocsController) })
            {
                var rule = controller.GetCustomAttributes(typeof(PageAccessAttribute), true).Cast<PageAccessAttribute>().FirstOrDefault();
                Assert.NotNull(rule);
                Assert.Equal(new[] { Pages.Work }, rule!.PageKeys);
            }
        }

        [Fact]
        public void Every_office_role_has_a_starting_level_for_every_page()
        {
            Assert.Equal(3, Pages.Defaults.Count);
            Assert.All(Pages.Defaults.Values, levels => Assert.All(Pages.All, page => Assert.True(levels.ContainsKey(page), page)));
            Assert.All(Pages.Defaults.Values, levels => Assert.Equal(Pages.Edit, levels[Pages.Work]));
        }

        [Theory]
        [InlineData("field_rep")]
        [InlineData("Field Agent")]
        [InlineData(null)]
        public void Field_agents_are_not_an_office_role(string? role) => Assert.Null(RoleChecks.CanonicalDashboardRole(role));
    }
}
