import type { ModelDeclaration } from '@modelbay/core'
import qwen38Max from './qwen3-8-max'
import qwen37Plus from './qwen3-7-plus'
import qwen38Flash from './qwen3-8-flash'
import qwenImage30Pro from './qwen-image-3-0-pro'
import qwenImage30 from './qwen-image-3-0'
import wan27ImagePro from './wan2-7-image-pro'
import wanx21Imageedit from './wanx2-1-imageedit'
import wan30Video from './wan3-0-video'
import wan30VideoPrime from './wan3-0-video-prime'
import qwen3TtsFlash from './qwen3-tts-flash'
import qwen3TtsInstructFlash from './qwen3-tts-instruct-flash'

export {
  qwen38Max,
  qwen37Plus,
  qwen38Flash,
  qwenImage30Pro,
  qwenImage30,
  wan27ImagePro,
  wanx21Imageedit,
  wan30Video,
  wan30VideoPrime,
  qwen3TtsFlash,
  qwen3TtsInstructFlash,
}

export const all: ModelDeclaration[] = [
  qwen38Max,
  qwen37Plus,
  qwen38Flash,
  qwenImage30Pro,
  qwenImage30,
  wan27ImagePro,
  wanx21Imageedit,
  wan30Video,
  wan30VideoPrime,
  qwen3TtsFlash,
  qwen3TtsInstructFlash,
]
