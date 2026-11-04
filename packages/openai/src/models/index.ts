import type { ModelDeclaration } from '@modelbay/core'
import gpt61Sol from './gpt-6-1-sol'
import gpt6Astra from './gpt-6-astra'
import gpt61Terra from './gpt-6-1-terra'
import gpt6Luna from './gpt-6-luna'
import gptImage25Sunburst from './gpt-image-2-5-sunburst'
import gptImage25Flare from './gpt-image-2-5-flare'

export { gpt61Sol, gpt6Astra, gpt61Terra, gpt6Luna, gptImage25Sunburst, gptImage25Flare }

export const all: ModelDeclaration[] = [
  gpt61Sol,
  gpt6Astra,
  gpt61Terra,
  gpt6Luna,
  gptImage25Sunburst,
  gptImage25Flare,
]
