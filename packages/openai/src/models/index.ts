import type { ModelDeclaration } from '@modelbay/core'
import gpt61Sol from './gpt-6-1-sol'
import gpt6Astra from './gpt-6-astra'
import gpt61Terra from './gpt-6-1-terra'
import gpt6Luna from './gpt-6-luna'
import gptImage25Sunburst from './gpt-image-2-5-sunburst'
import gptImage25Flare from './gpt-image-2-5-flare'

import gptImage26Sunburst from './gpt-image-2-6-sunburst'
import gptImage26Flare from './gpt-image-2-6-flare'

export {
  gpt61Sol,
  gpt6Astra,
  gpt61Terra,
  gpt6Luna,
  gptImage25Sunburst,
  gptImage25Flare,
  gptImage26Sunburst,
  gptImage26Flare,
}

export const all: ModelDeclaration[] = [
  gpt61Sol,
  gpt6Astra,
  gpt61Terra,
  gpt6Luna,
  gptImage26Sunburst,
  gptImage26Flare,
  gptImage25Sunburst,
  gptImage25Flare,
]
