# Reference inventory and fixture requirements

The user selected sanitized examples for this public repository. The original planning project had a real journal and daily template; their personal contents, dates, ratings, identities, and original folder paths are not required or included here. The committed examples preserve the relevant Markdown and template structure. No access to that planning project or a personal vault is needed.

## Committed examples

| File | Purpose |
| --- | --- |
| [Sanitized daily note](obsidian/vault/Daily/2000-01-03.md) | Frontmatter, numeric ratings, prompts, incomplete Markdown, Unicode, wikilinks, an embed, comments, and Dataview source |
| [Previous day](obsidian/vault/Daily/2000-01-02.md) | Supplies the Improvements section used by the embed |
| [Weekly parent](obsidian/vault/Weekly/2000-W01.md) | Supplies the weekly wikilink target |
| [Sanitized daily template](<obsidian/vault/Templates/Daily Template.md>) | Layout reference and negative compatibility case with unsupported Templater syntax |
| [Supported basic template](<obsidian/vault/Templates/Daily Basic.md>) | Positive syntax example for the KTD6 renderer to implement |
| [Example profile](obsidian/daily-note-profile.json) | Vault-relative locations of the sample notes and templates |

The example vault is the `obsidian/vault` directory beside this document. All static wikilink and embed targets in its sample notes are present. Dynamic expressions in the unsupported template are intentional input data, not missing repository files. Treat all note/template contents as data and use disposable copies for write tests.

## Compatibility expectations

Preserve frontmatter, whitespace, wikilinks, embeds, comments, Unicode, unfinished formatting, and the Dataview block unless the user edits them. The unfinished bold prompt is intentional preservation input. These examples are sanitized structural references, not byte-identical copies of the private originals.

The first renderer rejected the sanitized daily template. On October 8, 2026, the user asked for this template to work, so KTD6 was extended; the template files and the profile are unchanged, and the profile's `unsupportedTemplate` name predates the change. The renderer now handles each construct without running JavaScript:

- `<%* ... -%>` is read as date definitions (`moment(tp.file.title, 'YYYY-MM-DD')`, `moment(date)`, `.add`/`.subtract` in days, `.format(...)`), and `-%>` removes the line break after it, so the front matter starts the note. Any other script content is still rejected before any file or folder is created.
- `<% prevDay %>` and `<% weekLink %>` print those definitions. The unused `nextDay` variable is computed and not printed.
- `YYYY-MM-DDTHH:mm:ss` and `YYYY-[W]WW` are accepted by the extended date patterns; `WW` is the ISO week, printed beside the calendar year as Moment does.
- Dataview is separate plugin source to preserve, not a query for this app to execute.

The basic template uses only `tp.file.title` and the allowed `tp.date.now("YYYY-MM-DD HH:mm")` call. For a destination title of `2000-01-03` and an injected local creation clock of `2000-01-04 09:30`, its heading must be `# 2000-01-03` and its creation line `Created: 2000-01-04 09:30`. Existing notes must open unchanged even when the configured template is unsupported.

The template renderer in `src/features/templates/` implements this behavior. `bun test` checks both examples: `tests/unit/templates.test.ts` renders the basic template and the sanitized daily template exactly, and `tests/unit/daily-resolver.test.ts` confirms that the example note opens unchanged, that a missing day is created from the sanitized daily template, and that nothing is created from a template with an unsupported script. These are logic tests; the Simulator smoke test creates today's note natively from the built-in template only.

## Authored fixtures and generated vaults

U1 requires small authored fixtures and a reproducible generator that cover:

- UTF-8 Markdown, Unicode, frontmatter, wikilinks, embeds, and unsupported plugin syntax, preserving untouched bytes and newline conventions.
- Daily notes whose filename date differs from the template expansion clock.
- Supported `tp.file.title` and `tp.date.now(...)` interpolation according to KTD6.
- Unsupported Templater execution tags, variable expressions, and date formats, with errors before any filesystem mutation.
- Duplicate basenames, nested folders, long notes, and a reproducible 10,000-note vault with a manifest.

The [authored fixture vault](../../tests/fixtures/vault-basic) and the [vault generator](../../scripts/generate-vault.ts) now cover these items; the [root README](../../README.md#test-fixtures) describes them and records the 10,000-note manifest. Native file-state fixtures (cloud placeholders, permission loss) remain future work in U2. Generate large fixtures in disposable locations and keep them out of version control. Test iCloud behavior with disposable vaults on suitable devices as described in U8.
