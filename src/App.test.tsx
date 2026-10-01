import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App, {
  CAMERA_INACTIVITY_MS,
  PLAYER_LOOKUP_RETRY_BASE_MS,
  VIDEO_FRAME_CALLBACK_WATCHDOG_MS,
} from './App'
import { encodeQrDataUrl, PLAYER_QR_RENDER_OPTIONS } from './qrArtwork'
import type { NativeBarcodeDetector } from './nativeBarcodeDecoder'
import type { DecodeRequest, DecodeResponse } from './workerProtocol'
import type { QrDetection } from './scanner'
import type { OpticalFlowRequest, OpticalFlowResponse } from './opticalFlowProtocol'

class FakeWorker extends EventTarget {
  postMessage = vi.fn((request: DecodeRequest) => {
    if (request.type !== 'init') return
    queueMicrotask(() => {
      this.respond({
        type: 'ready',
        id: request.id,
        generation: request.generation,
        decoder: 'zxing-wasm',
      })

      this.postMessage.mockClear()
    })
  })
  terminate = vi.fn()
  respond(response: DecodeResponse) {
    this.dispatchEvent(new MessageEvent('message', { data: response }))
  }
}

class FakeOpticalWorker extends EventTarget {
  postMessage = vi.fn((request: OpticalFlowRequest) => {
    if (request.type !== 'init') return
    queueMicrotask(() => this.respond({
      type: 'ready',
      id: request.id,
      generation: request.generation,
    }))
  })
  terminate = vi.fn()
  respond(response: OpticalFlowResponse) {
    this.dispatchEvent(new MessageEvent('message', { data: response }))
  }
}

const mediaDevicesDescriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
const secureContextDescriptor = Object.getOwnPropertyDescriptor(window, 'isSecureContext')
const requestVideoFrameDescriptor = Object.getOwnPropertyDescriptor(
  HTMLVideoElement.prototype,
  'requestVideoFrameCallback',
)
const cancelVideoFrameDescriptor = Object.getOwnPropertyDescriptor(
  HTMLVideoElement.prototype,
  'cancelVideoFrameCallback',
)
let resizeCallbacks: ResizeObserverCallback[] = []

function restoreDescriptor(target: object, key: PropertyKey, descriptor?: PropertyDescriptor) {
  if (descriptor) Object.defineProperty(target, key, descriptor)
  else Reflect.deleteProperty(target, key)
}

function mediaStream() {
  const listeners = new Set<EventListenerOrEventListenerObject>()
  const track = {
    stop: vi.fn(),
    addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === 'ended') listeners.add(listener)
    }),
    end: () => listeners.forEach((listener) => {
      if (typeof listener === 'function') listener(new Event('ended'))
      else listener.handleEvent(new Event('ended'))
    }),
  }
  return {
    stream: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream,
    track,
  }
}

function setupCamera() {
  const { stream, track } = mediaStream()
  const getUserMedia = vi.fn().mockResolvedValue(stream)
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  const callbacks: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    callbacks.push(callback)
    return callbacks.length
  }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const context = {
    drawImage: vi.fn(),
    scale: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => ({
      data: Uint8ClampedArray.from(
        { length: width * height * 4 },
        (_, index) => index % 4 === 3
          ? 255
          : (((Math.floor(index / 4) % width) * 17
            + Math.floor(Math.floor(index / 4) / width) * 29) % 256),
      ),
      width,
      height,
    })),
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never)
  return { stream, track, getUserMedia, callbacks, context }
}

