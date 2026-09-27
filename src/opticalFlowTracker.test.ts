import { describe, expect, it, vi } from 'vitest'
import { OpticalFlowTracker } from './opticalFlowTracker'
import type { OpticalFlowRequest, OpticalFlowResponse } from './opticalFlowProtocol'

class FakeWorker extends EventTarget {
  postMessage = vi.fn()
  terminate = vi.fn()
  respond(response: OpticalFlowResponse) {
    this.dispatchEvent(new MessageEvent('message', { data: response }))
  }
}

async function initialize(tracker: OpticalFlowTracker, worker: FakeWorker) {
  const pending = tracker.initialize(3)
  const request = worker.postMessage.mock.calls[0][0] as OpticalFlowRequest
  if (request.type !== 'init') throw new Error('expected init request')
  worker.respond({ type: 'ready', id: request.id, generation: 3 })
  await pending
}

describe('OpticalFlowTracker worker lifecycle', () => {
  it('has explicit initialization, one in flight, anchors, and transferable frames', async () => {
    const worker = new FakeWorker()
    const tracker = new OpticalFlowTracker(worker as unknown as Worker, vi.fn())
    await initialize(tracker, worker)
    tracker.anchor([{
      data: 'a',
      location: {
        topLeftCorner: { x: 0, y: 0 }, topRightCorner: { x: 1, y: 0 },
        bottomRightCorner: { x: 1, y: 1 }, bottomLeftCorner: { x: 0, y: 1 },
      },
    }])
    const pixels = new ArrayBuffer(16)
    const result = tracker.process(pixels, 2, 2, 10, 3)
    expect(tracker.process(new ArrayBuffer(16), 2, 2, 11, 3)).toBeNull()
    expect(worker.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'frame', anchors: [expect.objectContaining({ data: 'a' })] }),
      [pixels],
    )
    worker.respond({
      type: 'result', id: 2, generation: 3, observations: [], elapsedMs: 4,
    })
    await expect(result).resolves.toMatchObject({ generation: 3, elapsedMs: 4 })
  })

  it('reports initialization failure and terminates', async () => {
    const worker = new FakeWorker()
    const failed = vi.fn()
    const tracker = new OpticalFlowTracker(worker as unknown as Worker, failed)
    const pending = tracker.initialize(1)
    worker.respond({
      type: 'error', id: 1, generation: 1, phase: 'initialization', message: 'missing LK',
    })
    await expect(pending).rejects.toThrow('missing LK')
    expect(failed).toHaveBeenCalledOnce()
    tracker.terminate()
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
})
