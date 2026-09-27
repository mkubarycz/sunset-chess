import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkerDecoder } from './workerDecoder'
import type { DecodeResponse } from './workerProtocol'

class FakeWorker extends EventTarget {
  postMessage = vi.fn()
  terminate = vi.fn()
  respond(response: DecodeResponse) {
    this.dispatchEvent(new MessageEvent('message', { data: response }))
  }
}

describe('WorkerDecoder', () => {
  afterEach(() => vi.useRealTimers())

  it('allows exactly one decode in flight and transfers the buffer', async () => {
    const worker = new FakeWorker()
    const decoder = new WorkerDecoder(worker as unknown as Worker)
    const pixels = new ArrayBuffer(16)
    const first = decoder.decode(pixels, 2, 2, 4)
    expect(decoder.decode(new ArrayBuffer(16), 2, 2, 4)).toBeNull()
    expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ pixels }), [pixels])
    worker.respond({ type: 'result', id: 1, generation: 4, detection: null })
    await expect(first).resolves.toEqual({ generation: 4, detection: null })
    expect(decoder.busy).toBe(false)
  })

  it('releases the pending lock after worker errors and terminates cleanly', async () => {
    const worker = new FakeWorker()
    const decoder = new WorkerDecoder(worker as unknown as Worker)
    const pending = decoder.decode(new ArrayBuffer(4), 1, 1, 1)
    worker.dispatchEvent(new ErrorEvent('error', { message: 'boom' }))
    await expect(pending).rejects.toThrow('boom')
    expect(decoder.busy).toBe(false)
    decoder.terminate()
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(decoder.decode(new ArrayBuffer(4), 1, 1, 1)).toBeNull()
  })

  it('reports a failure before the first decode and rejects future decodes immediately', async () => {
    const worker = new FakeWorker()
    const onFailure = vi.fn()
    const decoder = new WorkerDecoder(worker as unknown as Worker, onFailure)
    worker.dispatchEvent(new ErrorEvent('error', { message: 'failed during startup' }))

    expect(onFailure).toHaveBeenCalledOnce()
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ message: 'failed during startup' }))
    await expect(decoder.decode(new ArrayBuffer(4), 1, 1, 1)).rejects.toThrow('failed during startup')
    expect(worker.postMessage).not.toHaveBeenCalled()
  })

  it('times out a decode, marks the decoder failed, and rejects subsequent decodes', async () => {
    vi.useFakeTimers()
    const worker = new FakeWorker()
    const decoder = new WorkerDecoder(worker as unknown as Worker, undefined, 25)
    const pending = decoder.decode(new ArrayBuffer(4), 1, 1, 1)
    const rejection = expect(pending).rejects.toThrow('QR decoder timed out')

    await vi.advanceTimersByTimeAsync(25)
    await rejection
    expect(decoder.busy).toBe(false)
    await expect(decoder.decode(new ArrayBuffer(4), 1, 1, 1)).rejects.toThrow('QR decoder timed out')
    expect(worker.postMessage).toHaveBeenCalledOnce()
  })

  it('cleans decode timers on result, worker error, and termination', async () => {
    vi.useFakeTimers()
    const worker = new FakeWorker()
    const decoder = new WorkerDecoder(worker as unknown as Worker)
    const completed = decoder.decode(new ArrayBuffer(4), 1, 1, 1)
    expect(vi.getTimerCount()).toBe(1)
    worker.respond({ type: 'result', id: 1, generation: 1, detection: null })
    await completed
    expect(vi.getTimerCount()).toBe(0)

    const workerWithError = new FakeWorker()
    const erroredDecoder = new WorkerDecoder(workerWithError as unknown as Worker)
    const errored = erroredDecoder.decode(new ArrayBuffer(4), 1, 1, 1)
    workerWithError.dispatchEvent(new ErrorEvent('error', { message: 'broken' }))
    await expect(errored).rejects.toThrow('broken')
    expect(vi.getTimerCount()).toBe(0)

    const terminatedWorker = new FakeWorker()
    const terminatedDecoder = new WorkerDecoder(terminatedWorker as unknown as Worker)
    const terminated = terminatedDecoder.decode(new ArrayBuffer(4), 1, 1, 1)
    terminatedDecoder.terminate()
    await expect(terminated).rejects.toThrow('stopped')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('fails closed when the worker reports a jsQR error', async () => {
    const worker = new FakeWorker()
    const decoder = new WorkerDecoder(worker as unknown as Worker)
    const pending = decoder.decode(new ArrayBuffer(4), 1, 1, 1)
    worker.respond({ type: 'error', id: 1, generation: 1, message: 'jsQR exploded' })

    await expect(pending).rejects.toThrow('jsQR exploded')
    await expect(decoder.decode(new ArrayBuffer(4), 1, 1, 1)).rejects.toThrow('jsQR exploded')
    expect(worker.postMessage).toHaveBeenCalledOnce()
  })
})
