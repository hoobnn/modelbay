---
'modelbay': patch
---

OpenAI 生图返回几 MB 的高分辨率图片时，base64 校验不再抛「Maximum call stack size exceeded」，避免已生成（已计费）的图片被当成提交状态未知丢掉。
