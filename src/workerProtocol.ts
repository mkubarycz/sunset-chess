import type { QrDetection } from './scanner'

export type DecoderKind = 'zxing-wasm' | 'jsqr'

export type DecodeRequest =
  | { type: 'init'; id: number; generation: number }
  | {
      type: 'decode'
      id: number
      generation: number
      width: number
      height: number
      pixels: ArrayBuffer
    }

export type DecodeResponse =
  | { type: 'ready'; id: number; generation: number; decoder: DecoderKind }
  | {
      type: 'result'
      id: number
      generation: number
      detections?: QrDetection[]
      /** @deprecated Compatibility with the former single-result worker protocol. */
      detection?: QrDetection | null
      elapsedMs?: number
    }
  | {
      type: 'error'
      id: number
      generation: number
      phase?: 'initialization' | 'runtime'
      message: string
    }
