---
'@modelbay/mcp': patch
'modelbay': patch
---

Add the `openai` MCP platform: `modelbay-mcp openai` serves `chat` (Responses API) and `generate_image` (generation, or editing when `images` are given) for the official OpenAI channel, plus the local `get_tool_help`, `list_capabilities` and `list_jobs` tools.
