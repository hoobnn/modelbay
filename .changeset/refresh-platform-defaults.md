---
'modelbay': patch
'@modelbay/mcp': patch
'@modelbay/cli': patch
---

更新未显式指定模型时使用的默认值。OpenAI 对话和图像分别改用 GPT-6.2 Astra 和 GPT-Image-2.6 Sunburst，方舟按量与套餐的图像生成和处理改用 Seedream 5.5，百炼按量对话改用 Qwen4-Max，套餐对话继续使用 Qwen3.8-Max，MiniMax 对话和图像分别改用 M3.1 Flash 和 H3 Image。显式传入的模型 ID 仍按原声明解析。
