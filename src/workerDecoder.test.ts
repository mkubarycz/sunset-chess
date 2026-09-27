import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkerDecoder } from './workerDecoder'
import type { DecodeRequest, DecodeResponse } from './workerProtocol'

class FakeWorker extends EventTarget {
  postMessage = vi.fn()
  terminate = vi.fn()
  respond(response: DecodeResponse) {
    this.dispatchEvent(new MessageEvent('message', { data: response }))
  }
}

function ready(decoder: WorkerDecoder, worker: FakeWorker, generation = 1) {
  const initialized = decoder.initialize(generation)
  const request = worker.postMessage.mock.calls[0][0] as DecodeRequest
  worker.respond({
    type: 'ready', id: request.id, generation, decoder: 'zxing-wasm',
  })
  return initialized
}

describe('WorkerDecoder', () => {
  afterEach(() => vi.useRealTimers())

  it('initializes explicitly and allows exactly one transferable decode in flight', async () => {
    const worker = new FakeWorker()
    const decoder = new WorkerDecoder(worker as unknown as Worker)
    await ready(decoder, worker, 4)
    const pixels = new ArrayBuffer(16)
    const first = decoder.decode(pixels, 2, 2, 4)
    expect(decoder.decode(new ArrayBuffer(16), 2, 2, 4)).toBeNull()
    expect(worker.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'decode', pixels }),
      [pixels],
    )
    worker.respond({
      type: 'result', id: 2, generation: 4, detections: [], elapsedMs: 7,
    })
    await expect(first).resolves.toEqual({ generation: 4, detections: [], elapsedMs: 7 })
    expect(decoder.busy).toBe(false)
  })

  it('surfaces initialization failure and rejects later work', async () => {
    const worker = new FakeWorker()
    const decoder = new WorkerDecoder(worker as unknown as Worker)
    const initialized = decoder.initialize(1)
    worker.respond({
      type: 'error', id: 1, generation: 1, phase: 'initialization', message: 'WASM unavailable',
    })
    await expect(initialized).rejects.toThrow('initialization: WASM unavailable')
    expect(decoder.decode(new ArrayBuffer(4), 1, 1, 1)).toBeNull()
  })

  it('discards responses whose id does not match the bounded in-flight request', async () => {
    const worker = new FakeWorker()
    const decoder = new WorkerDecoder(worker as unknown as Worker)
    await ready(decoder, worker)
    const pending = decoder.decode(new ArrayBuffer(4), 1, 1, 8)!
    worker.respond({ type: 'result', id: 999, generation: 7, detections: [], elapsedMs: 1 })
    expect(decoder.busy).toBe(true)
    worker.respond({ type: 'result', id: 2, generation: 8, detections: [], elapsedMs: 2 })
    await expect(pending).resolves.toMatchObject({ generation: 8 })
  })

  it('times out, reports runtime errors, and terminates cleanly', async () => {
    vi.useFakeTimers()
    const worker = new FakeWorker()
    const decoder = new WorkerDecoder(worker as unknown as Worker, undefined, 25)
    await ready(decoder, worker)
    const pending = decoder.decode(new ArrayBuffer(4), 1, 1, 1)!
    const rejection = expect(pending).rejects.toThrow('QR decoder timed out')
    await vi.advanceTimersByTimeAsync(25)
    await rejection
    decoder.terminate()
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(decoder.decode(new ArrayBuffer(4), 1, 1, 1)).toBeNull()
  })

  it('returns all QR identities and quadrilateral geometry unchanged', async () => {
    const worker = new FakeWorker()
    const decoder = new WorkerDecoder(worker as unknown as Worker)
    await ready(decoder, worker)
    const pending = decoder.decode(new ArrayBuffer(16), 2, 2, 1)!
    const location = {
      topLeftCorner: { x: 1, y: 2 },
      topRightCorner: { x: 8, y: 2 },
      bottomRightCorner: { x: 8, y: 9 },
      bottomLeftCorner: { x: 1, y: 9 },
    }
    worker.respond({
      type: 'result',
      id: 2,
      generation: 1,
      detections: [{ data: 'one', location }, { data: 'two', location }],
      elapsedMs: 4,
    })
    await expect(pending).resolves.toMatchObject({
      detections: [{ data: 'one', location }, { data: 'two', location }],
    })
  })
})
