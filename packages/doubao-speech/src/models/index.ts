import type { ModelDeclaration } from '@modelbay/core'
import seedTts20 from './seed-tts-2-0'
import seedIcl10 from './seed-icl-1-0'
import seedIcl20 from './seed-icl-2-0'
import seedAudio10 from './seed-audio-1-0'
import bigmodel from './bigmodel'
import seedTts10 from './seed-tts-1-0'

export { seedTts20, seedIcl10, seedIcl20, seedAudio10, bigmodel, seedTts10 }

export const all: ModelDeclaration[] = [
  seedTts20,
  seedIcl10,
  seedIcl20,
  seedAudio10,
  bigmodel,
  seedTts10,
]
