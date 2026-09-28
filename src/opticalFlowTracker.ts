import type { QrDetection } from './scanner'
import type { OpticalFlowRequest, OpticalFlowResponse } from './opticalFlowProtocol'
import type { VisualTrackObservation } from './visualObjectTracker'
import { OPTICAL_FLOW_POLICY } from './opticalFlowPolicy'
import type { OpticalFlowDiagnostics } from './opticalFlowProtocol'

export interface OpticalFlowResult {
  generation: number
  observations: VisualTrackObservation[]
  elapsedMs: number
  diagnostics: OpticalFlowDiagnostics
}

type Pending =
  | {
      kind: 'init'
      id: number
      resolve: () => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  | {
      kind: 'frame'
      id: number
      resolve: (result: OpticalFlowResult) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }

export class OpticalFlowTracker {
  private nextId = 1
  private pending: Pending | null = null
  private ready = false
  private stopped = false
  private failure: Error | null = null

  constructor(
    private readonly worker: Worker,
    private readonly onFailure: (error: Error) => void,
    private readonly timeoutMs = 5_000,
  ) {
    worker.addEventListener('message', this.handleMessage)
    worker.addEventListener('error', this.handleError)
    worker.addEventListener('messageerror', this.handleError)
  }

  get busy(): boolean {
    return this.pending !== null
  }

  get isReady(): boolean {
    return this.ready
  }

  initialize(generation: number): Promise<void> {
    if (this.failure) return Promise.reject(this.failure)
    if (this.stopped) return Promise.reject(new Error('OpenCV tracker stopped'))
    if (this.ready) return Promise.resolve()
    if (this.pending) return Promise.reject(new Error('OpenCV tracker is busy'))
    const id = this.nextId++
    const promise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail(new Error('OpenCV initialization timed out')),
        this.timeoutMs,
      )
      this.pending = { kind: 'init', id, resolve, reject, timer }
    })
    this.post({ type: 'init', id, generation, policy: OPTICAL_FLOW_POLICY })
    return promise
  }

  process(
    pixels: ArrayBuffer,
    width: number,
    height: number,
    capturedAt: number,
    generation: number,
    anchors: readonly QrDetection[] = [],
    anchorTimes: Readonly<Record<string, number>> = {},
  ): Promise<OpticalFlowResult> | null {
    if (!this.ready || this.pending || this.stopped || this.failure) return null
    const id = this.nextId++
    const promise = new Promise<OpticalFlowResult>((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error('OpenCV tracking timed out')), this.timeoutMs)
      this.pending = { kind: 'frame', id, resolve, reject, timer }
    })
    this.post({
      type: 'frame', id, generation, pixels, width, height, capturedAt,
      anchors: [...new Map(anchors.map((item) => [item.data, item])).values()],
      anchorTimes: { ...anchorTimes },
    }, [pixels])
    return promise
  }

  clear(generation: number): void {
    if (!this.stopped) this.post({ type: 'clear', generation })
  }

  terminate(): void {
    if (this.stopped) return
    this.stopped = true
    this.rejectPending(new Error('OpenCV tracker stopped'))
    this.worker.removeEventListener('message', this.handleMessage)
    this.worker.removeEventListener('error', this.handleError)
    this.worker.removeEventListener('messageerror', this.handleError)
    this.worker.terminate()
  }

  private post(message: OpticalFlowRequest, transfer: Transferable[] = []): void {
    try {
      this.worker.postMessage(message, transfer)
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error('Could not contact OpenCV tracker'))
    }
  }

  private handleMessage = ({ data }: MessageEvent<OpticalFlowResponse>) => {
    if (!this.pending || data.id !== this.pending.id) return
    const pending = this.pending
    this.pending = null
    clearTimeout(pending.timer)
    if (data.type === 'error') {
      this.fail(new Error(`${data.phase}: ${data.message}`), pending)
    } else if (data.type === 'ready' && pending.kind === 'init') {
      this.ready = true
      pending.resolve()
    } else if (data.type === 'result' && pending.kind === 'frame') {
      pending.resolve(data)
    } else {
      this.fail(new Error('OpenCV tracker returned an invalid response'), pending)
    }
  }

  private handleError = (event: Event) => {
    this.fail(new Error(event instanceof ErrorEvent ? event.message : 'OpenCV worker failed'))
  }

  private rejectPending(error: Error): void {
    const pending = this.pending
    this.pending = null
    if (pending) clearTimeout(pending.timer)
    pending?.reject(error)
  }

  private fail(error: Error, pending = this.pending): void {
    if (this.failure || this.stopped) return
    this.failure = error
    if (this.pending === pending) this.rejectPending(error)
    else {
      clearTimeout(pending?.timer)
      pending?.reject(error)
    }
    this.onFailure(error)
  }
}

export function createOpenCvWorker(): Worker {
  return new Worker(new URL('./opencv.worker.js', import.meta.url), { type: 'module' })
}
