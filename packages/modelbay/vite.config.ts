import { definePackageConfig } from '../../vite.package'

// 对外只发 modelbay：内部包打进产物，平台特有导出走 `modelbay/<平台>` 与 `modelbay/<平台>/node`
export default definePackageConfig(import.meta.url, {
  bundleWorkspace: true,
  entries: {
    ark: 'src/platform/ark.ts',
    'ark/node': 'src/platform/ark-node.ts',
    bailian: 'src/platform/bailian.ts',
    'bailian/node': 'src/platform/bailian-node.ts',
    minimax: 'src/platform/minimax.ts',
    'doubao-speech': 'src/platform/doubao-speech.ts',
    'doubao-speech/node': 'src/platform/doubao-speech-node.ts',
    deepseek: 'src/platform/deepseek.ts',
    openai: 'src/platform/openai.ts',
    'openai/node': 'src/platform/openai-node.ts',
  },
})
