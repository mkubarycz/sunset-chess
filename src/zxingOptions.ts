import type { ReaderOptions } from 'zxing-wasm/reader'

export const ZXING_QR_READER_OPTIONS = {
  formats: ['QRCode'],
  maxNumberOfSymbols: 4,
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  returnErrors: false,
} satisfies ReaderOptions
