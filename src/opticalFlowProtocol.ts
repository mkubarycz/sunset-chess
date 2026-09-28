import type { QrDetection } from './scanner'
import type { VisualTrackObservation } from './visualObjectTracker'
import type { OPTICAL_FLOW_POLICY } from './opticalFlowPolicy'

export type OpticalFlowPolicy = typeof OPTICAL_FLOW_POLICY
export interface OpticalFlowDiagnostics {
  accepted: number
  rejected: number
  rejectionReasons: string[]
}

export interface OpticalReplayFrame {
  width: number
  height: number
  capturedAt: number
  pixels: ArrayBuffer
}

export interface OpticalReplayAnchor {
  detection: QrDetection
  anchoredAt: number
  frames: OpticalReplayFrame[]
}

export type OpticalFlowRequest =
  | { type: 'init'; id: number; generation: number; policy: OpticalFlowPolicy }
  | {
      type: 'frame'
      id: number
      generation: number
      width: number
      height: number
      capturedAt: number
      pixels: ArrayBuffer
      anchors: QrDetection[]
      anchorTimes: Record<string, number>
    }
  | {
      type: 'reanchor'
      id: number
      generation: number
      anchors: OpticalReplayAnchor[]
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
      diagnostics: OpticalFlowDiagnostics
    }
  | {
      type: 'error'
      id: number
      generation: number
      phase: 'initialization' | 'runtime'
      message: string
    }
