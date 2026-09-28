export const DIAGNOSTIC_DURATION_MS = 10_000
export const DIAGNOSTIC_MAX_SAMPLES = 720
export const DIAGNOSTIC_MAX_EVENTS = 400

export type DiagnosticPhase = 'idle' | 'recording' | 'ready' | 'error'

export interface DiagnosticSession {
  id: string
  startedAt: number
  endsAt: number
  samples: unknown[]
  events: unknown[]
}

export function diagnosticSessionId(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

export function startDiagnostic(now: number, id: string): DiagnosticSession {
  return { id, startedAt: now, endsAt: now + DIAGNOSTIC_DURATION_MS, samples: [], events: [] }
}

export function appendDiagnosticSample(
  session: DiagnosticSession,
  sample: unknown,
): DiagnosticSession {
  return {
    ...session,
    samples: [...session.samples.slice(-(DIAGNOSTIC_MAX_SAMPLES - 1)), sample],
  }
}

export function appendDiagnosticEvent(
  session: DiagnosticSession,
  event: unknown,
): DiagnosticSession {
  return {
    ...session,
    events: [...session.events.slice(-(DIAGNOSTIC_MAX_EVENTS - 1)), event],
  }
}

export function diagnosticRemainingMs(session: DiagnosticSession, now: number): number {
  return Math.max(0, session.endsAt - now)
}

export class DiagnosticUrls {
  video: string | null = null
  telemetry: string | null = null

  replace(video: Blob | null, telemetry: Blob): { video: string | null; telemetry: string } {
    this.revoke()
    this.video = video ? URL.createObjectURL(video) : null
    this.telemetry = URL.createObjectURL(telemetry)
    return { video: this.video, telemetry: this.telemetry }
  }

  revoke(): void {
    if (this.video) URL.revokeObjectURL(this.video)
    if (this.telemetry) URL.revokeObjectURL(this.telemetry)
    this.video = null
    this.telemetry = null
  }
}

export function supportsDiagnosticVideo(
  canvas: HTMLCanvasElement,
): boolean {
  return typeof MediaRecorder !== 'undefined'
    && typeof canvas.captureStream === 'function'
}

