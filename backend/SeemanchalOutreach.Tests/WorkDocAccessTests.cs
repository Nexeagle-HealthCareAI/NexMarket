using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Domain.Entities;
using Xunit;

namespace SeemanchalOutreach.Tests
{
    /// <summary>Folders, private documents and sharing on the Team board.</summary>
    public class WorkDocAccessTests
    {
        private static WorkDocFolder F(string name, string owner, string access = "team", Guid? parent = null) =>
            new() { Name = name, CreatedBy = owner, Access = access, ParentId = parent };
        private static WorkDoc D(string owner, string access = "team", Guid? folder = null) =>
            new() { Title = "x", CreatedBy = owner, Access = access, FolderId = folder };
        private static WorkDocShare S(string who, string role, Guid? doc = null, Guid? folder = null) =>
            new() { AgentId = who, Role = role, DocId = doc, FolderId = folder };

        [Fact]
        public void Team_documents_at_the_top_are_open_to_everyone_to_edit()
        {
            var ctx = new DocAccess.Context("MM-2", Array.Empty<WorkDocFolder>(), Array.Empty<WorkDocShare>());
            Assert.Equal(DocAccess.Edit, ctx.Doc(D("MM-1")));
            Assert.Equal(DocAccess.Owner, new DocAccess.Context("MM-1", Array.Empty<WorkDocFolder>(), Array.Empty<WorkDocShare>()).Doc(D("MM-1")));
        }

        [Fact]
        public void A_private_document_is_only_for_its_owner_even_an_admin_does_not_see_it()
        {
            var doc = D("MM-1", "restricted");
            Assert.Equal(DocAccess.Owner, new DocAccess.Context("MM-1", Array.Empty<WorkDocFolder>(), Array.Empty<WorkDocShare>()).Doc(doc));
            Assert.Equal(DocAccess.None, new DocAccess.Context("ADM-1", Array.Empty<WorkDocFolder>(), Array.Empty<WorkDocShare>()).Doc(doc));
        }

        [Fact]
        public void Sharing_a_private_document_gives_that_person_exactly_their_role()
        {
            var doc = D("MM-1", "restricted");
            var shares = new[] { S("MM-2", "comment", doc: doc.Id), S("MM-3", "view", doc: doc.Id) };
            Assert.Equal(DocAccess.Comment, new DocAccess.Context("MM-2", Array.Empty<WorkDocFolder>(), shares).Doc(doc));
            Assert.Equal(DocAccess.View, new DocAccess.Context("MM-3", Array.Empty<WorkDocFolder>(), shares).Doc(doc));
            Assert.Equal(DocAccess.None, new DocAccess.Context("MM-4", Array.Empty<WorkDocFolder>(), shares).Doc(doc));
        }

        [Fact]
        public void A_private_folder_hides_the_team_documents_inside_it()
        {
            var mine = F("Mine", "MM-1", "restricted");
            var sub = F("Inside", "MM-1", "team", mine.Id);
            var doc = D("MM-1", "team", sub.Id);
            var other = new DocAccess.Context("MM-2", new[] { mine, sub }, Array.Empty<WorkDocShare>());
            Assert.Equal(DocAccess.None, other.Folder(mine.Id));
            Assert.Equal(DocAccess.None, other.Folder(sub.Id));
            Assert.Equal(DocAccess.None, other.Doc(D("MM-3", "team", sub.Id)));
            Assert.Equal(DocAccess.Owner, new DocAccess.Context("MM-1", new[] { mine, sub }, Array.Empty<WorkDocShare>()).Doc(doc));
        }

        [Fact]
        public void Sharing_a_folder_passes_down_but_never_above_what_was_given()
        {
            var mine = F("Mine", "MM-1", "restricted");
            var sub = F("Inside", "MM-1", "team", mine.Id);
            var ctx = new DocAccess.Context("MM-2", new[] { mine, sub }, new[] { S("MM-2", "view", folder: mine.Id) });
            Assert.Equal(DocAccess.View, ctx.Folder(mine.Id));
            Assert.Equal(DocAccess.View, ctx.Folder(sub.Id));
            Assert.Equal(DocAccess.View, ctx.Doc(D("MM-1", "team", sub.Id)));
            Assert.Equal(DocAccess.None, ctx.Doc(D("MM-1", "restricted", sub.Id)));   // a private document inside stays private
            Assert.True(ctx.InTree(sub.Id));
        }

