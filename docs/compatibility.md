# Obsidian compatibility

This page states what obsidian-expo does with an existing Obsidian vault. It describes implemented behavior on iOS; [Android](#android) lists where the Android app differs; [validation](validation.md) records which parts have been verified and on what hardware. Nothing here claims support that has not been implemented.

## Vault and files

- The app opens a vault folder in place through the iOS folder picker and keeps access with a security-scoped bookmark. Notes are never copied into an app database.
- Only `.md` files are listed and opened. Hidden files and folders, including `.obsidian` and `.trash`, are never listed, read, or written. Symlinks are skipped, and no read or write may resolve outside the vault folder.
- App data stays outside the vault: the vault list, daily-note settings, bookmarks, unsaved drafts, and the search index (in app caches).
- Obsidian's own settings in `.obsidian` are not imported. The daily-note folder, file name format, and template are set in the app's settings. First setup suggests them from file names (see [daily notes and templates](#daily-notes-and-templates)), and the preview shows the result before it is saved.

## Text and saving

- UTF-8 files open for editing, with or without a byte order mark. Untouched bytes are written back exactly, including the BOM, Unicode normalization (NFC or NFD), frontmatter, wikilinks, embeds, comments, and plugin syntax.
- New line breaks follow the file's first line break (`\n`, `\r\n`, or `\r`); existing line breaks are not changed.
- Smart quotes, smart dashes, and smart insert and delete are off, so typing does not rewrite Markdown source.
- The editor shows Markdown source with light styling: headings are bold and slightly larger; heading marks, quote marks, list bullets, task boxes, code fences, and front matter are dimmed; inline code and fenced code use a monospaced font; wikilinks and embeds use the link color. Styling is for display only and is never written to the file. Inline styling stops on lines longer than 10,000 UTF-16 code units (about 10,000 characters of Latin text). Front matter is recognized only when the file starts with a `---` line and a later `---` line closes it.
- Files that are not valid UTF-8, such as Latin-1 or UTF-16, open read-only with a best-effort preview and are never saved.
- Edits are recorded in an app-private journal before every save. A save replaces the file only if its bytes still match the version the edits started from. If another app changed the file, or it was moved or deleted, the edits stay in the journal and the app says so; the file is never overwritten or recreated silently. The note title ends with an asterisk (`*`) while edits wait for a save. When the asterisk goes away, the file on this device was written; it does not mean iCloud has uploaded it.
- Unsaved drafts from an earlier session are shown before Today. A draft whose file is unchanged can be opened and saved; otherwise it can be written beside the original as a "recovered" copy, or discarded.

## Daily notes and templates

- A day's note path is `<folder>/<date>.md`, with the date as `YYYY-MM-DD` (default) or `YYYYMMDD`. The default folder is `Daily`.
- First setup lists the vault and suggests settings from file names only; no note and no `.obsidian` file is read. The suggested folder is the one with the most notes named as dates (`YYYY-MM-DD` or `YYYYMMDD`, real calendar days only), in the format most of them use. It needs two such notes, or one when the folder is the top of the vault or its name contains "daily", "journal", or "diary", or the word "day" or "days". Year and month folders such as `2026`, `2026-10`, or `10-October` are never suggested, because the app cannot file notes by month. The suggested template is a Markdown file named for daily notes ("daily", or else "journal", "diary", "day", or "today", but not "week", "month", "quarter", or "year"), inside a folder whose name contains "template" (such as `Templates` or `Templater`), or with "template" in its own name. A file inside a templates folder beats one that is only named as a template, and among equal matches the most recently changed one wins. Anything not found keeps the default. The form shows what was found, and nothing is saved until the user accepts it.
- While the folder or template field has focus, up to five of the vault's folders or Markdown files are suggested below it, ranked as in [[ link completion: an exact name, then a name that starts with the typed text, then a word that starts with it, then any substring, then its letters in order. Case and accents are ignored. Text with a "/" is matched against whole paths. The Daily Note Settings sheet shows the same suggestions and what was found, with a button to use it.
- An existing note opens unchanged; its template is never applied again.
- A missing note is created once from the template. If the note might exist in iCloud but is not downloaded, or its state cannot be checked, nothing is created.
- The template is checked completely before any file or folder is created. A template with any unsupported syntax creates nothing and shows the line, column, and tag.

The supported template syntax is exactly this subset of Templater. Nothing in a template runs as code; the app reads these forms and computes their results itself.

| Syntax | Result |
| --- | --- |
| `<% tp.file.title %>` | The new note's name without `.md`, for example `2026-10-08` |
| `<% tp.date.now() %>` | The creation date as `YYYY-MM-DD` |
| `<% tp.date.now("FORMAT") %>` | The creation time in FORMAT |
| `<% tp.date.now("FORMAT", OFFSET) %>` | Shifted by OFFSET whole days, such as `-1` or `+7` |
| `<% tp.date.now("FORMAT", OFFSET, "DATE", "REF_FORMAT") %>` | OFFSET days from a fixed DATE, at midnight |
| `<% tp.date.now("FORMAT", OFFSET, tp.file.title, "REF_FORMAT") %>` | OFFSET days from the date in the note's name |
| `<%* let NAME = ... %>` | Defines dates, as described below; prints nothing |
| `<% NAME %>` | Prints a date that an earlier script formatted as text |
| `<%- ... %>`, `<% ... -%>` | Removes one line break before or after the tag |

- FORMAT is a Moment pattern made of `YYYY` (year), `MM` (month), `DD` (day), `HH` (hour), `mm` (minute), `ss` (second), and `WW` (ISO week), with `-`, `:`, `/`, `.`, `,`, `_`, spaces, `T`, or `[bracketed text]` between them, for example `YYYY-MM-DDTHH:mm:ss` or `YYYY-[W]WW`. Like Moment, `WW` beside `YYYY` uses the calendar year, so January 1, 2027 prints as `2027-W53`. REF_FORMAT is `YYYY-MM-DD` or `YYYYMMDD`; it is required whenever a reference is given.
- A script (`<%* ... %>`) may only define dates, separated by `;` or line breaks: `let NAME = moment(tp.file.title, "PATTERN")` (the note's name read with YYYY, MM, and DD), `moment(OTHER)` (a copy of an earlier date), or `moment()` (the creation time), optionally followed by `.add(N, "d")` or `.subtract(N, "d")` (units `d`, `day`, `days`, `w`, `week`, `weeks`), and then optionally `.format("FORMAT")`. `let`, `const`, and `var` are accepted. `.add` and `.subtract` must follow `moment(...)`, because in Templater they would change the date they are called on. Only formatted dates can be printed with `<% NAME %>`.
- Strings use single or double quotes. Text outside tags is copied exactly.
- The creation time is the device clock, read once per note. A note created for another calendar day uses that day for its name and title, but `tp.date.now()` still reports the actual creation time.
- Day offsets are calendar days. Across a daylight-saving change the wall-clock time stays the same; Templater (Moment) would move a time that falls in a skipped hour forward.

Not supported, and rejected before anything is created: any other script content (for example `tR`, `await`, `tp.system.prompt`, `if`, comments, or `.startOf(...)`), dynamic tags (`<%+ %>`), `_` whitespace control (`<%_`, `_%>`), month and year units, expressions, every other `tp.*` function, other Moment tokens (such as `dddd`, `MMMM`, `Do`, or `ww`), duration-string offsets such as `"P1W"`, and nested calls. Templater JavaScript is never run.

## Search

- File names match anywhere in the name, ignoring case, and are listed first.
- Note contents are searched by word prefixes: `harb` finds "harbor". Accents are ignored in content (`cafe` finds "café"). All typed words must match. Quotes and words such as `OR` and `NOT` are searched as plain text.
- Text in scripts written without spaces, such as Japanese or Chinese, is found from the start of a run of characters, not from the middle; file names still match anywhere.
- Notes that are in iCloud but not downloaded, notes not yet indexed, and folders that could not be read are counted, and results say when they may be incomplete. Opening a result always reads the current file.

## Bookmarks

App bookmarks are stored per vault in the app. They are not read from or written to Obsidian's bookmarks plugin. A bookmark whose file disappears stays in the list as missing, with Locate and Remove actions; removing a bookmark never deletes its note.

## Android

The Android app uses the same JavaScript as the iOS app, so daily notes, templates, search, and bookmarks behave as described above. These parts differ:

- The vault is a folder picked with Android's system folder picker. The app keeps the permission that the picker grants for that folder only; it does not ask for access to all files. Choosing the vault again, or "Choose another vault", asks again. Forgetting a vault gives the permission back unless another registered vault uses the same folder.
- A note that a document provider lists but cannot open as a file (a "virtual" document, for example in some cloud providers) counts as not on this device: it is found by name, never created again, and opened only when readable. iCloud Drive is not available on Android.
- A name that differs from the wanted name only in case or accents (for example `daily/` beside `Daily/`) makes that path's state unknown, because Android's shared storage can treat such names as the same file. Nothing is created there.
- Saves read the file and compare its bytes with the version the edits started from, then write in place and read the result back. Android has no file coordination between apps, so a write by another app in the instant between that comparison and the write is not detected. A save that does not read back as written keeps the draft and reports an error.
- A new note is created only under its exact name. If a document provider gives the new file another name, such as `Note (1).md`, the app deletes that file and treats the note as existing.
- The editor shows Markdown source with the same light styling as the first iOS release (headings, dimmed marks, monospaced code, colored links and tags, bold, italic, and strikethrough), without live preview. Tapping a wikilink while the keyboard is down opens the note; with the keyboard up, a tap places the caret. `[[` opens the same link suggestions as on iOS; with a hardware keyboard, the arrow keys, Tab, Enter, and Escape work as on iOS.
- A line break typed into a note follows the note's first line break, as on iOS. A lone carriage return (`\r`) is kept but shows as a space, not a line break.
- The keyboard's composing text (the word that the keyboard is still changing) is saved as it is shown, because Android keyboards compose most words.
- The file system does not report creation times through the folder picker's documents, so "Created time" sorting keeps notes in name order. Document identities are paths, so a bookmark does not follow a note that another app renamed; it shows as missing with Locate and Remove.
- There is no menu bar; the app bar and the side panels offer the same actions.

## Not yet supported

The first release edits Markdown source with light styling and no Live Preview. These are deferred: rendered Markdown, embeds, and images; styling for emphasis, tables, and HTML; graph view; backlinks and link updates on rename; tags and Dataview queries (their source text is kept); community plugins; Templater JavaScript beyond the date definitions above; syncing bookmarks with Obsidian; importing `.obsidian` settings; a custom sync service (iCloud Drive provides syncing on iOS); and Mac and web apps.
