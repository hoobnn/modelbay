---
'modelbay': minor
'@modelbay/mcp': minor
---

Serve Modelbay workflows through Skills over MCP (SEP-2640). Each platform publishes the skills and tool references available for its enabled tool groups. MCP clients can discover skills and read their files over stdio.

Publish static model declarations on built-in platform descriptors. Use one MCP connection catalog for tool discovery, help, Skill references and calls.

Calls to tools in disabled groups now return an error. Enable the relevant group with `MODELBAY_MCP_GROUPS` to use its tools.
