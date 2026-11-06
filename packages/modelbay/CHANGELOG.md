# modelbay

## 0.1.2

### Patch Changes

- 9e7b2f8: Add the `openai` MCP platform: `modelbay-mcp openai` serves `chat` (Responses API) and `generate_image` (generation, or editing when `images` are given) for the official OpenAI channel, plus the local `get_tool_help` and `list_capabilities` tools.
- MCP tools no longer advertise an `outputSchema` that requires an `ok` field their results never contained, so clients that validate structured results against `outputSchema` stop rejecting successful calls.

## 0.1.1

### Patch Changes

- Publish through npm trusted publishing (OIDC), so every package now carries npm provenance. No code changes from 0.1.0.
