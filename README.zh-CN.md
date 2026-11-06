# Modelbay

**简体中文** · [English](README.md)

[![npm](https://img.shields.io/npm/v/modelbay)](https://www.npmjs.com/package/modelbay)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Modelbay 是开源（MIT）的 TypeScript SDK、MCP 服务和命令行工具，用一套接口调用火山方舟（豆包、Seedream、Seedance）、阿里云百炼 / DashScope（千问、万相）、MiniMax、豆包语音和 OpenAI，覆盖对话、生图、生视频、语音和音乐，异步任务的轮询由 SDK 代劳。

用 `npm i modelbay zod` 安装 SDK，或用 `npx -y @modelbay/mcp ark` 给 Claude Code、Codex、Cursor、Claude Desktop 接入 MCP 服务。npm 上有三个包：[`modelbay`](https://www.npmjs.com/package/modelbay)、`@modelbay/mcp`、`@modelbay/cli`。

SDK、MCP、CLI 共用一份 TypeScript 实现，模型参数、上下限、默认值和生命周期都写成声明数据，MCP 工具 schema 从声明派生；上游改动只需改一处。

## 快速开始

```ts
import { createModelbay } from 'modelbay'

const mb = createModelbay({ secrets: { ARK_API_KEY: process.env.ARK_API_KEY ?? '' } })
const { outputs } = await mb.generate({
  capability: 'image.generate',
  input: { prompt: 'a cat wearing a hat' },
})
// outputs[0] 是 URL 或字节，下载和保存由调用方负责
```

把 `capability` 换成 `video.generate` 或 `audio.speech`（`input: { text: ... }`）即可生视频和配音。省略 `model` 时，默认模型只从状态为 `active` 的声明里选。

```sh
modelbay models [platform]   # 列出模型及其生命周期状态
modelbay capabilities        # 列出能力
modelbay doctor              # 检查密钥配置（不会打印密钥）
modelbay generate --capability image.generate --prompt "a cat" --model ark:doubao-seedream
```

## 常见问题

**Modelbay 是什么？** 面向火山方舟、阿里云百炼、MiniMax、豆包语音和 OpenAI 的 TypeScript SDK、MCP 服务和 CLI，三个入口共用一份实现和一份模型声明。

**怎么在 Claude Code、Codex、Cursor、Claude Desktop 里用？** 添加一个运行 `npx -y @modelbay/mcp <平台>` 的 MCP 服务，平台取 `ark`、`minimax`、`bailian`、`doubao-speech` 或 `openai`，并通过服务的环境变量传入密钥，例如 `ARK_API_KEY`。每个平台是独立的服务，详见 [`packages/mcp/README.md`](packages/mcp/README.md)（英文）。

**支持哪些平台和能力？** 方舟、百炼、MiniMax、豆包语音、OpenAI；按平台不同，涵盖对话、生图与改图、生视频、语音合成、音乐、音色复刻与设计、语音识别。当前清单用 `modelbay models`、`modelbay capabilities` 查看，或见[目标与范围](docs/goals.md)。

**收费吗？什么许可证？** 免费开源，MIT 许可证。模型调用费用由各平台按你自己的账号计费。

**API 密钥放哪里？** 由宿主通过 `createModelbay({ secrets })` 或环境变量传入，如 `ARK_API_KEY`、`BAILIAN_API_KEY`（别名 `DASHSCOPE_API_KEY`）、`MINIMAX_API_KEY`、`DOUBAO_API_KEY`、`OPENAI_API_KEY`。SDK 不保存也不打印密钥。

**能在 Node 以外使用吗？** `modelbay` 根入口只用 Node、Bun、Deno 和浏览器都有的 API；Node 专属能力放在 `modelbay/node` 子路径。

**什么时候该用别的？** 只调用一家平台、又需要它的全部专有功能时，直接用该平台的官方 SDK 更省事。Modelbay 适合跨多家平台调用，或把它们暴露成 MCP 工具。

## 更多

- 包说明与完整 API：[`packages/modelbay/README.md`](packages/modelbay/README.md)（英文）
- 目标与范围、扩展指南、工程规范：[`docs/`](docs/goals.md)
- 许可证：MIT © ikuyu