describe('scanner and player producer', () => {
  beforeEach(() => {
    localStorage.setItem('sunset-chess:preferences', JSON.stringify({
      version: 1,
      showDebugTools: true,
      selectedTab: 'leaderboard',
      markerShape: 'square',
    }))
    resizeCallbacks = []
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback)
      }
    })

    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    restoreDescriptor(navigator, 'mediaDevices', mediaDevicesDescriptor)
    restoreDescriptor(window, 'isSecureContext', secureContextDescriptor)
    restoreDescriptor(HTMLVideoElement.prototype, 'requestVideoFrameCallback', requestVideoFrameDescriptor)
    restoreDescriptor(HTMLVideoElement.prototype, 'cancelVideoFrameCallback', cancelVideoFrameDescriptor)
  })

  it('starts with ideal constraints and stops the worker and track on unmount', async () => {
    const camera = setupCamera()
    const worker = new FakeWorker()
    const view = render(<App workerFactory={() => worker as unknown as Worker} />)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Scanning for a QR code'))
    const layer = screen.getByTestId('camera-interaction-layer')
    expect(layer).toHaveClass('is-hidden', 'fullscreen-camera-overlay')
    expect(layer).toHaveAttribute('aria-hidden', 'true')
    expect(layer).toHaveAttribute('data-coordinate-space', 'full-viewport')
    expect(document.querySelector('.dashboard')).not.toContainElement(layer)
    expect(within(layer).getByLabelText('Mirrored live camera preview')).toBeInTheDocument()
    expect(camera.getUserMedia).toHaveBeenCalledOnce()
    expect(camera.getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920, max: 3840 },
        height: { ideal: 1080, max: 2160 },
        frameRate: { ideal: 60 },
      },
    })

    view.unmount()
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(camera.track.stop).toHaveBeenCalledOnce()
  })

  it('ignores obsolete camera setup storage without opening the camera overlay', async () => {
    const legacyKey = 'sunset-chess:retired-camera-settings'
    localStorage.setItem(legacyKey, '{obsolete')
    setupCamera()
    const view = render(<App />)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Scanning for a QR code'))
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(within(screen.getByRole('menu')).queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
    expect(screen.getByTestId('camera-interaction-layer')).toHaveClass('is-hidden')
    view.unmount()
    localStorage.removeItem(legacyKey)
  })

  it('forces the hidden camera layer visible during an explicit diagnostic recording', async () => {
    setupCamera()
    render(<App />)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Scanning for a QR code'))
    const layer = screen.getByTestId('camera-interaction-layer')
    expect(layer).toHaveClass('is-hidden')

    await userEvent.click(screen.getByRole('button', { name: 'Record 10s tracking diagnostic' }))

    expect(layer).toHaveClass('is-visible')
    expect(within(layer).getByText('Recording diagnostic')).toBeInTheDocument()
    expect(document.querySelector('.dashboard')).toHaveAttribute('inert')
    expect(document.querySelector('video')).toBeInTheDocument()
  })

  it('auto-starts exactly once through StrictMode effect replay', async () => {
    const camera = setupCamera()
    render(
      <StrictMode>
        <App workerFactory={() => new FakeWorker() as unknown as Worker} />
      </StrictMode>,
    )

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Scanning for a QR code'))
    expect(camera.getUserMedia).toHaveBeenCalledOnce()
  })

  it('manually stops all camera work and reacquires only after explicit Start Camera', async () => {
    const first = mediaStream()
    const second = mediaStream()
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(first.stream)
      .mockResolvedValueOnce(second.stream)
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const workers = [new FakeWorker(), new FakeWorker()]
    render(<App workerFactory={() => workers.shift() as unknown as Worker} />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop Camera' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Stop Camera' }))

    expect(first.track.stop).toHaveBeenCalledOnce()
    expect(screen.getByRole('status')).toHaveTextContent('Camera off')
    expect(screen.getByRole('button', { name: 'Start Camera' })).toBeInTheDocument()
    await act(async () => Promise.resolve())
    expect(getUserMedia).toHaveBeenCalledOnce()

    await userEvent.click(screen.getByRole('button', { name: 'Start Camera' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop Camera' })).toBeInTheDocument())
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(second.track.stop).not.toHaveBeenCalled()
  })

  it('disables the camera control while permission is being requested', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(() => new Promise<MediaStream>(() => undefined)) },
    })
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Starting…' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for camera permission')
  })

  it('disables camera access in an insecure context', async () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Camera unavailable' })).toBeDisabled()
    expect(document.querySelector('.camera-action-notice')).toHaveTextContent('A secure connection is required')
  })

  it('offers Start Camera after an unexpected startup error', async () => {
    setupCamera()
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error('play failed'))
    render(<App />)
    await waitFor(() => expect(document.querySelector('.camera-action-notice')).toHaveTextContent('The QR scanner stopped'))
    expect(screen.getByRole('button', { name: 'Start Camera' })).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent('The QR scanner stopped')
  })

  it('hides all diagnostics when debug tools are disabled', async () => {
    localStorage.setItem('sunset-chess:preferences', JSON.stringify({
      version: 1,
      showDebugTools: false,
      selectedTab: 'leaderboard',
      markerShape: 'square',
    }))
    setupCamera()
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop Camera' })).toBeInTheDocument())
    expect(screen.queryByLabelText('Camera debug tools')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Scanner diagnostics')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record 10s tracking diagnostic' })).not.toBeInTheDocument()
  })

  it('stops a stream that resolves after unmount without installing it', async () => {
    let resolvePermission: ((stream: MediaStream) => void) | undefined
    const getUserMedia = vi.fn(() => new Promise<MediaStream>((resolve) => {
      resolvePermission = resolve
    }))
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
    const { stream, track } = mediaStream()
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    const view = render(<App workerFactory={() => new FakeWorker() as unknown as Worker} />)
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce())

    view.unmount()
    await act(async () => resolvePermission?.(stream))

    expect(track.stop).toHaveBeenCalledOnce()
    expect(play).not.toHaveBeenCalled()
  })

  it('pauses after five minutes without a detection and offers Start Camera', async () => {
    vi.useFakeTimers()
    const camera = setupCamera()
    const worker = new FakeWorker()
    render(<App
      workerFactory={() => worker as unknown as Worker}
      fetchGames={vi.fn().mockResolvedValue([])}
      gamesPollIntervalMs={1_000_000}
    />)
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(screen.getByRole('status')).toHaveTextContent('Scanning for a QR code')

    await act(async () => vi.advanceTimersByTimeAsync(CAMERA_INACTIVITY_MS))

    expect(camera.track.stop).toHaveBeenCalledOnce()
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(cancelAnimationFrame).toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('Camera off')
    expect(screen.getByRole('alert')).toHaveTextContent('Camera paused after 5 minutes without a QR code')
    expect(screen.getByRole('button', { name: 'Start Camera' })).toBeInTheDocument()
  })

  it('ignores a decode result that arrives after inactivity shutdown', async () => {
    vi.useFakeTimers()
    const camera = setupCamera()
    const worker = new FakeWorker()
    const checkInPlayer = vi.fn()
    render(<App
      workerFactory={() => worker as unknown as Worker}
      checkInPlayer={checkInPlayer}
      fetchGames={vi.fn().mockResolvedValue([])}
      gamesPollIntervalMs={1_000_000}
    />)
    const video = screen.getByLabelText('Mirrored live camera preview')
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 2 },
      videoHeight: { configurable: true, value: 2 },
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
    })
    await act(async () => vi.advanceTimersByTimeAsync(0))
    await act(async () => vi.advanceTimersByTimeAsync(CAMERA_INACTIVITY_MS - 100))
    act(() => camera.callbacks.shift()?.(performance.now() + 200))
    const request = worker.postMessage.mock.calls[0][0] as DecodeRequest

    await act(async () => vi.advanceTimersByTimeAsync(100))
    act(() => worker.respond({
      type: 'result',
      id: request.id,
      generation: request.generation,
      detection: {
        data: '{"v":1,"kind":"player","playerId":1234,"name":"Ada"}',
        location: {
          topLeftCorner: { x: 0, y: 0 }, topRightCorner: { x: 2, y: 0 },
          bottomRightCorner: { x: 2, y: 2 }, bottomLeftCorner: { x: 0, y: 2 },
        },
      },
    }))

    expect(screen.getByRole('status')).toHaveTextContent('Camera off')
    expect(screen.queryByText('Ada · #1234')).not.toBeInTheDocument()
    expect(checkInPlayer).not.toHaveBeenCalled()
  })

  it('resets inactivity for repeated arbitrary QR detections, not focus or visibility', async () => {
    vi.useFakeTimers()
    const camera = setupCamera()
    const worker = new FakeWorker()
    render(<App
      workerFactory={() => worker as unknown as Worker}
      fetchGames={vi.fn().mockResolvedValue([])}
      gamesPollIntervalMs={1_000_000}
    />)
    const video = screen.getByLabelText('Mirrored live camera preview')
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 2 },
      videoHeight: { configurable: true, value: 2 },
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
    })
    await act(async () => vi.advanceTimersByTimeAsync(0))

    const location = {
      topLeftCorner: { x: 0, y: 0 }, topRightCorner: { x: 2, y: 0 },
      bottomRightCorner: { x: 2, y: 2 }, bottomLeftCorner: { x: 0, y: 2 },
    }
    await act(async () => vi.advanceTimersByTimeAsync(CAMERA_INACTIVITY_MS - 1000))
    act(() => camera.callbacks.shift()?.(performance.now() + 200))
    let request = worker.postMessage.mock.calls.at(-1)?.[0] as DecodeRequest
    act(() => worker.respond({
      type: 'result', id: request.id, generation: request.generation,
      detection: { data: 'arbitrary-qr', location },
    }))
    await act(async () => vi.advanceTimersByTimeAsync(CAMERA_INACTIVITY_MS - 1000))
    expect(camera.track.stop).not.toHaveBeenCalled()

    act(() => camera.callbacks.shift()?.(performance.now() + 200))
    request = worker.postMessage.mock.calls.at(-1)?.[0] as DecodeRequest
    act(() => worker.respond({
      type: 'result', id: request.id, generation: request.generation,
      detection: { data: 'arbitrary-qr', location },
    }))
    act(() => {
      window.dispatchEvent(new Event('focus'))
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await act(async () => vi.advanceTimersByTimeAsync(CAMERA_INACTIVITY_MS))
    expect(camera.track.stop).toHaveBeenCalledOnce()
  })

  it('restarts after inactivity with a fresh generation unaffected by the old timeout', async () => {
    vi.useFakeTimers()
    const first = mediaStream()
    const second = mediaStream()
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(first.stream)
      .mockResolvedValueOnce(second.stream)
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const workers = [new FakeWorker(), new FakeWorker()]
    render(<App
      workerFactory={() => workers.shift() as unknown as Worker}
      fetchGames={vi.fn().mockResolvedValue([])}
      gamesPollIntervalMs={1_000_000}
    />)
    await act(async () => vi.advanceTimersByTimeAsync(0))
    await act(async () => vi.advanceTimersByTimeAsync(CAMERA_INACTIVITY_MS))
    act(() => screen.getByRole('button', { name: 'Start Camera' }).click())
    await act(async () => undefined)
    expect(getUserMedia).toHaveBeenCalledTimes(2)

    await act(async () => vi.advanceTimersByTimeAsync(CAMERA_INACTIVITY_MS - 1))
    expect(second.track.stop).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(second.track.stop).toHaveBeenCalledOnce()
  })

  it('auto-reports permission and availability failures and permits manual retry', async () => {
    setupCamera()
    const retry = mediaStream()
    const getUserMedia = vi.fn()
      .mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
      .mockResolvedValueOnce(retry.stream)
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
    render(<App workerFactory={() => new FakeWorker() as unknown as Worker} />)
    expect(await screen.findByRole('status')).toHaveTextContent('Camera permission was denied')
    expect(screen.getByTestId('camera-interaction-layer')).toHaveClass('is-hidden')
    expect(screen.queryByText('Scanning for a QR code', { selector: ':not(.visually-hidden)' })).not.toBeInTheDocument()
    expect(document.querySelector('.scanner-panel')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Start Camera' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Scanning for a QR code')

    act(() => retry.track.end())
    expect(screen.getByRole('status')).toHaveTextContent('No camera is available')
    expect(screen.getByRole('button', { name: 'Camera unavailable' })).toBeDisabled()
    expect(getUserMedia).toHaveBeenCalledTimes(2)
  })

  it('auto-reports a missing camera API with a disabled unavailable control', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    render(<App workerFactory={() => new FakeWorker() as unknown as Worker} />)
    expect(await screen.findByRole('status')).toHaveTextContent('No camera is available')

    expect(screen.getByRole('button', { name: 'Camera unavailable' })).toBeDisabled()
    expect(document.querySelector('.camera-action-notice')).toHaveTextContent('Connect or enable a camera')
  })

  it('runs native full-source detection alongside ZXing while capturing tracking pixels', async () => {
    const camera = setupCamera()
    const worker = new FakeWorker()
    const workerFactory = vi.fn(() => worker as unknown as Worker)
    const nativeDetector: NativeBarcodeDetector = {
      detect: vi.fn().mockResolvedValue([{
        rawValue: 'Mike',
        cornerPoints: [
          { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 },
        ],
      }]),
    }
    render(<App
      workerFactory={workerFactory}
      nativeDetectorFactory={() => nativeDetector}
    />)
    const video = screen.getByLabelText('Mirrored live camera preview')
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 2 },
      videoHeight: { configurable: true, value: 2 },
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
    })

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Scanning for a QR code'))
    act(() => camera.callbacks.shift()?.(performance.now() + 200))
    const request = worker.postMessage.mock.calls[0][0] as DecodeRequest
    act(() => worker.respond({
      type: 'result',
      id: request.id,
      generation: request.generation,
      detections: [{
        data: 'Mike',
        location: {
          topLeftCorner: { x: 0, y: 0 }, topRightCorner: { x: 2, y: 0 },
          bottomRightCorner: { x: 2, y: 2 }, bottomLeftCorner: { x: 0, y: 2 },
        },
      }],
      elapsedMs: 5,
    }))

    expect(screen.getByTestId('camera-interaction-layer')).toHaveClass('is-hidden')
    expect(nativeDetector.detect).toHaveBeenCalledWith(video)
    expect(camera.context.getImageData).toHaveBeenCalled()
    expect(workerFactory).toHaveBeenCalledOnce()
  })

  it('supplies full 1920×1080 source pixels to native and ZXing on the same cycle', async () => {
    const camera = setupCamera()
    const worker = new FakeWorker()
    const detect = vi.fn().mockResolvedValue([])
    render(<App
      workerFactory={() => worker as unknown as Worker}
      nativeDetectorFactory={() => ({ detect })}
    />)
    const video = screen.getByLabelText('Mirrored live camera preview')
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 1920 },
      videoHeight: { configurable: true, value: 1080 },
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
    })

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Scanning for a QR code'))
    act(() => camera.callbacks.shift()?.(performance.now() + 400))
    const request = worker.postMessage.mock.calls[0][0] as DecodeRequest

    expect(detect).toHaveBeenCalledWith(video)
    expect(request).toMatchObject({
      type: 'decode',
      width: 1920,
      height: 1080,
    })
    if (request.type === 'decode') expect(request.pixels.byteLength).toBe(1920 * 1080 * 4)
    expect(camera.context.drawImage).toHaveBeenCalledWith(video, 0, 0, 1920, 1080)
  })

  it('does not let an ordinary empty ZXing result suppress a native result', async () => {
    const camera = setupCamera()
    const worker = new FakeWorker()
    const nativeDetection = {
      rawValue: 'native-long-range',
      cornerPoints: [
        { x: 100, y: 100 }, { x: 140, y: 100 },
        { x: 140, y: 140 }, { x: 100, y: 140 },
      ],
    }
    render(<App
      workerFactory={() => worker as unknown as Worker}
      nativeDetectorFactory={() => ({ detect: vi.fn().mockResolvedValue([nativeDetection]) })}
    />)
    const video = screen.getByLabelText('Mirrored live camera preview')
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 1920 },
      videoHeight: { configurable: true, value: 1080 },
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
    })

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Scanning for a QR code'))
    act(() => camera.callbacks.shift()?.(performance.now() + 400))
    const request = worker.postMessage.mock.calls[0][0] as DecodeRequest
    act(() => worker.respond({
      type: 'result',
      id: request.id,
      generation: request.generation,
      detections: [],
      elapsedMs: 3,
    }))

    expect(screen.getByTestId('camera-interaction-layer')).toHaveClass('is-hidden')
  })

  it('keeps lower-resolution tracking running while decode is pending without a queue', async () => {
    const camera = setupCamera()
    const worker = new FakeWorker()
    render(<App
      workerFactory={() => worker as unknown as Worker}
      nativeDetectorFactory={() => ({ detect: vi.fn().mockResolvedValue([]) })}
    />)
    const video = screen.getByLabelText('Mirrored live camera preview')
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 1920 },
      videoHeight: { configurable: true, value: 1080 },
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
    })

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Scanning for a QR code'))
    act(() => camera.callbacks.shift()?.(performance.now() + 400))
    const request = worker.postMessage.mock.calls[0][0] as DecodeRequest
    expect(camera.context.drawImage).toHaveBeenCalledTimes(2)

    act(() => camera.callbacks.shift()?.(performance.now() + 500))
    expect(camera.context.drawImage).toHaveBeenCalledTimes(3)
    expect(camera.context.drawImage).toHaveBeenCalledWith(video, 0, 0, 640, 360)

    act(() => worker.respond({
      type: 'result',
      id: request.id,
      generation: request.generation,
      detections: [],
      elapsedMs: 3,
    }))
    act(() => camera.callbacks.shift()?.(performance.now() + 510))
    expect(camera.context.drawImage).toHaveBeenCalledWith(video, 0, 0, 640, 360)
  })

  it('registers the first decode to its source frame, replays it, and never queues optical frames', async () => {
    const camera = setupCamera()
    const decoder = new FakeWorker()
    const optical = new FakeOpticalWorker()
    render(<App
      workerFactory={() => decoder as unknown as Worker}
      openCvWorkerFactory={() => optical as unknown as Worker}
      nativeDetectorFactory={() => null}
    />)
    const video = screen.getByLabelText('Mirrored live camera preview')
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 1920 },
      videoHeight: { configurable: true, value: 1080 },
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
    })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Scanning for a QR code'))
    await act(async () => undefined)

    const decodeCapturedAt = performance.now() + 400
    act(() => camera.callbacks.shift()?.(decodeCapturedAt))
    const decode = decoder.postMessage.mock.calls[0][0] as DecodeRequest
    await act(async () => decoder.respond({
      type: 'result',
      id: decode.id,
      generation: decode.generation,
      detections: [{
        data: 'first-anchor',
        location: {
          topLeftCorner: { x: 960, y: 540 }, topRightCorner: { x: 1_080, y: 540 },
          bottomRightCorner: { x: 1_080, y: 660 }, bottomLeftCorner: { x: 960, y: 660 },
        },
      }],
      elapsedMs: 5,
    }))

    act(() => camera.callbacks.shift()?.(performance.now() + 500))
    const reanchor = optical.postMessage.mock.calls
      .map(([request]) => request as OpticalFlowRequest)
      .find((request) => request.type === 'reanchor')
    if (!reanchor || reanchor.type !== 'reanchor') throw new Error('expected optical reanchor')
    expect(reanchor).toMatchObject({
      type: 'reanchor',
      anchors: [{
        detection: {
          data: 'first-anchor',
          location: {
            topLeftCorner: { x: 320, y: 180 },
            topRightCorner: { x: 360, y: 180 },
          },
        },
        anchoredAt: decodeCapturedAt,
        frames: expect.arrayContaining([
          expect.objectContaining({ capturedAt: decodeCapturedAt, width: 640, height: 360 }),
        ]),
      }],
    })
    act(() => camera.callbacks.shift()?.(performance.now() + 600))
    expect(optical.postMessage.mock.calls.filter(([request]) => request.type === 'reanchor'))
      .toHaveLength(1)
    act(() => optical.respond({
      type: 'result',
      id: reanchor.id,
      generation: reanchor.generation,
      observations: [],
      elapsedMs: 4,
      diagnostics: { accepted: 0, rejected: 0, rejectionReasons: [] },
    }))
    act(() => camera.callbacks.shift()?.(performance.now() + 700))
    expect(optical.postMessage.mock.calls.filter(([request]) => request.type === 'frame'))
      .toHaveLength(1)
  })

  it('reports negotiated camera settings, optional tuning, and opt-in zoom', async () => {
    const camera = setupCamera()
    const applyConstraints = vi.fn().mockResolvedValue(undefined)
    Object.assign(camera.track, {
      getCapabilities: () => ({
        focusMode: ['continuous'],
        exposureMode: ['continuous'],
        whiteBalanceMode: ['manual'],
        zoom: { min: 1, max: 3, step: .1 },
      }),
      getSettings: () => ({
        width: 1920,
        height: 1080,
        frameRate: 60,
        focusMode: 'continuous',
        exposureMode: 'continuous',
        whiteBalanceMode: 'manual',
        zoom: 1,
      }),
      applyConstraints,
    })
    let now = 1_000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    render(<App nativeDetectorFactory={() => ({ detect: vi.fn().mockResolvedValue([]) })} />)
    const video = screen.getByLabelText('Mirrored live camera preview')
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 1920 },
      videoHeight: { configurable: true, value: 1080 },
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
    })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Scanning for a QR code'))
    now = 2_100
    await act(async () => camera.callbacks.shift()?.(now))

    expect(applyConstraints).toHaveBeenCalledWith({
      advanced: [{ focusMode: 'continuous' }, { exposureMode: 'continuous' }],
    })
    expect(screen.getByLabelText('Scanner diagnostics')).toHaveTextContent(
      '1920×1080 @ 60 fps',
    )
    expect(screen.getByLabelText('Scanner diagnostics')).toHaveTextContent(
      'white balance unsupported (manual)',
    )
    expect(screen.getByLabelText('Scanner diagnostics')).toHaveTextContent(
      'zoom supported (1×), not applied',
    )
  })

  it('falls back from failed ZXing initialization to native and then jsQR', async () => {
    const camera = setupCamera()
    let rejectDetection: ((error: Error) => void) | undefined
    const nativeDetector: NativeBarcodeDetector = {
      detect: vi.fn((): Promise<never> => new Promise((_, reject) => {
        rejectDetection = reject
      })),
    }
    class FailingWorker extends FakeWorker {
      override postMessage = vi.fn((request: DecodeRequest) => {
        if (request.type === 'init') queueMicrotask(() => this.respond({
          type: 'error',
          id: request.id,
          generation: request.generation,
          phase: 'initialization',
          message: 'WASM unavailable',
        }))
      })
    }
    const workerFactory = vi.fn(() => new FailingWorker() as unknown as Worker)
    const jsQrWorkerFactory = vi.fn(() => new FakeWorker() as unknown as Worker)
    render(<App
      workerFactory={workerFactory}
      jsQrWorkerFactory={jsQrWorkerFactory}
      nativeDetectorFactory={() => nativeDetector}
    />)
    const video = screen.getByLabelText('Mirrored live camera preview')
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 2 },
      videoHeight: { configurable: true, value: 2 },
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
    })

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Scanning for a QR code'))
    await waitFor(() => expect(workerFactory).toHaveBeenCalledOnce())
    act(() => camera.callbacks.shift()?.(performance.now() + 200))
    act(() => camera.callbacks.shift()?.(performance.now() + 400))
    expect(nativeDetector.detect).toHaveBeenCalledOnce()

    act(() => rejectDetection?.(new Error('native detector unavailable')))
    await waitFor(() => expect(jsQrWorkerFactory).toHaveBeenCalledOnce())
    expect(screen.getByRole('status')).toHaveTextContent('Scanning for a QR code')
  })

  it('keeps result UI through a decode miss, pauses actions, and expires at the bridge TTL', async () => {
    const camera = setupCamera()
    let now = 1_000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const payload = (playerId: number, name: string) =>
      JSON.stringify({ v: 1, kind: 'player', playerId, name })
    const visible = [
      {
        rawValue: payload(1001, 'White'),
        cornerPoints: [
          { x: 340, y: 30 }, { x: 360, y: 30 },
          { x: 360, y: 50 }, { x: 340, y: 50 },
        ],
      },
      {
        rawValue: payload(1000, 'Black'),
        cornerPoints: [
          { x: 40, y: 220 }, { x: 60, y: 220 },
          { x: 60, y: 240 }, { x: 40, y: 240 },
        ],
      },
    ]
    let detections = visible
    const finalizeGame = vi.fn()
    const game = {
      id: 1, tableNumber: 1, createdAt: '2026-01-01T00:00:00.000Z',
      finishedAt: null, result: null, blackPlayerId: 1000, whitePlayerId: 1001,
      blackPlayer: { id: 1000, name: 'Black', rating: 700 },
      whitePlayer: { id: 1001, name: 'White', rating: 700 },
    }
    render(<App
      nativeDetectorFactory={() => ({ detect: vi.fn(async () => detections) })}
      fetchGames={vi.fn().mockResolvedValue({ games: [game], recentGames: [] })}
      finalizeGame={finalizeGame}
      gamesPollIntervalMs={60_000}
    />)
    const video = screen.getByLabelText('Mirrored live camera preview')
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 400 },
      videoHeight: { configurable: true, value: 300 },
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
    })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Scanning for a QR code'))
    for (let index = 0; index < 4; index += 1) {
      now += 100
      await act(async () => camera.callbacks.shift()?.(now))
    }
    const resultGroup = screen.getByRole('group', { name: 'Report result for Table 1' })
    expect(screen.getByTestId('camera-interaction-layer')).toHaveClass('is-visible')
    const winnerZone = screen.getByRole('group', { name: 'White, left lane, choose winner' })
    const progressBeforeGap = Number(
      within(winnerZone).getByRole('progressbar').getAttribute('aria-valuenow'),
    )
    expect(progressBeforeGap).toBeGreaterThan(0)

    detections = []
    now += 200
    await act(async () => camera.callbacks.shift()?.(now))
    expect(screen.getByRole('group', { name: 'Report result for Table 1' })).toBe(resultGroup)
    expect(screen.getByRole('group', { name: 'White, left lane, choose winner' })).toBe(winnerZone)
    expect(screen.queryByText('Reacquiring… actions paused')).not.toBeInTheDocument()
    expect(winnerZone).toHaveClass('status-holding')
    expect(Number(within(winnerZone).getByRole('progressbar').getAttribute('aria-valuenow')))
      .toBeGreaterThanOrEqual(progressBeforeGap)
    expect(finalizeGame).not.toHaveBeenCalled()

    detections = visible
    now += 100
    await act(async () => camera.callbacks.shift()?.(now))
    now += 100
    await act(async () => camera.callbacks.shift()?.(now))
    expect(screen.queryByText('Reacquiring… actions paused')).not.toBeInTheDocument()
    const reacquiredWinner = screen.getByRole('group', {
      name: 'White, left lane, choose winner',
    })
    expect(reacquiredWinner).toHaveClass('status-holding')
    expect(Number(within(reacquiredWinner).getByRole('progressbar')
      .getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(progressBeforeGap)

    detections = []
    now += 1_700
    await act(async () => camera.callbacks.shift()?.(now))
    expect(screen.queryByRole('group', { name: 'Report result for Table 1' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Game context for Table 1' })).not.toBeInTheDocument()
    expect(screen.getByTestId('camera-interaction-layer')).toHaveClass('is-hidden')
    expect(finalizeGame).not.toHaveBeenCalled()
  })

  it('reveals dual-player result targets, suppresses check-in, and submits once after the hold', async () => {
    const camera = setupCamera()
    let now = 1_000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const payload = (playerId: number, name: string) =>
      JSON.stringify({ v: 1, kind: 'player', playerId, name })
    let detections = [
        {
          rawValue: payload(1001, 'White'),
          cornerPoints: [
            { x: 340, y: 30 }, { x: 360, y: 30 },
            { x: 360, y: 50 }, { x: 340, y: 50 },
          ],
        },
        {
          rawValue: payload(1000, 'Black'),
          cornerPoints: [
            { x: 40, y: 220 }, { x: 60, y: 220 },
            { x: 60, y: 240 }, { x: 40, y: 240 },
          ],
        },
      ]
    const nativeDetector: NativeBarcodeDetector = {
      detect: vi.fn(async () => detections),
    }
    const game = {
      id: 1, tableNumber: 1, createdAt: '2026-01-01T00:00:00.000Z',
      finishedAt: null, result: null, blackPlayerId: 1000, whitePlayerId: 1001,
      blackPlayer: { id: 1000, name: 'Black', rating: 700 },
      whitePlayer: { id: 1001, name: 'White', rating: 700 },
    }
    const checkInPlayer = vi.fn().mockResolvedValue({
      status: 'waiting',
      side: 'white',
      game: { ...game, id: 2, tableNumber: 2, blackPlayerId: null, blackPlayer: null },
    })
    let currentGames = [game]
    const finalizeGame = vi.fn().mockImplementation(async () => {
      currentGames = []
    })
    render(<App
      nativeDetectorFactory={() => nativeDetector}
      fetchGames={vi.fn(async () => ({ games: currentGames, recentGames: [] }))}
      checkInPlayer={checkInPlayer}
      finalizeGame={finalizeGame}
      gamesPollIntervalMs={60_000}
    />)
    const video = screen.getByLabelText('Mirrored live camera preview')
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 400 },
      videoHeight: { configurable: true, value: 300 },
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
    })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Scanning for a QR code'))

    for (let index = 0; index < 2; index += 1) {
      now += 100
      await act(async () => camera.callbacks.shift()?.(now))
    }

    expect(screen.getByRole('group', { name: 'Report result for Table 1' })).toBeInTheDocument()
    expect(screen.getAllByText('Win')).toHaveLength(2)
    expect(screen.getAllByText('Draw')).toHaveLength(2)
    expect(screen.getAllByText('Lose')).toHaveLength(2)
    const compactWinner = screen.getByRole('group', {
      name: 'White, left lane, choose winner',
    })
    expect(compactWinner).toHaveClass('result-zone-compact')
    expect(within(compactWinner).getByText('White: hold QR here'))
      .toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('group', { name: 'Black, right lane, choose loser' })).toBeInTheDocument()
    for (let index = 0; index < 21; index += 1) {
      now += 100
      await act(async () => camera.callbacks.shift()?.(now))
    }
    await waitFor(() => expect(finalizeGame).toHaveBeenCalledWith(
      1, '1-0', expect.any(AbortSignal),
    ))
    expect(finalizeGame).toHaveBeenCalledTimes(1)
    expect(checkInPlayer).not.toHaveBeenCalled()
    expect(await screen.findByText('Result 1-0 recorded. Ratings updated.')).toBeInTheDocument()
    for (let index = 0; index < 23; index += 1) {
      now += 100
      await act(async () => camera.callbacks.shift()?.(now))
    }
    expect(finalizeGame).toHaveBeenCalledTimes(1)
    expect(checkInPlayer).not.toHaveBeenCalled()
    expect(screen.getAllByText('Move QR away, then re-enter to check in')).toHaveLength(1)

    detections = []
    for (let index = 0; index < 20; index += 1) {
      now += 100
      await act(async () => camera.callbacks.shift()?.(now))
    }
    detections = [{
      rawValue: payload(1001, 'White'),
      cornerPoints: [
        { x: 340, y: 130 }, { x: 360, y: 130 },
        { x: 360, y: 150 }, { x: 340, y: 150 },
      ],
    }]
    for (let index = 0; index < 23; index += 1) {
      now += 100
      await act(async () => camera.callbacks.shift()?.(now))
    }
    await waitFor(() => expect(checkInPlayer).toHaveBeenCalledTimes(1))
  })

  it('keeps two asynchronously resolved compact identities distinct and submits Draw + Draw', async () => {
    const camera = setupCamera()
    let now = 1_000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const resolvers = new Map<number, (player: {
      v: 1; kind: 'player'; playerId: number; name: string
    }) => void>()
    const resolvePlayer = vi.fn((playerId: number) => new Promise<{
      v: 1; kind: 'player'; playerId: number; name: string
    }>((resolve) => resolvers.set(playerId, resolve)))
    const detections = [
      {
        rawValue: 'SC1:RT',
        cornerPoints: [
          { x: 340, y: 130 }, { x: 360, y: 130 },
          { x: 360, y: 150 }, { x: 340, y: 150 },
        ],
      },
      {
        rawValue: 'SC1:RS',
        cornerPoints: [
          { x: 40, y: 130 }, { x: 60, y: 130 },
          { x: 60, y: 150 }, { x: 40, y: 150 },
        ],
      },
    ]
    const game = {
      id: 1, tableNumber: 1, createdAt: '2026-01-01T00:00:00.000Z',
      finishedAt: null, result: null, blackPlayerId: 1000, whitePlayerId: 1001,
      blackPlayer: { id: 1000, name: 'Black', rating: 700 },
      whitePlayer: { id: 1001, name: 'White', rating: 700 },
    }
    const finalizeGame = vi.fn().mockResolvedValue(undefined)
    render(<App
      nativeDetectorFactory={() => ({ detect: vi.fn(async () => detections) })}
      resolvePlayer={resolvePlayer}
      finalizeGame={finalizeGame}
      fetchGames={vi.fn().mockResolvedValue({ games: [game], recentGames: [] })}
      gamesPollIntervalMs={60_000}
    />)
    const video = screen.getByLabelText('Mirrored live camera preview')
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 400 },
      videoHeight: { configurable: true, value: 300 },
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
    })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Scanning'))
    for (let index = 0; index < 2; index += 1) {
      now += 100
      await act(async () => camera.callbacks.shift()?.(now))
    }
    expect(resolvePlayer.mock.calls.map(([id]) => id).sort()).toEqual([1000, 1001])
    await act(async () => resolvers.get(1001)?.({
      v: 1, kind: 'player', playerId: 1001, name: 'White',
    }))
    now += 100
    await act(async () => camera.callbacks.shift()?.(now))
    await act(async () => resolvers.get(1000)?.({
      v: 1, kind: 'player', playerId: 1000, name: 'Black',
    }))
    for (let index = 0; index < 23; index += 1) {
      now += 100
      await act(async () => camera.callbacks.shift()?.(now))
    }
    await waitFor(() => expect(finalizeGame).toHaveBeenCalledWith(
      1, '1/2-1/2', expect.any(AbortSignal),
    ))
    expect(resolvePlayer).toHaveBeenCalledTimes(2)
  })

  it('blocks more than two player codes and shows same-choice conflict without advancing', async () => {
    const camera = setupCamera()
    let now = 1_000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const payload = (playerId: number, name: string) =>
      JSON.stringify({ v: 1, kind: 'player', playerId, name })
    const barcode = (playerId: number, name: string, x: number, y: number) => ({
      rawValue: payload(playerId, name),
      cornerPoints: [
        { x, y }, { x: x + 20, y },
        { x: x + 20, y: y + 20 }, { x, y: y + 20 },
      ],
    })
    let detections = [
      barcode(1000, 'Black', 40, 30),
      barcode(1001, 'White', 340, 30),
      barcode(1002, 'Extra', 190, 140),
    ]
    const nativeDetector: NativeBarcodeDetector = {
      detect: vi.fn(async () => detections),
    }
    const game = {
      id: 1, tableNumber: 1, createdAt: '2026-01-01T00:00:00.000Z',
      finishedAt: null, result: null, blackPlayerId: 1000, whitePlayerId: 1001,
      blackPlayer: { id: 1000, name: 'Black', rating: 700 },
      whitePlayer: { id: 1001, name: 'White', rating: 700 },
    }
    const finalizeGame = vi.fn()
    const checkInPlayer = vi.fn()
    render(<App
      nativeDetectorFactory={() => nativeDetector}
      fetchGames={vi.fn().mockResolvedValue({ games: [game], recentGames: [] })}
      checkInPlayer={checkInPlayer}
      finalizeGame={finalizeGame}
      gamesPollIntervalMs={60_000}
    />)
    const video = screen.getByLabelText('Mirrored live camera preview')
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 400 },
      videoHeight: { configurable: true, value: 300 },
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
    })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Scanning for a QR code'))
    for (let index = 0; index < 2; index += 1) {
      now += 100
      await act(async () => camera.callbacks.shift()?.(now))
    }
    expect(screen.getByText('Too many player codes — show no more than two')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Player check-in action zones' })).not.toBeInTheDocument()

    detections = detections.slice(0, 2)
    for (let index = 0; index < 9; index += 1) {
      now += 100
      await act(async () => camera.callbacks.shift()?.(now))
    }
    expect(screen.getByText('Result conflict — choose Win + Lose or Draw + Draw')).toBeInTheDocument()
    expect(screen.getAllByRole('progressbar').every((element) =>
      element.getAttribute('aria-valuenow') === '0')).toBe(true)
    expect(finalizeGame).not.toHaveBeenCalled()
    expect(checkInPlayer).not.toHaveBeenCalled()
  })

  it('renders player-friendly and raw overlays, ignores stale worker results, and has no result panel', async () => {
    const camera = setupCamera()
    const workers: FakeWorker[] = []
    render(<App workerFactory={() => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker as unknown as Worker
    }} />)
    const video = screen.getByLabelText('Mirrored live camera preview')
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 2 },
      videoHeight: { configurable: true, value: 2 },
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
    })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Scanning for a QR code'))
    await waitFor(() => expect(camera.callbacks).toHaveLength(1))
    act(() => camera.callbacks.shift()?.(performance.now() + 200))
    const request = workers[0].postMessage.mock.calls[0][0] as DecodeRequest
    const location = {
      topLeftCorner: { x: 0, y: 0 }, topRightCorner: { x: 2, y: 0 },
      bottomRightCorner: { x: 2, y: 2 }, bottomLeftCorner: { x: 0, y: 2 },
    }
    act(() => workers[0].respond({
      type: 'result', id: request.id, generation: request.generation,
      detection: { data: '{"v":1,"kind":"player","playerId":1234,"name":"Ada"}', location },
    }))
    expect(await screen.findByText('Ada · #1234')).toBeInTheDocument()
    expect(screen.getByTestId('camera-interaction-layer')).toHaveClass('is-visible')
    expect(screen.queryByText('Detected payload')).not.toBeInTheDocument()
    Object.defineProperties(video, {
      clientWidth: { configurable: true, value: 240 },
      clientHeight: { configurable: true, value: 180 },
    })
    const preview = video.closest('.fullscreen-camera-overlay') as HTMLElement
    Object.defineProperties(preview, {
      clientWidth: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 650 },
    })
    act(() => resizeCallbacks[0]([], {} as ResizeObserver))
    expect(camera.context.clearRect).toHaveBeenLastCalledWith(0, 0, 1000, 650)

    act(() => camera.callbacks.shift()?.(performance.now() + 400))
    if (workers[0].postMessage.mock.calls.length < 2) {
      act(() => camera.callbacks.shift()?.(performance.now() + 450))
    }
    const rawRequest = workers[0].postMessage.mock.calls[1][0] as DecodeRequest
    const rawPayload = `<b>${'raw & safe '.repeat(10)}</b>`
    act(() => workers[0].respond({
      type: 'result', id: rawRequest.id, generation: rawRequest.generation,
      detection: { data: rawPayload, location },
    }))
    expect(screen.queryByText('raw & safe')).not.toBeInTheDocument()
    expect(screen.queryByText(`Detected QR code: ${rawPayload}`)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Stop Camera' }))
    act(() => workers[0].respond({
      type: 'result', id: request.id, generation: request.generation,
      detection: { data: 'stale', location },
    }))
    expect(screen.queryByText('stale')).not.toBeInTheDocument()
  })

  it('dedupes compact-reference lookup, caches it, and enters the normal check-in flow', async () => {
    const camera = setupCamera()
    let now = 1_000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    let resolveLookup: ((player: {
      v: 1; kind: 'player'; playerId: number; name: string
    }) => void) | undefined
    const resolvePlayer = vi.fn(() => new Promise<{
      v: 1; kind: 'player'; playerId: number; name: string
    }>((resolve) => { resolveLookup = resolve }))
    const checkInPlayer = vi.fn().mockResolvedValue({
      status: 'waiting',
      side: 'white',
      game: {
        id: 1, tableNumber: 1, createdAt: '2026-01-01T00:00:00.000Z',
        finishedAt: null, result: null, blackPlayerId: null, whitePlayerId: 1234,
        blackPlayer: null, whitePlayer: { id: 1234, name: 'Ada', rating: 700 },
      },
    })
    const detection = {
      rawValue: 'SC1:YA',
      cornerPoints: [
        { x: 340, y: 30 }, { x: 360, y: 30 },
        { x: 360, y: 50 }, { x: 340, y: 50 },
      ],
    }
    render(<App
      nativeDetectorFactory={() => ({ detect: vi.fn().mockResolvedValue([detection]) })}
      resolvePlayer={resolvePlayer}
      checkInPlayer={checkInPlayer}
      fetchGames={vi.fn().mockResolvedValue([])}
      gamesPollIntervalMs={60_000}
    />)
    const video = screen.getByLabelText('Mirrored live camera preview')
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 400 },
      videoHeight: { configurable: true, value: 300 },
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
    })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Scanning'))
    for (let index = 0; index < 3; index += 1) {
      now += 100
      await act(async () => camera.callbacks.shift()?.(now))
    }
    expect(resolvePlayer).toHaveBeenCalledTimes(1)
    await act(async () => resolveLookup?.({
      v: 1, kind: 'player', playerId: 1234, name: 'Ada',
    }))
    for (let index = 0; index < 23; index += 1) {
      now += 100
      await act(async () => camera.callbacks.shift()?.(now))
    }
    await waitFor(() => expect(checkInPlayer).toHaveBeenCalledTimes(1))
    expect(checkInPlayer).toHaveBeenCalledWith(
      { v: 1, kind: 'player', playerId: 1234, name: 'Ada' },
      expect.any(AbortSignal),
    )
    expect(resolvePlayer).toHaveBeenCalledTimes(1)
  })

  it('aborts stale compact lookups and reports unresolved references without a fake player', async () => {
    const camera = setupCamera()
    let signal: AbortSignal | undefined
    const resolvePlayer = vi.fn((_id: number, nextSignal: AbortSignal) => {
      signal = nextSignal
      return new Promise<never>(() => undefined)
    })
    const view = render(<App
      nativeDetectorFactory={() => ({ detect: vi.fn().mockResolvedValue([{
        rawValue: 'SC1:YA',
        cornerPoints: [
          { x: 340, y: 30 }, { x: 360, y: 30 },
          { x: 360, y: 50 }, { x: 340, y: 50 },
        ],
      }]) })}
      resolvePlayer={resolvePlayer}
      fetchGames={vi.fn().mockResolvedValue([])}
      gamesPollIntervalMs={60_000}
    />)
    const video = screen.getByLabelText('Mirrored live camera preview')
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 400 },
      videoHeight: { configurable: true, value: 300 },
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
    })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Scanning'))
    await act(async () => camera.callbacks.shift()?.(performance.now() + 100))
    await act(async () => camera.callbacks.shift()?.(performance.now() + 200))
    expect(resolvePlayer).toHaveBeenCalledOnce()
    view.unmount()
    expect(signal?.aborted).toBe(true)

    const secondCamera = setupCamera()
    render(<App
      nativeDetectorFactory={() => ({ detect: vi.fn().mockResolvedValue([{
        rawValue: 'SC1:YA',
        cornerPoints: [
          { x: 340, y: 30 }, { x: 360, y: 30 },
          { x: 360, y: 50 }, { x: 340, y: 50 },
        ],
      }]) })}
      resolvePlayer={vi.fn().mockRejectedValue(new Error('Player 1234 was not found.'))}
      fetchGames={vi.fn().mockResolvedValue([])}
      gamesPollIntervalMs={60_000}
    />)
    const secondVideo = screen.getByLabelText('Mirrored live camera preview')
    Object.defineProperties(secondVideo, {
      videoWidth: { configurable: true, value: 400 },
      videoHeight: { configurable: true, value: 300 },
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
    })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Scanning'))
    await act(async () => secondCamera.callbacks.shift()?.(performance.now() + 200))
    await act(async () => secondCamera.callbacks.shift()?.(performance.now() + 300))
    expect(await screen.findByText(
      'Player #1234 could not be resolved. Player 1234 was not found.',
    )).toBeInTheDocument()
    expect(screen.queryByText('hold QR here')).not.toBeInTheDocument()
  })

  it('retries retryable compact lookup failures with bounded cooldown and recovers', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    const camera = setupCamera()
    let now = 1_000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const resolvePlayer = vi.fn()
      .mockRejectedValueOnce(new Error('Network unavailable.'))
      .mockRejectedValueOnce(new Error('Server unavailable.'))
      .mockResolvedValue({
        v: 1 as const, kind: 'player' as const, playerId: 1234, name: 'Ada',
      })
    render(<App
      nativeDetectorFactory={() => ({ detect: vi.fn().mockResolvedValue([{
        rawValue: 'SC1:YA',
        cornerPoints: [
          { x: 340, y: 30 }, { x: 360, y: 30 },
          { x: 360, y: 50 }, { x: 340, y: 50 },
        ],
      }]) })}
      resolvePlayer={resolvePlayer}
      fetchGames={vi.fn().mockResolvedValue([])}
      gamesPollIntervalMs={60_000}
    />)
    const video = screen.getByLabelText('Mirrored live camera preview')
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 400 },
      videoHeight: { configurable: true, value: 300 },
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
    })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Scanning'))
    for (let index = 0; index < 3; index += 1) {
      now += 100
      await act(async () => camera.callbacks.shift()?.(now))
    }
    await waitFor(() => expect(resolvePlayer).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(
      'Player #1234 could not be resolved. Network unavailable.',
    )).toBeInTheDocument()

    vi.setSystemTime(new Date(Date.now() + PLAYER_LOOKUP_RETRY_BASE_MS - 1))
    now += 200
    await act(async () => camera.callbacks.shift()?.(now))
    expect(resolvePlayer).toHaveBeenCalledTimes(1)
    vi.setSystemTime(new Date(Date.now() + 1))
    now += 200
    await act(async () => camera.callbacks.shift()?.(now))
    await waitFor(() => expect(resolvePlayer).toHaveBeenCalledTimes(2))

    vi.setSystemTime(new Date(Date.now() + (PLAYER_LOOKUP_RETRY_BASE_MS * 2) - 1))
    now += 200
    await act(async () => camera.callbacks.shift()?.(now))
    expect(resolvePlayer).toHaveBeenCalledTimes(2)
    vi.setSystemTime(new Date(Date.now() + 1))
    now += 200
    await act(async () => camera.callbacks.shift()?.(now))
    await waitFor(() => expect(resolvePlayer).toHaveBeenCalledTimes(3))
    expect(await screen.findByText('Ada · #1234')).toBeInTheDocument()
    expect(screen.queryByText(/could not be resolved/)).not.toBeInTheDocument()
  })

  it('checks a held player QR in once and then shows its centered game context', async () => {
    const camera = setupCamera()
    const worker = new FakeWorker()
    let now = 10_000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const checkedInGame = {
      id: 1,
      tableNumber: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      finishedAt: null,
      result: null,
      blackPlayerId: null,
      whitePlayerId: 1234,
      blackPlayer: null,
      whitePlayer: { id: 1234, name: 'Ada', rating: 700 },
    }
    const otherGame = {
      ...checkedInGame,
      id: 2,
      tableNumber: 2,
      whitePlayerId: 1444,
      whitePlayer: { id: 1444, name: 'Grace', rating: 700 },
    }
    const checkInPlayer = vi.fn().mockResolvedValue({
      status: 'waiting',
      side: 'white',
      game: checkedInGame,
    })
    let resolveRefresh: ((games: typeof checkedInGame[]) => void) | undefined
    const fetchGames = vi.fn()
      .mockResolvedValueOnce([otherGame])
      .mockImplementationOnce(() => new Promise<typeof checkedInGame[]>((resolve) => {
        resolveRefresh = resolve
      }))
      .mockResolvedValue([otherGame, checkedInGame])
    render(<App
      workerFactory={() => worker as unknown as Worker}
      checkInPlayer={checkInPlayer}
      fetchGames={fetchGames}
      gamesPollIntervalMs={60_000}
    />)
    const video = screen.getByLabelText('Mirrored live camera preview')
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 400 },
      videoHeight: { configurable: true, value: 300 },
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
    })
    const location = {
      topLeftCorner: { x: 340, y: 30 }, topRightCorner: { x: 360, y: 30 },
      bottomRightCorner: { x: 360, y: 50 }, bottomLeftCorner: { x: 340, y: 50 },
    }
    const payload = '{"v":1,"kind":"player","playerId":1234,"name":"Ada"}'
    const scanDetection = async (time: number, detection: QrDetection | null) => {
      now = time
      act(() => camera.callbacks.shift()?.(time))
      const nextRequest = worker.postMessage.mock.calls.at(-1)?.[0] as DecodeRequest
      await act(async () => worker.respond({
        type: 'result', id: nextRequest.id, generation: nextRequest.generation, detection,
      }))
    }
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Scanning for a QR code'))
    for (let time = 10_150; time <= 12_450; time += 150) {
      await scanDetection(time, { data: payload, location })
    }
    expect(await screen.findByText('Waiting for an opponent at Table 1')).toBeInTheDocument()
    expect(checkInPlayer).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(fetchGames).toHaveBeenCalledTimes(2))
    const ongoingGames = screen.getByRole('region', { name: 'Ongoing games', hidden: true })
    let cards = within(ongoingGames).getAllByRole('article', { name: /Table \d:/, hidden: true })
    expect(cards.map((card) => card.getAttribute('data-game-id'))).toEqual(['1', '2'])
    expect(cards[0]).toHaveClass('featured-game')

    await act(async () => resolveRefresh?.([otherGame, checkedInGame]))
    cards = within(ongoingGames).getAllByRole('article', { name: /Table \d:/, hidden: true })
    expect(cards.map((card) => card.getAttribute('data-game-id'))).toEqual(['1', '2'])
    await scanDetection(12_600, { data: payload, location })
    expect(checkInPlayer).toHaveBeenCalledTimes(1)

    for (let time = 12_750; time <= 15_050; time += 150) {
      await scanDetection(time, { data: payload, location })
    }
    expect(checkInPlayer).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('group', { name: 'Game context for Table 1' })).toBeInTheDocument()
    expect(screen.getByText('Waiting for an opponent')).toBeInTheDocument()
    expect(screen.getByText('Waiting for an opponent')).toHaveClass('game-waiting-header')
    const resultOptions = screen.getByRole('group', { name: 'Result options for Table 1' })
    const disabledChoices = within(resultOptions).getAllByRole('group')
    expect(disabledChoices).toHaveLength(6)
    expect(disabledChoices.every((zone) => zone.getAttribute('aria-disabled') === 'true')).toBe(true)
    const stageCard = within(screen.getByRole('group', { name: 'Game context for Table 1' }))
      .getByRole('article')
    expect(stageCard).toHaveClass('stage-game-card')
    expect(stageCard).toHaveStyle({ width: 'clamp(150px, 30vw, 280px)', height: 'auto' })
  })

  it('defers check-in completion until the overlay hides and highlights the promoted card', async () => {
    const camera = setupCamera()
    let now = 1_000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const animateDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate')
    const matchMediaDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia')
    const sequence: string[] = []
    const cancel = vi.fn()
    const animate = vi.fn(() => ({
      cancel,
      finished: new Promise<void>(() => undefined),
    }))
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: false })),
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => {
      sequence.push('measure')
      return {
        x: 10, y: 20, left: 10, top: 20, right: 110, bottom: 70, width: 100, height: 50,
        toJSON: () => ({}),
      }
    })
    const nativeDetector: NativeBarcodeDetector = {
      detect: vi.fn().mockResolvedValue([{
        rawValue: '{"v":1,"kind":"player","playerId":1234,"name":"Ada"}',
        cornerPoints: [
          { x: 340, y: 30 }, { x: 360, y: 30 },
          { x: 360, y: 50 }, { x: 340, y: 50 },
        ],
      }]),
    }
    const game = {
      id: 1, tableNumber: 1, createdAt: '2026-01-01T00:00:00.000Z',
      finishedAt: null, result: null,
      blackPlayerId: 1234, whitePlayerId: null,
      blackPlayer: { id: 1234, name: 'Ada', rating: 700 }, whitePlayer: null,
    }
    const otherGame = {
      ...game,
      id: 2,
      tableNumber: 2,
      blackPlayerId: 1444,
      blackPlayer: { id: 1444, name: 'Grace', rating: 700 },
    }
    render(<App
      nativeDetectorFactory={() => nativeDetector}
      checkInPlayer={vi.fn().mockResolvedValue({ status: 'waiting', side: 'black', game })}
      fetchGames={vi.fn().mockResolvedValueOnce([otherGame]).mockResolvedValue([game, otherGame])}
      gamesPollIntervalMs={60_000}
    />)
    const video = screen.getByLabelText('Mirrored live camera preview')
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 400 },
      videoHeight: { configurable: true, value: 300 },
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
    })
    const list = await screen.findByRole('region', { name: 'Ongoing games' })
    let listScrollTop = 180
    Object.defineProperty(list, 'scrollTop', {
      configurable: true,
      get: () => listScrollTop,
      set: (value: number) => {
        listScrollTop = value
        sequence.push(`scroll:${value}`)
      },
    })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Scanning for a QR code'))
    sequence.length = 0
    for (let elapsed = 100; elapsed <= 2_300; elapsed += 100) {
      now = 1_000 + elapsed
      await act(async () => camera.callbacks.shift()?.(now))
    }
    expect(await screen.findByText('Waiting for an opponent at Table 1')).toBeInTheDocument()
    expect(screen.getByTestId('camera-interaction-layer')).toHaveClass('is-visible')
    expect(animate).not.toHaveBeenCalled()
    vi.mocked(nativeDetector.detect).mockResolvedValue([])
    for (let elapsed = 2_400; elapsed <= 5_000; elapsed += 100) {
      now = 1_000 + elapsed
      await act(async () => camera.callbacks.shift()?.(now))
    }
    expect(screen.getByTestId('camera-interaction-layer')).toHaveClass('is-hidden')
    expect(animate).not.toHaveBeenCalled()
    expect(list.scrollTop).toBe(0)
    expect(document.querySelector('.check-in-token')).not.toBeInTheDocument()
    expect(within(list).getByRole('article', { name: /Table 1:/ })).toHaveClass('check-in-arrival')

    await userEvent.click(screen.getByRole('button', { name: 'Stop Camera' }))
    expect(cancel).not.toHaveBeenCalled()
    expect(document.querySelector('.check-in-token')).not.toBeInTheDocument()
    restoreDescriptor(HTMLElement.prototype, 'animate', animateDescriptor)
    restoreDescriptor(window, 'matchMedia', matchMediaDescriptor)
  })

  it('uses auto rail positioning and no travel token for reduced motion', async () => {
    const camera = setupCamera()
    let now = 1_000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const animateDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate')
    const matchMediaDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia')
    const animate = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    })
    const nativeDetector: NativeBarcodeDetector = {
      detect: vi.fn().mockResolvedValue([{
        rawValue: '{"v":1,"kind":"player","playerId":1234,"name":"Ada"}',
        cornerPoints: [
          { x: 340, y: 30 }, { x: 360, y: 30 },
          { x: 360, y: 50 }, { x: 340, y: 50 },
        ],
      }]),
    }
    const game = {
      id: 1, tableNumber: 1, createdAt: '2026-01-01T00:00:00.000Z',
      finishedAt: null, result: null,
      blackPlayerId: null, whitePlayerId: 1234,
      blackPlayer: null, whitePlayer: { id: 1234, name: 'Ada', rating: 700 },
    }
    const otherGame = {
      ...game,
      id: 2,
      tableNumber: 2,
      whitePlayerId: 1444,
      whitePlayer: { id: 1444, name: 'Grace', rating: 700 },
    }
    const fetchGames = vi.fn()
      .mockResolvedValueOnce([otherGame])
      .mockImplementationOnce(() => new Promise<typeof game[]>(() => undefined))
    render(<App
      nativeDetectorFactory={() => nativeDetector}
      checkInPlayer={vi.fn().mockResolvedValue({ status: 'waiting', side: 'white', game })}
      fetchGames={fetchGames}
      gamesPollIntervalMs={60_000}
    />)
    const video = screen.getByLabelText('Mirrored live camera preview')
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 400 },
      videoHeight: { configurable: true, value: 300 },
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
    })
    const list = await screen.findByRole('region', { name: 'Ongoing games' })
    list.scrollTop = 120
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Scanning for a QR code'))
    for (let elapsed = 100; elapsed <= 2_300; elapsed += 100) {
      now = 1_000 + elapsed
      await act(async () => camera.callbacks.shift()?.(now))
    }
    expect(await screen.findByText('Waiting for an opponent at Table 1')).toBeInTheDocument()
    expect(list.scrollTop).toBe(120)
    vi.mocked(nativeDetector.detect).mockResolvedValue([])
    for (let elapsed = 2_400; elapsed <= 5_000; elapsed += 100) {
      now = 1_000 + elapsed
      await act(async () => camera.callbacks.shift()?.(now))
    }
    expect(list.scrollTop).toBe(0)
    expect(animate).not.toHaveBeenCalled()
    expect(document.querySelector('.check-in-token')).not.toBeInTheDocument()
    expect(within(list).getByRole('article', { name: /Table 1:/ })).toHaveClass('check-in-arrival')
    restoreDescriptor(HTMLElement.prototype, 'animate', animateDescriptor)
    restoreDescriptor(window, 'matchMedia', matchMediaDescriptor)
  })

  it('keeps native acquisition alive after a worker error', async () => {
    const camera = setupCamera()
    const worker = new FakeWorker()
    render(<App
      workerFactory={() => worker as unknown as Worker}
      nativeDetectorFactory={() => ({ detect: vi.fn().mockResolvedValue([]) })}
    />)
    const video = screen.getByLabelText('Mirrored live camera preview')
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 2 },
      videoHeight: { configurable: true, value: 2 },
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
    })

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Scanning for a QR code'))
    act(() => camera.callbacks.shift()?.(performance.now() + 200))
    act(() => worker.dispatchEvent(new ErrorEvent('error', { message: 'decoder crashed' })))
    await waitFor(() => expect(worker.terminate).toHaveBeenCalledOnce())
    expect(screen.getByRole('status')).toHaveTextContent('Scanning for a QR code')
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(camera.track.stop).not.toHaveBeenCalled()
  })

  it('handles a worker failure before the first decode exactly once without stopping native', async () => {
    const camera = setupCamera()
    const worker = new FakeWorker()
    render(<App
      workerFactory={() => worker as unknown as Worker}
      nativeDetectorFactory={() => ({ detect: vi.fn().mockResolvedValue([]) })}
    />)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Scanning for a QR code'))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Scanning for a QR code'))

    act(() => {
      worker.dispatchEvent(new ErrorEvent('error', { message: 'startup failure' }))
      worker.dispatchEvent(new ErrorEvent('error', { message: 'duplicate failure' }))
    })
    await waitFor(() => expect(worker.terminate).toHaveBeenCalledOnce())
    expect(screen.getByRole('status')).toHaveTextContent('Scanning for a QR code')
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(camera.track.stop).not.toHaveBeenCalled()
  })

  it('validates, generates, and prints a player card without a download action', async () => {
    setupCamera()
    const qrEncoder = vi.fn().mockResolvedValue('data:image/svg+xml,abc')
    const createPlayer = vi.fn(async (name: string) => ({
      v: 1 as const, kind: 'player' as const, playerId: 1234, name,
    }))
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    render(<App
      workerFactory={() => new FakeWorker() as unknown as Worker}
      qrEncoder={qrEncoder}
      createPlayer={createPlayer}
    />)
    await userEvent.click(screen.getByRole('tab', { name: 'Players' }))
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }))
    expect(screen.getByText('Enter a player name.')).toHaveAttribute('role', 'alert')
    await userEvent.type(screen.getByLabelText('Player name'), ' Ada ')
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }))
    expect(await screen.findByText('Player #1234')).toBeInTheDocument()
    expect(createPlayer).toHaveBeenCalledWith('Ada', expect.any(AbortSignal))
    expect(qrEncoder).toHaveBeenCalledWith('SC1:YA')
    expect(screen.queryByRole('button', { name: 'Download PNG' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Print card' }))
    expect(document.body.dataset.printMode).toBe('card')
    await userEvent.click(screen.getByRole('button', { name: /Print .*sticker/ }))
    expect(document.body.dataset.printMode).toBe('sticker')
    expect(print).toHaveBeenCalledTimes(2)
  })

  it('renders compact QR artwork as Version 1-H SVG with an exact four-module quiet zone', async () => {
    expect(PLAYER_QR_RENDER_OPTIONS).toEqual({
      type: 'svg',
      errorCorrectionLevel: 'H',
      margin: 4,
      color: { dark: '#000000', light: '#ffffff' },
    })
    const uri = await encodeQrDataUrl('SC1:YA')
    expect(uri).toMatch(/^data:image\/svg\+xml/)
    const svg = decodeURIComponent(uri.slice(uri.indexOf(',') + 1))
    expect(svg).toContain('viewBox="0 0 29 29"')
    expect(svg).toContain('shape-rendering="crispEdges"')
    expect(svg).toContain('fill="#ffffff"')
    expect(svg).toContain('stroke="#000000"')
  })

  it('shows no QR when authoritative player persistence fails', async () => {
    setupCamera()
    const qrEncoder = vi.fn()
    render(<App
      workerFactory={() => new FakeWorker() as unknown as Worker}
      createPlayer={vi.fn().mockRejectedValue(new Error('Database unavailable.'))}
      qrEncoder={qrEncoder}
      fetchGames={vi.fn().mockResolvedValue([])}
    />)
    await userEvent.click(screen.getByRole('tab', { name: 'Players' }))
    await userEvent.type(screen.getByLabelText('Player name'), 'Ada')
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }))
    expect(await screen.findByText('Database unavailable.')).toHaveAttribute('role', 'alert')
    expect(screen.queryByLabelText('Generated player QR card')).not.toBeInTheDocument()
    expect(qrEncoder).not.toHaveBeenCalled()
  })

  it('removes a newly persisted player when QR encoding fails', async () => {
    setupCamera()
    const deletePlayer = vi.fn().mockResolvedValue(undefined)
    render(<App
      createPlayer={vi.fn().mockResolvedValue({
        v: 1, kind: 'player', playerId: 1234, name: 'Ada',
      })}
      deletePlayer={deletePlayer}
      qrEncoder={vi.fn().mockRejectedValue(new Error('QR encoder failed.'))}
      fetchGames={vi.fn().mockResolvedValue([])}
    />)
    await userEvent.click(screen.getByRole('tab', { name: 'Players' }))
    await userEvent.type(screen.getByLabelText('Player name'), 'Ada')
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }))
    expect(await screen.findByText('QR encoder failed.')).toHaveAttribute('role', 'alert')
    expect(deletePlayer).toHaveBeenCalledWith(1234, expect.any(AbortSignal))
    expect(screen.queryByLabelText('Generated player QR card')).not.toBeInTheDocument()
  })

  it('surfaces failed player cleanup after QR encoding fails', async () => {
    setupCamera()
    render(<App
      createPlayer={vi.fn().mockResolvedValue({
        v: 1, kind: 'player', playerId: 1234, name: 'Ada',
      })}
      deletePlayer={vi.fn().mockRejectedValue(new Error('Database locked.'))}
      qrEncoder={vi.fn().mockRejectedValue(new Error('QR encoder failed.'))}
      fetchGames={vi.fn().mockResolvedValue([])}
    />)
    await userEvent.click(screen.getByRole('tab', { name: 'Players' }))
    await userEvent.type(screen.getByLabelText('Player name'), 'Ada')
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }))
    expect(await screen.findByText(
      'QR encoder failed. Player #1234 cleanup failed: Database locked.',
    )).toHaveAttribute('role', 'alert')
  })

  it('keeps only the newest overlapping QR generation result', async () => {
    setupCamera()
    const resolvers: Array<(url: string) => void> = []
    const qrEncoder = vi.fn(() => new Promise<string>((resolve) => resolvers.push(resolve)))
    let nextId = 1234
    const createPlayer = vi.fn(async (name: string) => ({
      v: 1 as const, kind: 'player' as const, playerId: nextId++, name,
    }))
    const deletePlayer = vi.fn().mockResolvedValue(undefined)
    render(<App
      workerFactory={() => new FakeWorker() as unknown as Worker}
      qrEncoder={qrEncoder}
      createPlayer={createPlayer}
      deletePlayer={deletePlayer}
    />)
    await userEvent.click(screen.getByRole('tab', { name: 'Players' }))
    const input = screen.getByLabelText('Player name')
    await userEvent.type(input, 'First')
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }))
    await userEvent.clear(input)
    await userEvent.type(input, 'Second')
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }))

    await act(async () => resolvers[1]('data:image/png;base64,second'))
    expect(screen.getByRole('heading', { name: 'Second' })).toBeInTheDocument()
    await act(async () => resolvers[0]('data:image/png;base64,first'))
    expect(screen.getByRole('heading', { name: 'Second' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'First' })).not.toBeInTheDocument()
    expect(deletePlayer).toHaveBeenCalledWith(1234, expect.any(AbortSignal))
    expect(deletePlayer).not.toHaveBeenCalledWith(1235, expect.anything())
  })

  it('uses requestVideoFrameCallback when available and handles an ended track', async () => {
    const camera = setupCamera()
    const callback = vi.fn(() => 77)
    const cancel = vi.fn()
    Object.defineProperties(HTMLVideoElement.prototype, {
      requestVideoFrameCallback: { configurable: true, value: callback },
      cancelVideoFrameCallback: { configurable: true, value: cancel },
    })
    render(<App workerFactory={() => new FakeWorker() as unknown as Worker} />)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Scanning for a QR code'))
    expect(callback).toHaveBeenCalled()
    act(() => camera.track.end())
    expect(screen.getByRole('status')).toHaveTextContent('No camera is available')
    expect(cancel).toHaveBeenCalledWith(77)
  })

  it('keeps scanning on a bounded timer when a video-frame callback stalls', async () => {
    vi.useFakeTimers()
    setupCamera()
    const stalledCallback = vi.fn(() => 77)
    const cancel = vi.fn()
    Object.defineProperties(HTMLVideoElement.prototype, {
      requestVideoFrameCallback: { configurable: true, value: stalledCallback },
      cancelVideoFrameCallback: { configurable: true, value: cancel },
    })
    const detect = vi.fn().mockResolvedValue([])
    const nativeDetector: NativeBarcodeDetector = { detect }
    render(<App nativeDetectorFactory={() => nativeDetector} />)
    const video = screen.getByLabelText('Mirrored live camera preview')
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 1920 },
      videoHeight: { configurable: true, value: 1080 },
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
    })
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(screen.getByRole('status')).toHaveTextContent('Scanning for a QR code')
    expect(stalledCallback).toHaveBeenCalledOnce()

    await act(async () => vi.advanceTimersByTimeAsync(VIDEO_FRAME_CALLBACK_WATCHDOG_MS))
    expect(cancel).toHaveBeenCalledWith(77)
    expect(nativeDetector.detect).toHaveBeenCalledWith(video)

    await act(async () => vi.advanceTimersByTimeAsync(1_100))
    expect(detect.mock.calls.length).toBeGreaterThan(1)
    expect(screen.getByLabelText('Scanner diagnostics')).not.toHaveTextContent('Measuring')
    expect(screen.getByLabelText('Scanner diagnostics')).toHaveTextContent('decode')
  })
})

