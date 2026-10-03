---
name: workspace-search
description: Find local workspace evidence with bounded snippets through the workspace_search Pi tool, using ripgrep, optional local zvec-grep, then Jev. Use before broad file reads or repeated searches when exact wording is unknown or semantic relationships matter.
---

Call `workspace_search` with `mode="exact"` for known literals, `mode="regex"` for patterns, or `mode="semantic"` for concepts and relationships. Narrow `scope` to a relevant file or directory when available.

The tool handles local zvec and Jev fallback internally. A missing zvec installation does not block the workflow. If local results do not establish the answer, retry with `backend="jev"` if configured. Do not invent an intermediary search agent.

Treat sufficient returned snippets as already-read source evidence. Call `workspace_expand` only for missing details, with a specific file and line range. Respect coverage, partial, outputTruncated, errors and freshness. Ranked or empty results are not exhaustive absence checks; confirm negative literal claims with a scoped exact search or native rg when exhaustive evidence is required.

When both backends cannot establish the answer, refine the query/scope or let the main agent inspect source with existing tools. Do not repeatedly invoke a failing backend. Configure with `/search-setup`; check `/search-status` and `/search-test`. Credentials belong in native Pi `/login typesafe`, never in the model conversation.
