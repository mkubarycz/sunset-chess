import QRCode from 'qrcode'

export const PLAYER_QR_RENDER_OPTIONS = {
  type: 'svg' as const,
  errorCorrectionLevel: 'H' as const,
  margin: 4,
  color: { dark: '#000000', light: '#ffffff' },
}

export async function encodeQrDataUrl(value: string): Promise<string> {
  const svg = await QRCode.toString(value, PLAYER_QR_RENDER_OPTIONS)
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
