# Obsidian compatibility

This page states what obsidian-expo does with an existing Obsidian vault. It describes implemented behavior; [validation](validation.md) records which parts have been verified and on what hardware. Nothing here claims support that has not been implemented.

## Vault and files

- The app opens a vault folder in place through the iOS folder picker and keeps access with a security-scoped bookmark. Notes are never copied into an app database.
- Only `.md` files are listed and opened. Hidden files and folders, including `.obsidian` and `.trash`, are never listed, read, or written. Symlinks are skipped, and no read or write may resolve outside the vault folder.
- App data stays outside the vault: the vault list, daily-note settings, bookmarks, unsaved drafts, and the search index (in app caches).
- Obsidian's own settings in `.obsidian` are not imported. Enter the daily-note folder, file name format, and template in the app's settings; its preview shows the result before it is saved.

## Text and saving

- UTF-8 files open for editing, with or without a byte order mark. Untouched bytes are written back exactly, including the BOM, Unicode normalization (NFC or NFD), frontmatter, wikilinks, embeds, comments, and plugin syntax.
- New line breaks follow the file's first line break (`\n`, `\r\n`, or `\r`); existing line breaks are not changed.
- Smart quotes, smart dashes, and smart insert and delete are off, so typing does not rewrite Markdown source.
- The editor shows Markdown source with light styling: headings are bold and slightly larger; heading marks, quote marks, list bullets, task boxes, code fences, and front matter are dimmed; inline code and fenced code use a monospaced font; wikilinks and embeds use the link color. Styling is for display only and is never written to the file. Inline styling stops on lines longer than 10,000 UTF-16 code units (about 10,000 characters of Latin text). Front matter is recognized only when the file starts with a `---` line and a later `---` line closes it.
- Files that are not valid UTF-8, such as Latin-1 or UTF-16, open read-only with a best-effort preview and are never saved.
- Edits are recorded in an app-private journal before every save. A save replaces the file only if its bytes still match the version the edits started from. If another app changed the file, or it was moved or deleted, the edits stay in the journal and the app says so; the file is never overwritten or recreated silently. "Saved locally" means the file on this device was written; it does not mean iCloud has uploaded it.
- Unsaved drafts from an earlier session are shown before Today. A draft whose file is unchanged can be opened and saved; otherwise it can be written beside the original as a "recovered" copy, or discarded.

## Daily notes and templates

- A day's note path is `<folder>/<date>.md`, with the date as `YYYY-MM-DD` (default) or `YYYYMMDD`. The default folder is `Daily`.
- An existing note opens unchanged; its template is never applied again.
- A missing note is created once from the template. If the note might exist in iCloud but is not downloaded, or its state cannot be checked, nothing is created.
- The template is checked completely before any file or folder is created. A template with any unsupported syntax creates nothing and shows the line, column, and tag.

The supported template syntax is exactly this subset of Templater, inside ordinary `<% ... %>` tags:

| Syntax | Result |
| --- | --- |
| `<% tp.file.title %>` | The new note's name without `.md`, for example `2026-10-08` |
| `<% tp.date.now() %>` | The creation date as `YYYY-MM-DD` |
| `<% tp.date.now("FORMAT") %>` | The creation time in FORMAT |
| `<% tp.date.now("FORMAT", OFFSET) %>` | Shifted by OFFSET whole days, such as `-1` or `+7` |
| `<% tp.date.now("FORMAT", OFFSET, "DATE", "REF_FORMAT") %>` | OFFSET days from a fixed DATE, at midnight |
| `<% tp.date.now("FORMAT", OFFSET, tp.file.title, "REF_FORMAT") %>` | OFFSET days from the date in the note's name |

- FORMAT is one of `YYYY-MM-DD`, `YYYYMMDD`, `YYYY-MM`, `YYYY-MM-DD HH:mm`, `HH:mm`, or `HH:mm:ss`. REF_FORMAT is `YYYY-MM-DD` or `YYYYMMDD`; it is required whenever a reference is given.
- Strings use single or double quotes. Text outside tags is copied exactly.
- The creation time is the device clock, read once per note. A note created for another calendar day uses that day for its name and title, but `tp.date.now()` still reports the actual creation time.
- Day offsets are calendar days. Across a daylight-saving change the wall-clock time stays the same; Templater (Moment) would move a time that falls in a skipped hour forward.

Not supported, and rejected before anything is created: execution tags (`<%* %>`), dynamic tags (`<%+ %>`), whitespace-control tags (`<%-`, `-%>`, `<%_`, `_%>`), variables and expressions, every other `tp.*` function, other date formats or Moment tokens, duration-string offsets such as `"P1W"`, and nested calls. Templater JavaScript is never run.

## Search

- File names match anywhere in the name, ignoring case, and are listed first.
- Note contents are searched by word prefixes: `harb` finds "harbor". Accents are ignored in content (`cafe` finds "café"). All typed words must match. Quotes and words such as `OR` and `NOT` are searched as plain text.
- Text in scripts written without spaces, such as Japanese or Chinese, is found from the start of a run of characters, not from the middle; file names still match anywhere.
- Notes that are in iCloud but not downloaded, notes not yet indexed, and folders that could not be read are counted, and results say when they may be incomplete. Opening a result always reads the current file.

## Bookmarks

App bookmarks are stored per vault in the app. They are not read from or written to Obsidian's bookmarks plugin. A bookmark whose file disappears stays in the list as missing, with Locate and Remove actions; removing a bookmark never deletes its note.

## Not yet supported

The first release edits Markdown source with light styling and no Live Preview. These are deferred: rendered Markdown, embeds, and images; styling for emphasis, tables, and HTML; graph view; backlinks and link updates on rename; tags and Dataview queries (their source text is kept); community plugins; Templater JavaScript; syncing bookmarks with Obsidian; importing `.obsidian` settings; a custom sync service (iCloud Drive provides syncing); and Mac, Android, and web apps.
