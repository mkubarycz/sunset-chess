import type { QrDetection } from './scanner'

export interface DecodeRequest {
  type: 'decode'
  id: number
  generation: number
  width: number
  height: number
  pixels: ArrayBuffer
}

export type DecodeResponse =
  | { type: 'result'; id: number; generation: number; detection: QrDetection | null }
  | { type: 'error'; id: number; generation: number; message: string }
