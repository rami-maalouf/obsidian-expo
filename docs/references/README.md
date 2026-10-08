# Fixture requirements

The original planning project has personal Obsidian references. They are not copied into this public repository. The specification and plan can be implemented with synthetic fixtures; access to a personal vault is not a prerequisite.

U1 should create small authored fixtures and a reproducible generator that cover:

- UTF-8 Markdown, Unicode, frontmatter, wikilinks, embeds, and unsupported plugin syntax, preserving untouched bytes and newline conventions.
- Daily notes whose filename date differs from the template expansion clock.
- Supported `tp.file.title` and `tp.date.now(...)` interpolation according to KTD6.
- Unsupported Templater execution tags, variable expressions, and date formats, with errors before any filesystem mutation.
- Duplicate basenames, nested folders, long notes, and a reproducible 10,000-note vault with a manifest.

These are requirements for future fixtures, not claims that the fixtures or tests already exist. Generate large fixtures in disposable locations and keep them out of version control. Test iCloud behavior with disposable vaults on suitable devices as described in U8.