describe('ongoing games', () => {
  const game = {
    id: 9,
    tableNumber: 2,
    createdAt: '2026-01-02T03:04:05.000Z',
    finishedAt: null,
    result: null,
    blackPlayerId: 1111,
    whitePlayerId: 1222,
    blackPlayer: { id: 1111, name: 'Noir', rating: 700 },
    whitePlayer: { id: 1222, name: 'Blanca', rating: 700 },
  }

  afterEach(() => vi.useRealTimers())

  it('loads immediately, shows empty and error states, and retries', async () => {
    let resolveInitial: ((games: typeof game[]) => void) | undefined
    const fetchGames = vi.fn()
      .mockImplementationOnce(() => new Promise<typeof game[]>((resolve) => { resolveInitial = resolve }))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([])
    render(<App fetchGames={fetchGames} gamesPollIntervalMs={60_000} />)
    expect(screen.getByText('Loading ongoing games…')).toBeInTheDocument()
    await act(async () => resolveInitial?.([]))
    expect(screen.getByText('No games are ongoing yet.')).toBeInTheDocument()

    act(() => window.dispatchEvent(new Event('focus')))
    expect(await screen.findByText(/Could not refresh ongoing games/)).toHaveAttribute('role', 'alert')
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(fetchGames).toHaveBeenCalledTimes(3))
    expect(screen.queryByText(/Could not refresh ongoing games/)).not.toBeInTheDocument()
  })

  it('renders a compact two-row checker card with ratings and no IDs or dates', async () => {
    render(<App fetchGames={vi.fn().mockResolvedValue([game])} gamesPollIntervalMs={60_000} />)
    const list = await screen.findByLabelText('Ongoing games')
    expect(list).toHaveClass('games-list')
    expect(list).toHaveAttribute('role', 'region')
    expect(list).not.toHaveAttribute('tabindex')
    const card = await screen.findByRole('article', {
      name: 'Table 2: Noir plays black, Blanca plays white',
    })
    expect(card).toHaveClass('game-card')
    expect(card).toHaveAttribute('data-game-id', '9')
    const labels = within(card).getAllByLabelText(/player:/i)
    expect(labels[0]).toHaveAccessibleName('Black player: Noir, rating 700')
    expect(labels[1]).toHaveAccessibleName('White player: Blanca, rating 700')
    expect(card.querySelector('.chessboard')).not.toBeInTheDocument()
    expect(card).not.toHaveTextContent('1111')
    expect(card).not.toHaveTextContent('2026')
    const board = within(card).getByLabelText('Two-rank chess board')
    expect(within(board).getAllByLabelText(/^black /).map((square) => square.textContent))
      .toEqual(['♜', '♞', '♝', '♛', '♚', '♝', '♞', '♜'])
    expect(within(board).getAllByLabelText(/^white /).map((square) => square.textContent))
      .toEqual(['♖', '♘', '♗', '♕', '♔', '♗', '♘', '♖'])
    expect(within(card).queryByRole('img')).not.toBeInTheDocument()
  })

  it('renders recent results below ongoing games with winner and draw treatment', async () => {
    const whiteWin = {
      ...game,
      result: '1-0' as const,
      finishedAt: '2026-01-03T00:00:00.000Z',
    }
    const draw = {
      ...game,
      id: 10,
      result: '1/2-1/2' as const,
      finishedAt: '2026-01-04T00:00:00.000Z',
    }
    render(<App
      fetchGames={vi.fn().mockResolvedValue({ games: [], recentGames: [draw, whiteWin] })}
      gamesPollIntervalMs={60_000}
    />)
    await userEvent.click(screen.getByRole('tab', { name: 'Recent Games' }))
    const recent = await screen.findByRole('region', { name: 'Recent finished games' })
    expect(within(recent).getByText('White wins')).toBeInTheDocument()
    expect(within(recent).getByText('Draw')).toBeInTheDocument()
    expect(within(recent).getByText('1/2-1/2')).toBeInTheDocument()
    expect(within(recent).getAllByText('Blanca')[1].closest('.player-side')).toHaveClass('winner')
    expect(within(recent).getByRole('article', { name: 'Table 2: 1/2-1/2' }))
      .toHaveClass('drawn-game')
  })

  it('renders a tabbed primary workspace and one persistent Ongoing Games rail', async () => {
    render(<App fetchGames={vi.fn().mockResolvedValue([game])} gamesPollIntervalMs={60_000} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Leaderboard' }))
    const ongoingList = await screen.findByRole('region', { name: 'Ongoing games' })
    expect(screen.getByRole('heading', { level: 1, name: 'Sunset Chess' })).toHaveClass('visually-hidden')
    expect(screen.queryByText('Scan the position')).not.toBeInTheDocument()
    expect(screen.queryByText('The first move is a QR code. Chess is coming next.')).not.toBeInTheDocument()

    const dashboard = document.querySelector<HTMLElement>('.dashboard')
    const main = document.querySelector<HTMLElement>('.main-column')
    const liveGames = document.querySelector<HTMLElement>('.live-games')
    const ongoingColumn = document.querySelector<HTMLElement>('.ongoing-column')
    const overlay = screen.getByTestId('camera-interaction-layer')
    expect([...dashboard!.children]).toEqual([main, ongoingColumn])
    expect(dashboard).not.toContainElement(overlay)
    expect(document.querySelector('.scanner-card, .center-stage, .right-rail')).not.toBeInTheDocument()
    const leaderboard = document.querySelector<HTMLElement>('.leaderboard')
    expect(main).toContainElement(document.querySelector('.brand-header'))
    expect(document.querySelector('.scanner-panel')).not.toBeInTheDocument()
    expect(main).toContainElement(leaderboard)
    expect(ongoingColumn).toContainElement(liveGames)
    expect(within(liveGames!).getByRole('heading', { level: 2 })).toHaveTextContent('Ongoing Games')
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent))
      .toEqual(['Leaderboard', 'Recent Games', 'Players'])
    expect(main?.nextElementSibling).toBe(ongoingColumn)
    expect(document.querySelector('.brand-header')!.compareDocumentPosition(leaderboard!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(liveGames!).getByRole('region', { name: 'Ongoing games' })).toBe(ongoingList)
    expect(ongoingList).toHaveClass('games-list')
  })

  it('polls additions and removals without overlap and aborts on cleanup', async () => {
    vi.useFakeTimers()
    let resolvePending: ((games: typeof game[]) => void) | undefined
    const signals: AbortSignal[] = []
    const fetchGames = vi.fn((signal: AbortSignal) => {
      signals.push(signal)
      if (fetchGames.mock.calls.length === 1) return Promise.resolve<typeof game[]>([])
      return new Promise<typeof game[]>((resolve) => { resolvePending = resolve })
    })
    const view = render(<App fetchGames={fetchGames} gamesPollIntervalMs={2000} />)
    await act(async () => undefined)
    expect(screen.getByText('No games are ongoing yet.')).toBeInTheDocument()

    await act(async () => vi.advanceTimersByTimeAsync(2000))
    await act(async () => vi.advanceTimersByTimeAsync(6000))
    expect(fetchGames).toHaveBeenCalledTimes(2)
    await act(async () => resolvePending?.([game]))
    expect(screen.getByRole('heading', { name: 'Table 2' })).toBeInTheDocument()

    await act(async () => vi.advanceTimersByTimeAsync(2000))
    await act(async () => resolvePending?.([]))
    expect(screen.queryByRole('heading', { name: 'Table 2' })).not.toBeInTheDocument()

    await act(async () => vi.advanceTimersByTimeAsync(2000))
    expect(signals.at(-1)?.aborted).toBe(false)
    view.unmount()
    expect(signals.at(-1)?.aborted).toBe(true)
  })
})
