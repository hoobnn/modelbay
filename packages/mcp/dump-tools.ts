import { writeFileSync } from 'node:fs'
import { arkAdapter } from '@modelbay/ark'
import { bailianAdapter } from '@modelbay/bailian'
import { doubaoAdapter } from '@modelbay/doubao-speech'
import { minimaxAdapter } from '@modelbay/minimax'
import { generateTools } from './src/generate'
const adapters = {
  ark: arkAdapter,
  minimax: minimaxAdapter,
  bailian: bailianAdapter,
  'doubao-speech': doubaoAdapter,
}
for (const [key, adapter] of Object.entries(adapters)) {
  const set = generateTools(key, { adapter })
  const out = [...set.byName.values()].map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }))
  writeFileSync(`${process.argv[2]}/${key}.json`, JSON.stringify(out, null, 2))
}
