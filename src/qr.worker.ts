/// <reference lib="webworker" />
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader'
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'
import type { DecodeRequest, DecodeResponse } from './workerProtocol'
import { mapZxingResults } from './zxingResults'

let initialized: Promise<void> | null = null

function initialize(): Promise<void> {
  initialized ??= prepareZXingModule({
    overrides: {
      locateFile: (path, prefix) => path.endsWith('.wasm') ? wasmUrl : `${prefix}${path}`,
    },
    fireImmediately: true,
  }).then(() => undefined)
  return initialized
}

function post(response: DecodeResponse): void {
  self.postMessage(response)
}

self.onmessage = async ({ data }: MessageEvent<DecodeRequest>) => {
  if (data.type === 'init') {
    try {
      await initialize()
      post({ type: 'ready', id: data.id, generation: data.generation, decoder: 'zxing-wasm' })
    } catch (error) {
      post({
        type: 'error',
        id: data.id,
        generation: data.generation,
        phase: 'initialization',
        message: error instanceof Error ? error.message : 'ZXing WASM initialization failed',
      })
    }
    return
  }
  const startedAt = performance.now()
  try {
    await initialize()
    const results = await readBarcodes(
      new ImageData(new Uint8ClampedArray(data.pixels), data.width, data.height),
      {
        formats: ['QRCode'],
        maxNumberOfSymbols: 4,
        tryHarder: false,
        tryRotate: true,
        tryInvert: true,
        returnErrors: false,
      },
    )
    const detections = mapZxingResults(results)
    post({
      type: 'result',
      id: data.id,
      generation: data.generation,
      detections,
      elapsedMs: performance.now() - startedAt,
    })
  } catch (error) {
    post({
      type: 'error',
      id: data.id,
      generation: data.generation,
      phase: 'runtime',
      message: error instanceof Error ? error.message : 'ZXing WASM decode failed',
    })
  }
}
