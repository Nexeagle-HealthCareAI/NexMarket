# Team board: documents (Plans & docs)

Plans, meeting notes and uploaded files for the office team, on **Team board → Plans & docs**.

## Folders

- **New → folder** (the folder button next to Upload). Folders can sit inside folders, have a colour, and can be private.
- The left side shows the folder tree. **All documents** is the top level.
- **Drag and drop**: drag a document (or several selected ones) or a folder onto a folder in the tree, onto a folder in the list, or onto a name in the path at the top. Drag files from your computer onto the list to upload them into the open folder, or onto a folder to upload into that one.
- On a phone, or without a mouse, use **Move to…** (a document's **⋯** menu, the folder's **⋯** menu, or the bar that appears when documents are selected).
- **Select several**: tick the box at the left of a document (or Ctrl/⌘-click it), then **Move to…** or drag them together.
- Deleting a folder moves it, and what is in it, to the **Bin**; **Put back** brings everything back together. Anything inside that you can't change (someone's private document) is not deleted: it moves up to the folder above instead.

## Who can open what

Every document and folder is either:

- **The team**: everyone who can see the folder it is in can open and edit it (at the top level: everyone with the Team board).
- **Only me and the people added** ("private"). With nobody added it is only for you. **Admins can't see it either.**

A folder's setting passes down: a team document inside a private folder is seen only by the people who can see that folder.

**Share** (on a document, or a folder's **⋯** menu): add people from the office team, each with **Can view**, **Can comment** or **Can edit**, and an optional note. They get a notification and find it under **Shared with me**. Only the owner can make something private, remove people or lower what they can do; on a team document, anyone who can edit can add people. **Copy link** gives a link that only people who can open the document can use.

## Comments

Like in Google Docs:

1. Select some words and press **Comment** in the toolbar (or Ctrl+Alt+M). People who can only comment have a **Comment on the selected words** button instead of the toolbar.
2. Write the comment. Type **@** to mention someone: they get a notification. (Someone who can't open a private document can't be mentioned until it is shared with them; the Share box opens for that.)
3. The words are highlighted; a click on them opens the comment. **Reply**, **Resolve** (✓) when it is dealt with, and open it again later (a reply also reopens it). Writers can **Edit** or **Remove** their own comments.

You can also comment on the whole document (bottom of the comments), and on uploaded files. The document's owner and everyone in a thread hear about replies. If the commented words are later changed, the comment stays and says so.

## Also

- **Starred** (the star on a document) and **Recent** for quick finding; **Only me (private)** lists your private documents and folders.
- **Search** looks in every folder you can open; results show which folder each one is in.
- **Sort** by last changed, name or newest; filter by kind.
- **⋯ menu** on a document: earlier versions, Move to…, Make a copy, Print or save as PDF, Pin, Archive, Delete.
- Nothing is lost: every save keeps the version before it, deleted items wait in the Bin, and only "Delete for ever" (in the Bin, by its writer or an admin) removes a document, its versions and its comments.
- A private document's title is never sent in the live updates other people's pages receive.

## Developer notes

- Access rules: `Services/WorkDocAccess.cs` (`DocAccess`), tested in `WorkDocAccessTests.cs`.
- Endpoints: `Controllers/WorkDocsController.cs` (documents, list with `folder`, `view`, `sort`) and `WorkDocsController.More.cs` (folders, move, access, star, copy, comments).
- Tables: `work_doc_folders`, `work_doc_shares`, `work_doc_comments`, `work_doc_stars`; new columns `FolderId`, `Access`, `DeletedWith` on `work_docs` (migration `AddWorkDocFolders`).
- Comments are pinned to the words they are about (the text and which time it appears) instead of being stored inside the document, so commenting never changes the document or its history (`DocComments.tsx`).
- Notification links: `doc:{docId}[:{commentId}]` and `docs-folder:{folderId}`.
