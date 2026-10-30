---
title: "Welcome: fixture vault"
aliases: [Start, Home page]
tags:
  - fixture
  - "nested/tag"
created: 2026-01-02T09:30:00
cssclasses: wide
---

# Welcome

This synthetic vault exercises syntax that the editor must keep byte-for-byte.

## Links

- Plain wikilink: [[Projects/Alpha/Index]]
- Alias: [[Projects/Beta/Index|Beta index]]
- Heading: [[Résumé#Experience]]
- Block reference: [[Unicode#^emoji-block]]
- Markdown link: [Daily note](Daily/2026-10-07.md)
- External: <https://example.com/path?q=1&r=2>

## Embeds

![[attachments/pixel.png]]
![[Unicode#Scripts]]
![[attachments/pixel.png|64x64]]

## Plugin and extended syntax

> [!note] Callout title
> Callout body with **bold**, _italic_, ==highlight==, and ~~strike~~.

```dataview
TABLE file.mtime AS "Modified"
FROM #fixture
SORT file.mtime DESC
```

Inline field:: kept as text
[status:: draft] and (hidden:: true)

<%* tR += "Templater execution tag stored in a note, not a template" %>
<% tp.date.now("dddd") %>

%% Obsidian comment that must survive %%
<!-- HTML comment -->

Math: $e^{i\pi} + 1 = 0$ and footnote[^1].

- [ ] open task 📅 2026-10-09
- [x] done task ✅ 2026-10-01

#tag/nested #fixture

[^1]: Footnote text.
