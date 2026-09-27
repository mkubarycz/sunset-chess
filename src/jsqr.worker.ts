/// <reference lib="webworker" />
import jsQR from 'jsqr'
import type { DecodeRequest, DecodeResponse } from './workerProtocol'

self.onmessage = ({ data }: MessageEvent<DecodeRequest>) => {
  if (data.type === 'init') {
    const response: DecodeResponse = {
      type: 'ready', id: data.id, generation: data.generation, decoder: 'jsqr',
    }
    self.postMessage(response)
    return
  }
  const startedAt = performance.now()
  try {
    const detection = jsQR(new Uint8ClampedArray(data.pixels), data.width, data.height, {
      inversionAttempts: 'attemptBoth',
    })
    const response: DecodeResponse = {
      type: 'result',
      id: data.id,
      generation: data.generation,
      detections: detection ? [detection] : [],
      elapsedMs: performance.now() - startedAt,
    }
    self.postMessage(response)
  } catch (error) {
    const response: DecodeResponse = {
      type: 'error',
      id: data.id,
      generation: data.generation,
      phase: 'runtime',
      message: error instanceof Error ? error.message : 'jsQR decoder failed',
    }
    self.postMessage(response)
  }
}
