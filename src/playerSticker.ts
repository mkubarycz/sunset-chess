import { encodeQrDataUrl } from './qrArtwork'
import { encodePlayerReference } from './qrPayload'

export interface StickerPlayer {
  id: number
  name: string
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] as string)
}

export async function printRoundPlayerSticker(
  player: StickerPlayer,
  openWindow: typeof window.open = window.open.bind(window),
  encodeQr: typeof encodeQrDataUrl = encodeQrDataUrl,
): Promise<void> {
  const printWindow = openWindow('', '_blank', 'popup,width=560,height=640')
  if (!printWindow) throw new Error('The print window was blocked. Allow popups and try again.')

  try {
    const qrDataUrl = await encodeQr(encodePlayerReference(player.id))
    const name = escapeHtml(player.name)
    printWindow.document.open()
    printWindow.document.write(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Round sticker — ${name} #${player.id}</title>
<style>
  *{box-sizing:border-box}body{margin:0;padding:24px;font:16px system-ui,sans-serif;color:#111;background:#fff}
  main{display:grid;justify-items:center;gap:16px}.sticker{display:grid;place-items:center;width:1in;height:1in;padding:.09in;border:.01in solid #000;border-radius:50%;background:#fff}
  .sticker img{display:block;width:.8in;height:.8in;image-rendering:pixelated}.identity{margin:0;text-align:center}
  @page{size:1in 1in;margin:0}@media print{body{width:1in;height:1in;padding:0}.identity{display:none}.sticker{break-inside:avoid}}
</style></head><body><main><div class="sticker" aria-label="One inch round sticker for ${name}, player ${player.id}">
<img src="${qrDataUrl}" alt="QR code for ${name}, player ${player.id}"></div>
<p class="identity"><strong>${name}</strong><br>Player #${player.id}</p></main>
<script>addEventListener('load',()=>{setTimeout(()=>window.print(),0)},{once:true})</script></body></html>`)
    printWindow.document.close()
  } catch (error) {
    printWindow.close()
    throw error
  }
}
