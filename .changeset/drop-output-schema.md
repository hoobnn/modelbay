---
'@modelbay/mcp': patch
'modelbay': patch
---

MCP tools no longer advertise an `outputSchema` that requires an `ok` field their results never contained, so clients that validate structured results against `outputSchema` stop rejecting successful calls.
