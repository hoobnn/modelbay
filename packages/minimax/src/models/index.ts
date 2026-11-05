import type { ModelDeclaration } from '@modelbay/core'
import minimaxM3 from './minimax-m3'
import minimaxM31Flash from './minimax-m3-1-flash'
import minimaxM27 from './minimax-m2-7'
import image01 from './image-01'
import image01Live from './image-01-live'
import minimaxH3 from './minimax-h3'
import minimaxH3Highspeed from './minimax-h3-highspeed'
import minimaxH3Lite from './minimax-h3-lite'
import minimaxH3Max from './minimax-h3-max'
import speech28Hd from './speech-2-8-hd'
import speech28Turbo from './speech-2-8-turbo'
import music30 from './music-3-0'
import music26 from './music-2-6'

export {
  minimaxM3,
  minimaxM31Flash,
  minimaxM27,
  image01,
  image01Live,
  minimaxH3,
  minimaxH3Highspeed,
  minimaxH3Lite,
  minimaxH3Max,
  speech28Hd,
  speech28Turbo,
  music30,
  music26,
}

export const all: ModelDeclaration[] = [
  minimaxM3,
  minimaxM31Flash,
  minimaxM27,
  image01,
  image01Live,
  minimaxH3,
  minimaxH3Highspeed,
  minimaxH3Lite,
  minimaxH3Max,
  speech28Hd,
  speech28Turbo,
  music30,
  music26,
]
