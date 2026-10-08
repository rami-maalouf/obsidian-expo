---
created: <% tp.date.now("YYYY-MM-DD HH:mm") %>
---

# <% tp.file.title %>

<< [[<% tp.date.now("YYYY-MM-DD", -1, tp.file.title, "YYYY-MM-DD") %>]] | [[<% tp.date.now("YYYY-MM-DD", 1, tp.file.title, "YYYY-MM-DD") %>]] >>

Month: <% tp.date.now("YYYY-MM", 0, tp.file.title, "YYYY-MM-DD") %>
Compact: <% tp.date.now('YYYYMMDD') %>
Time: <% tp.date.now("HH:mm") %> / <% tp.date.now("HH:mm:ss") %>
Fixed reference: <% tp.date.now("YYYY-MM-DD", +7, "2026-02-25", "YYYY-MM-DD") %>
Default: <%tp.date.now()%>

Text with a stray %> and 100% kept verbatim.

## Notes