        [Fact]
        public void A_document_shared_directly_opens_even_inside_a_folder_the_person_cannot_see()
        {
            var mine = F("Mine", "MM-1", "restricted");
            var doc = D("MM-1", "team", mine.Id);
            var ctx = new DocAccess.Context("MM-2", new[] { mine }, new[] { S("MM-2", "edit", doc: doc.Id) });
            Assert.Equal(DocAccess.Edit, ctx.Doc(doc));
            Assert.False(ctx.InTree(mine.Id));
            Assert.True(ctx.SharedDoc(doc.Id));
        }

        [Fact]
        public void Only_another_persons_shares_count_for_them()
        {
            var doc = D("MM-1", "restricted");
            var ctx = new DocAccess.Context("MM-2", Array.Empty<WorkDocFolder>(), new[] { S("MM-3", "edit", doc: doc.Id) });
            Assert.Equal(DocAccess.None, ctx.Doc(doc));
        }

        [Fact]
        public void A_folder_cannot_move_inside_itself()
        {
            var a = F("A", "MM-1");
            var b = F("B", "MM-1", parent: a.Id);
            var c = F("C", "MM-1", parent: b.Id);
            var ctx = new DocAccess.Context("MM-1", new[] { a, b, c }, Array.Empty<WorkDocShare>());
            Assert.True(ctx.IsInside(c.Id, a.Id));
            Assert.True(ctx.IsInside(a.Id, a.Id));
            Assert.False(ctx.IsInside(null, a.Id));
            Assert.False(ctx.IsInside(a.Id, c.Id));
            Assert.Equal("A,B,C", string.Join(",", ctx.PathTo(c.Id).Select(f => f.Name)));
        }

        [Fact]
        public void A_folder_loop_in_the_data_does_not_hang()
        {
            var a = F("A", "MM-1");
            var b = F("B", "MM-1", parent: a.Id);
            a.ParentId = b.Id;
            var ctx = new DocAccess.Context("MM-2", new[] { a, b }, Array.Empty<WorkDocShare>());
            Assert.Equal(DocAccess.Edit, ctx.Folder(a.Id));
            Assert.True(ctx.PathTo(a.Id).Count <= 31);
        }

        [Fact]
        public void Who_may_share_and_who_may_make_private()
        {
            Assert.True(DocAccess.CanShare(DocAccess.Owner, "restricted"));
            Assert.False(DocAccess.CanShare(DocAccess.Edit, "restricted"));
            Assert.True(DocAccess.CanShare(DocAccess.Edit, "team"));
            Assert.False(DocAccess.CanShare(DocAccess.Comment, "team"));
            Assert.True(DocAccess.CanChangeAccess(DocAccess.Owner));
            Assert.False(DocAccess.CanChangeAccess(DocAccess.Edit));
        }

        [Fact]
        public void Private_titles_never_go_out_in_live_updates()
        {
            var closed = F("Mine", "MM-1", "restricted");
            var open = F("Team", "MM-1", "team", closed.Id);
            var folders = new Dictionary<Guid, WorkDocFolder> { [closed.Id] = closed, [open.Id] = open };
            Assert.True(DocAccess.TeamVisible("team", null, folders));
            Assert.False(DocAccess.TeamVisible("restricted", null, folders));
            Assert.False(DocAccess.TeamVisible("team", open.Id, folders));
        }

        [Fact]
        public void Mentions_keep_only_real_people_once_and_not_the_writer()
        {
            var people = new HashSet<string> { "MM-1", "MM-2", "MM-3" };
            Assert.Equal("MM-2,MM-3", string.Join(",", DocAccess.Mentions(new[] { "MM-2", "MM-2", "MM-1", "XX-9", "MM-3", "" }, people, "MM-1")));
            Assert.Empty(DocAccess.Mentions(null, people, "MM-1"));
        }
    }
}
