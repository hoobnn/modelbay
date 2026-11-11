---
'modelbay': patch
---

MiniMax-H3-Image 文生图与图片编辑改用流式响应保活，避免 Node fetch 默认 300 秒收不到响应头就断开（服务端最长等 600 秒）。
