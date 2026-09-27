import type { QrDetection } from './scanner'
import type { DecoderKind, DecodeRequest, DecodeResponse } from './workerProtocol'

export type DecoderResult = {
  generation: number
  detections: QrDetection[]
  elapsedMs: number
}

export const DECODE_TIMEOUT_MS = 5_000

type Pending =
  | {
      kind: 'init'
      id: number
      resolve: (decoder: DecoderKind) => void
      reject: (reason: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  | {
      kind: 'decode'
      id: number
      resolve: (value: DecoderResult) => void
      reject: (reason: Error) => void
      timer: ReturnType<typeof setTimeout>
    }

export class WorkerDecoder {
  private nextId = 1
  private pending: Pending | null = null
  private terminated = false
  private failure: Error | null = null
  private ready = false
  decoder: DecoderKind | null = null

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

  initialize(generation: number): Promise<DecoderKind> {
    if (this.failure) return Promise.reject(this.failure)
    if (this.terminated) return Promise.reject(new Error('QR decoder stopped'))
    if (this.ready && this.decoder) return Promise.resolve(this.decoder)
    if (this.pending) return Promise.reject(new Error('QR decoder is busy'))
    const id = this.nextId++
    const promise = new Promise<DecoderKind>((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error('QR decoder initialization timed out')), this.timeoutMs)
      this.pending = { kind: 'init', id, resolve, reject, timer }
    })
    this.post({ type: 'init', id, generation })
    return promise
  }

  decode(
    pixels: ArrayBuffer,
    width: number,
    height: number,
    generation: number,
  ): Promise<DecoderResult> | null {
    if (this.pending || this.terminated || !this.ready) return null
    if (this.failure) return Promise.reject(this.failure)
    const id = this.nextId++
    const promise = new Promise<DecoderResult>((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error('QR decoder timed out')), this.timeoutMs)
      this.pending = { kind: 'decode', id, resolve, reject, timer }
    })
    this.post({ type: 'decode', id, generation, width, height, pixels }, [pixels])
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

  private post(request: DecodeRequest, transfer: Transferable[] = []): void {
    try {
      this.worker.postMessage(request, transfer)
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error('Could not contact QR decoder'))
    }
  }

  private handleMessage = ({ data }: MessageEvent<DecodeResponse>) => {
    if (!this.pending || data.id !== this.pending.id) return
    const pending = this.pending
    this.pending = null
    clearTimeout(pending.timer)
    if (data.type === 'error') {
      this.fail(new Error(`${data.phase}: ${data.message}`), pending)
    } else if (data.type === 'ready' && pending.kind === 'init') {
      this.ready = true
      this.decoder = data.decoder
      pending.resolve(data.decoder)
    } else if (data.type === 'result' && pending.kind === 'decode') {
      pending.resolve({
        generation: data.generation,
        detections: data.detections ?? (data.detection ? [data.detection] : []),
        elapsedMs: data.elapsedMs ?? 0,
      })
    } else {
      this.fail(new Error('QR decoder returned an invalid response'), pending)
    }
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

  private fail(error: Error, pending = this.pending): void {
    if (this.failure || this.terminated) return
    this.failure = error
    const hadPending = pending !== null
    if (this.pending === pending) this.rejectPending(error)
    else {
      clearTimeout(pending?.timer)
      pending?.reject(error)
    }
    if (!hadPending) this.onFailure?.(error)
  }
}

export function createQrWorker(): Worker {
  return new Worker(new URL('./qr.worker.ts', import.meta.url), { type: 'module' })
}

export function createJsQrWorker(): Worker {
  return new Worker(new URL('./jsqr.worker.ts', import.meta.url), { type: 'module' })
}
