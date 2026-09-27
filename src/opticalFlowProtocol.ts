import type { QrDetection } from './scanner'
import type { VisualTrackObservation } from './visualObjectTracker'

export type OpticalFlowRequest =
  | { type: 'init'; id: number; generation: number }
  | {
      type: 'frame'
      id: number
      generation: number
      width: number
      height: number
      capturedAt: number
      pixels: ArrayBuffer
      anchors: QrDetection[]
    }
  | { type: 'clear'; generation: number }

export type OpticalFlowResponse =
  | { type: 'ready'; id: number; generation: number }
  | {
      type: 'result'
      id: number
      generation: number
      observations: VisualTrackObservation[]
      elapsedMs: number
    }
  | {
      type: 'error'
      id: number
      generation: number
      phase: 'initialization' | 'runtime'
      message: string
    }
