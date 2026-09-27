/// <reference lib="webworker" />
import jsQR from 'jsqr'
import type { DecodeRequest, DecodeResponse } from './workerProtocol'

self.onmessage = ({ data }: MessageEvent<DecodeRequest>) => {
  try {
    const detection = jsQR(new Uint8ClampedArray(data.pixels), data.width, data.height, {
      inversionAttempts: 'attemptBoth',
    })
    const response: DecodeResponse = {
      type: 'result',
      id: data.id,
      generation: data.generation,
      detection,
    }
    self.postMessage(response)
  } catch (error) {
    const response: DecodeResponse = {
      type: 'error',
      id: data.id,
      generation: data.generation,
      message: error instanceof Error ? error.message : 'QR decoder failed',
    }
    self.postMessage(response)
  }
}
