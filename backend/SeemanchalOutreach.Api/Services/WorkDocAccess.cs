using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// Who can do what with a Team board document or folder.
    ///
    ///   team        everyone who can see the folder it is in (at the top level: everyone with the Team board)
    ///   restricted  only its owner and the people it is shared with
    ///
    /// A folder's access passes down to what is in it: a team document inside a restricted folder is seen only by the
    /// people who can see that folder. Sharing an item directly with someone always lets them open it (it shows under
    /// "Shared with me"). Admins have no special view of restricted items: private means private.
    /// </summary>
    public static class DocAccess
    {
        public const int None = 0, View = 1, Comment = 2, Edit = 3, Owner = 4;
        public static readonly string[] Roles = { "view", "comment", "edit" };

        public static int RoleOf(string? r) => r switch { "view" => View, "comment" => Comment, "edit" => Edit, _ => None };
        public static string NameOf(int r) => r switch { Owner => "owner", Edit => "edit", Comment => "comment", View => "view", _ => "none" };

        /// <summary>Everything needed to work out access for one person, loaded once per request.</summary>
        public sealed class Context
        {
            public string Me { get; }
            public Dictionary<Guid, WorkDocFolder> Folders { get; }
            private readonly Dictionary<Guid, int> _docShares = new();
            private readonly Dictionary<Guid, int> _folderShares = new();
            private readonly Dictionary<Guid, int> _folderMemo = new();

            public Context(string me, IEnumerable<WorkDocFolder> folders, IEnumerable<WorkDocShare> mySharesOnly)
            {
                Me = me;
                Folders = folders.ToDictionary(f => f.Id);
                foreach (var s in mySharesOnly.Where(s => s.AgentId == me))
                {
                    var r = RoleOf(s.Role);
                    if (s.DocId is Guid d) _docShares[d] = Math.Max(r, _docShares.GetValueOrDefault(d));
                    if (s.FolderId is Guid f) _folderShares[f] = Math.Max(r, _folderShares.GetValueOrDefault(f));
                }
            }

            public bool SharedDoc(Guid id) => _docShares.ContainsKey(id);
            public bool SharedFolder(Guid id) => _folderShares.ContainsKey(id);

            /// <summary>What this person may do inside a folder (null = the top level, where everyone edits).</summary>
            public int Folder(Guid? id) => Folder(id, 0);

            private int Folder(Guid? id, int depth)
            {
                if (id is not Guid g) return Edit;
                if (_folderMemo.TryGetValue(g, out var m)) return m;
                if (!Folders.TryGetValue(g, out var f) || depth > 30) return Edit;   // a missing parent counts as the top level
                int r;
                if (f.CreatedBy == Me && Me.Length > 0) r = Owner;
                else
                {
                    var inherited = f.Access == "restricted" ? None : Math.Min(Folder(f.ParentId, depth + 1), Edit);
                    r = Math.Max(inherited, _folderShares.GetValueOrDefault(g));
                }
                _folderMemo[g] = r;
                return r;
            }

            /// <summary>What this person may do with a document.</summary>
            public int Doc(WorkDoc d) => Doc(d.Id, d.CreatedBy, d.Access, d.FolderId);

            public int Doc(Guid id, string createdBy, string access, Guid? folderId)
            {
                if (createdBy == Me && Me.Length > 0) return Owner;
                var inherited = access == "restricted" ? None : Math.Min(Folder(folderId), Edit);
                return Math.Max(inherited, _docShares.GetValueOrDefault(id));
            }

            /// <summary>Can this person see the folder in the tree (it and every folder above it)?</summary>
            public bool InTree(Guid? id)
            {
                for (var i = 0; id is Guid g && i < 30; i++)
                {
                    if (Folder(g) < View) return false;
                    if (!Folders.TryGetValue(g, out var f)) return true;
                    id = f.ParentId;
                }
                return true;
            }

            /// <summary>Folders from the top down to this one (for the path at the top of the list).</summary>
            public List<WorkDocFolder> PathTo(Guid? id)
            {
                var path = new List<WorkDocFolder>();
                for (var i = 0; id is Guid g && i < 30 && Folders.TryGetValue(g, out var f); i++) { path.Insert(0, f); id = f.ParentId; }
                return path;
            }

            /// <summary>Is <paramref name="target"/> this folder or inside it? (A folder cannot move into itself.)</summary>
            public bool IsInside(Guid? target, Guid folder)
            {
                for (var i = 0; target is Guid g && i < 30; i++)
                {
                    if (g == folder) return true;
                    target = Folders.TryGetValue(g, out var f) ? f.ParentId : null;
                }
                return false;
            }
        }

        /// <summary>Who may change who has access: the owner always; on a team item anyone who can edit may add people.</summary>
        public static bool CanShare(int role, string access) => role == Owner || (access != "restricted" && role >= Edit);

        /// <summary>Only the owner makes an item private or open to the team again.</summary>
        public static bool CanChangeAccess(int role) => role == Owner;

        /// <summary>
        /// Could everyone on the team see it? (A team item with only team folders above it.) Only then is its title put in
        /// the live updates every CRM page receives.
        /// </summary>
        public static bool TeamVisible(string access, Guid? folderId, IReadOnlyDictionary<Guid, WorkDocFolder> folders)
        {
            if (access == "restricted") return false;
            for (var i = 0; folderId is Guid g && i < 30; i++)
            {
                if (!folders.TryGetValue(g, out var f)) return true;
                if (f.Access == "restricted") return false;
                folderId = f.ParentId;
            }
            return true;
        }

        /// <summary>People mentioned in a comment (picked from the list): only real people, not the writer, each once.</summary>
        public static List<string> Mentions(IEnumerable<string>? asked, ISet<string> people, string me) =>
            (asked ?? Enumerable.Empty<string>()).Where(a => !string.IsNullOrWhiteSpace(a) && people.Contains(a) && a != me).Distinct().Take(20).ToList();
    }
}
