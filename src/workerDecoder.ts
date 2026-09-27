import type { QrDetection } from './scanner'
import type { DecodeRequest, DecodeResponse } from './workerProtocol'

export type DecoderResult = {
  generation: number
  detection: QrDetection | null
}

export const DECODE_TIMEOUT_MS = 5_000

export class WorkerDecoder {
  private nextId = 1
  private pending: {
    id: number
    resolve: (value: DecoderResult) => void
    reject: (reason: Error) => void
    timer: ReturnType<typeof setTimeout>
  } | null = null
  private terminated = false
  private failure: Error | null = null

  constructor(
    private readonly worker: Worker,
    private readonly onFailure?: (error: Error) => void,
    private readonly timeoutMs = DECODE_TIMEOUT_MS,
  ) {
    worker.addEventListener('message', this.handleMessage)
    worker.addEventListener('error', this.handleWorkerError)
    worker.addEventListener('messageerror', this.handleWorkerError)
  }

  get busy(): boolean {
    return this.pending !== null
  }

  decode(
    pixels: ArrayBuffer,
    width: number,
    height: number,
    generation: number,
  ): Promise<DecoderResult> | null {
    if (this.pending || this.terminated) return null
    if (this.failure) return Promise.reject(this.failure)
    const id = this.nextId++
    const request: DecodeRequest = { type: 'decode', id, generation, width, height, pixels }
    const promise = new Promise<DecoderResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new Error('QR decoder timed out'))
      }, this.timeoutMs)
      this.pending = { id, resolve, reject, timer }
    })
    try {
      this.worker.postMessage(request, [pixels])
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error('Could not contact QR decoder'))
    }
    return promise
  }

  terminate(): void {
    if (this.terminated) return
    this.terminated = true
    this.rejectPending(new Error('QR decoder stopped'))
    this.worker.removeEventListener('message', this.handleMessage)
    this.worker.removeEventListener('error', this.handleWorkerError)
    this.worker.removeEventListener('messageerror', this.handleWorkerError)
    this.worker.terminate()
  }

  private handleMessage = ({ data }: MessageEvent<DecodeResponse>) => {
    if (!this.pending || data.id !== this.pending.id) return
    const pending = this.pending
    this.pending = null
    clearTimeout(pending.timer)
    if (data.type === 'error') {
      this.failure = new Error(data.message)
      pending.reject(this.failure)
    } else pending.resolve({ generation: data.generation, detection: data.detection })
  }

  private handleWorkerError = (event: Event) => {
    const message = event instanceof ErrorEvent ? event.message : 'QR decoder worker failed'
    this.fail(new Error(message))
  }

  private rejectPending(error: Error): void {
    const pending = this.pending
    this.pending = null
    if (pending) clearTimeout(pending.timer)
    pending?.reject(error)
  }

  private fail(error: Error): void {
    if (this.failure || this.terminated) return
    this.failure = error
    const hadPending = this.pending !== null
    this.rejectPending(error)
    if (!hadPending) this.onFailure?.(error)
  }
}

export function createQrWorker(): Worker {
  return new Worker(new URL('./qr.worker.ts', import.meta.url), { type: 'module' })
}
