import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { clamp, formatDurationHm } from '../lib/format'
import { getValidAccessToken } from '../lib/spotify'
import { useAppStore } from '../store'
import type { SortedSong } from '../types'
import { SongCard } from './SongCard'

const SWIPE_X = 100
const SWIPE_Y = 100

interface DragState {
  x: number
  y: number
  active: boolean
  transitioning: boolean
}

interface Cue {
  label: string
  color: string
  alpha: number
}

declare global {
  interface Window {
    Spotify?: {
      Player: new (options: {
        name: string
        getOAuthToken: (cb: (token: string) => void) => void
        volume?: number
      }) => SpotifyPlayerLike
    }
    onSpotifyWebPlaybackSDKReady?: () => void
  }
}

interface SpotifyPlayerTrack {
  uri: string
  duration_ms: number
}

interface SpotifyPlayerState {
  paused: boolean
  position: number
  duration: number
  track_window?: {
    current_track?: SpotifyPlayerTrack
  }
}

interface SpotifyPlayerLike {
  connect: () => Promise<boolean>
  disconnect: () => void
  pause: () => Promise<void>
  addListener(event: 'ready', cb: (payload: { device_id: string }) => void): void
  addListener(event: 'player_state_changed', cb: (state: SpotifyPlayerState | null) => void): void
  removeListener?: (event: 'ready' | 'player_state_changed') => void
}

function getCue(x: number, y: number): Cue | null {
  const ax = Math.abs(x)
  const ay = Math.abs(y)
  if (ax < 12 && ay < 12) return null
  if (x > 0 && ax >= ay * 0.8)
    return { label: 'YES', color: '34,197,94', alpha: clamp(ax / SWIPE_X, 0, 1) }
  if (x < 0 && ax >= ay * 0.8)
    return { label: 'NO', color: '239,68,68', alpha: clamp(ax / SWIPE_X, 0, 1) }
  if (y > 0 && ay > ax * 0.8)
    return { label: 'MAYBE', color: '234,179,8', alpha: clamp(ay / SWIPE_Y, 0, 1) }
  return null
}

function getSwipeDir(x: number, y: number): 'yes' | 'no' | 'maybe' | null {
  const ax = Math.abs(x)
  const ay = Math.abs(y)
  if (x >= SWIPE_X && ax >= ay * 0.8) return 'yes'
  if (x <= -SWIPE_X && ax >= ay * 0.8) return 'no'
  if (y >= SWIPE_Y && ay > ax * 0.8) return 'maybe'
  return null
}

function getMiddlePositionMs(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0
  return Math.max(0, Math.floor(durationMs / 2))
}

export function SwipeView() {
  const session = useAppStore((s) => s.session)
  const swipe = useAppStore((s) => s.swipe)
  const undo = useAppStore((s) => s.undo)
  const setMuted = useAppStore((s) => s.setMuted)
  const clearSession = useAppStore((s) => s.clearSession)

  const [drag, setDrag] = useState<DragState>({ x: 0, y: 0, active: false, transitioning: false })
  const [audioProgress, setAudioProgress] = useState(0)
  const [sdkReady, setSdkReady] = useState(false)
  const [sdkFailed, setSdkFailed] = useState(false)
  const [playbackSnapshot, setPlaybackSnapshot] = useState<{
    uri: string
    positionMs: number
    durationMs: number
    paused: boolean
    receivedAt: number
  } | null>(null)

  const pointerRef = useRef<{ id: number; sx: number; sy: number } | null>(null)
  const inFlightRef = useRef(false)
  const sdkPlayerRef = useRef<SpotifyPlayerLike | null>(null)
  const sdkDeviceIdRef = useRef<string>('')

  const visibleSongIds = useMemo(() => {
    if (!session) return [] as string[]
    return session.passQueueIds.slice(session.queueIndex, session.queueIndex + 3)
  }, [session])

  const topSong: SortedSong | null = useMemo(() => {
    if (!session) return null
    const id = session.passQueueIds[session.queueIndex]
    return id ? session.songs[id] : null
  }, [session])

  const yesDurationMs = useMemo(() => {
    if (!session) return 0
    return session.songOrder.reduce<number>(
      (acc, id) => (session.songs[id].status === 'yes' ? acc + session.songs[id].durationMs : acc),
      0,
    )
  }, [session])

  const remainingCount = useMemo(() => {
    if (!session) return 0
    return Math.max(0, session.passQueueIds.length - session.queueIndex)
  }, [session])

  const targetProgress = useMemo(() => {
    if (!session || session.targetMs <= 0) return 0
    return clamp((yesDurationMs / session.targetMs) * 100, 0, 100)
  }, [session, yesDurationMs])

  useEffect(() => {
    let disposed = false

    const initSdk = () => {
      if (disposed || !window.Spotify) return

      const player = new window.Spotify.Player({
        name: 'Music Sort Player',
        getOAuthToken: (cb) => {
          void getValidAccessToken()
            .then((token) => cb(token))
            .catch(() => {
              setSdkFailed(true)
            })
        },
        volume: 0.8,
      })

      player.addListener('ready', ({ device_id }) => {
        sdkDeviceIdRef.current = device_id
        setSdkReady(true)
        setSdkFailed(false)
      })

      player.addListener('player_state_changed', (state) => {
        if (!state) return

        const currentTrack = state.track_window?.current_track
        setPlaybackSnapshot({
          uri: currentTrack?.uri || '',
          positionMs: Math.max(0, state.position || 0),
          durationMs: Math.max(0, state.duration || currentTrack?.duration_ms || 0),
          paused: !!state.paused,
          receivedAt: Date.now(),
        })
      })

      sdkPlayerRef.current = player
      void player.connect().then((ok) => {
        if (!ok) setSdkFailed(true)
      })
    }

    if (window.Spotify) {
      initSdk()
    } else {
      const existing = document.querySelector('script[data-spotify-sdk="1"]') as HTMLScriptElement | null
      if (!existing) {
        const script = document.createElement('script')
        script.src = 'https://sdk.scdn.co/spotify-player.js'
        script.async = true
        script.dataset.spotifySdk = '1'
        document.body.appendChild(script)
      }
      window.onSpotifyWebPlaybackSDKReady = initSdk
    }

    return () => {
      disposed = true
      if (sdkPlayerRef.current?.removeListener) {
        sdkPlayerRef.current.removeListener('ready')
        sdkPlayerRef.current.removeListener('player_state_changed')
      }
      sdkPlayerRef.current?.disconnect()
      sdkPlayerRef.current = null
      sdkDeviceIdRef.current = ''
      setPlaybackSnapshot(null)
    }
  }, [])

  const playWithSdk = useCallback(async (uri: string, positionMs: number, durationMs: number) => {
    const deviceId = sdkDeviceIdRef.current
    if (!deviceId) return

    try {
      const token = await getValidAccessToken()
      await fetch('https://api.spotify.com/v1/me/player', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ device_ids: [deviceId], play: false }),
      })

      await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uris: [uri], position_ms: positionMs }),
      })

      setPlaybackSnapshot({
        uri,
        positionMs,
        durationMs,
        paused: false,
        receivedAt: Date.now(),
      })
      setAudioProgress(durationMs > 0 ? clamp((positionMs / durationMs) * 100, 0, 100) : 0)
    } catch {
      setSdkFailed(true)
      setAudioProgress(0)
    }
  }, [])

  useEffect(() => {
    setAudioProgress(0)
    if (!topSong?.uri || session?.muted || !sdkReady) {
      return
    }

    const startPositionMs = getMiddlePositionMs(topSong.durationMs)
    void playWithSdk(topSong.uri, startPositionMs, topSong.durationMs)
  }, [topSong?.id, topSong?.uri, topSong?.durationMs, session?.muted, sdkReady, playWithSdk])

  useEffect(() => {
    if (!topSong?.uri || !playbackSnapshot || playbackSnapshot.uri !== topSong.uri) {
      setAudioProgress(0)
      return
    }

    const computeProgress = () => {
      const effectiveDuration = playbackSnapshot.durationMs || topSong.durationMs
      if (!effectiveDuration || effectiveDuration <= 0) {
        setAudioProgress(0)
        return
      }

      const elapsedSinceSnapshot = playbackSnapshot.paused ? 0 : Date.now() - playbackSnapshot.receivedAt
      const positionMs = Math.min(effectiveDuration, Math.max(0, playbackSnapshot.positionMs + elapsedSinceSnapshot))
      setAudioProgress(clamp((positionMs / effectiveDuration) * 100, 0, 100))
    }

    computeProgress()

    if (playbackSnapshot.paused) {
      return
    }

    const timer = window.setInterval(computeProgress, 250)
    return () => window.clearInterval(timer)
  }, [playbackSnapshot, topSong?.uri, topSong?.durationMs])

  useEffect(() => {
    if (!session?.muted) return
    const player = sdkPlayerRef.current
    if (!player) return
    void player.pause().catch(() => undefined)
  }, [session?.muted])

  const handleCancel = () => {
    if (!window.confirm('Cancel current sorting and go back to import?')) return
    clearSession()
  }

  // ── Swipe commit ──────────────────────────────────────────────────────────
  const commitSwipe = useCallback(
    (direction: 'yes' | 'no' | 'maybe', curX: number, curY: number) => {
      if (inFlightRef.current) return
      inFlightRef.current = true

      const outX = direction === 'yes' ? window.innerWidth * 1.4 : direction === 'no' ? -window.innerWidth * 1.4 : curX
      const outY = direction === 'maybe' ? window.innerHeight * 1.4 : curY * 0.15

      setDrag({ x: outX, y: outY, active: false, transitioning: true })

      window.setTimeout(() => {
        swipe(direction)
        inFlightRef.current = false
        setDrag({ x: 0, y: 0, active: false, transitioning: false })
      }, 210)
    },
    [swipe],
  )

  const handleButtonSwipe = (direction: 'yes' | 'no' | 'maybe') => {
    commitSwipe(direction, 0, 0)
  }

  // ── Pointer events ────────────────────────────────────────────────────────
  const onPointerDown: React.PointerEventHandler<HTMLElement> = useCallback((e) => {
    if (inFlightRef.current) return
    pointerRef.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({ x: 0, y: 0, active: true, transitioning: false })
  }, [])

  const onPointerMove: React.PointerEventHandler<HTMLElement> = useCallback((e) => {
    const ptr = pointerRef.current
    if (!ptr || ptr.id !== e.pointerId) return
    setDrag({ x: e.clientX - ptr.sx, y: e.clientY - ptr.sy, active: true, transitioning: false })
  }, [])

  const onPointerUp: React.PointerEventHandler<HTMLElement> = useCallback(
    (e) => {
      const ptr = pointerRef.current
      if (!ptr || ptr.id !== e.pointerId) return
      const dx = e.clientX - ptr.sx
      const dy = e.clientY - ptr.sy
      pointerRef.current = null

      const dir = getSwipeDir(dx, dy)
      if (dir) {
        commitSwipe(dir, dx, dy)
      } else {
        setDrag({ x: 0, y: 0, active: false, transitioning: true })
        window.setTimeout(() => setDrag({ x: 0, y: 0, active: false, transitioning: false }), 200)
      }
    },
    [commitSwipe],
  )

  const cue = getCue(drag.x, drag.y)

  if (!session) return null

  return (
    <section className="screen swipe-screen">
      {/* Header */}
      <header className="swipe-header">
        <span className="pass-badge">Pass {session.pass}</span>
        <span className="remaining-count">{remainingCount} songs left</span>
        <button
          type="button"
          className="mute-btn"
          onClick={() => setMuted(!session.muted)}
          aria-label={session.muted ? 'Unmute playback' : 'Mute playback'}
        >
          {session.muted ? '🔇' : '🔊'}
        </button>
      </header>

      {/* Duration progress */}
      <div className="duration-bar-wrap">
        <div className="duration-track">
          <div className="duration-fill" style={{ width: `${targetProgress}%` }} />
        </div>
        <div className="duration-labels">
          <span>{formatDurationHm(yesDurationMs)} selected</span>
          <span>{formatDurationHm(session.targetMs)} target</span>
        </div>
      </div>

      <div className="swipe-tools">
        {!session.muted && sdkReady && (
          <span className="helper-text">Playing with Spotify SDK</span>
        )}
        {sdkFailed && (
          <span className="helper-text">SDK playback unavailable for this account.</span>
        )}
        <button type="button" className="btn-secondary btn-inline" onClick={handleCancel}>
          Cancel
        </button>
      </div>

      {/* Card stack */}
      <div className="card-stack">
        {visibleSongIds.length === 0 && (
          <p className="swipe-empty" style={{ color: 'var(--text-muted)' }}>
            No songs left in this pass.
          </p>
        )}

        {[...visibleSongIds].reverse().map((songId, revIdx) => {
          const depth = visibleSongIds.length - 1 - revIdx
          const song = session.songs[songId]
          const isTop = depth === 0

          return (
            <SongCard
              key={song.id}
              song={song}
              depth={depth}
              isTop={isTop}
              dragX={isTop ? drag.x : 0}
              dragY={isTop ? drag.y : 0}
              isTransitioning={isTop ? drag.transitioning : false}
              cue={isTop && (drag.active || drag.transitioning) ? cue : null}
              audioProgress={isTop ? audioProgress : 0}
              zIndex={10 - depth}
              onPointerDown={isTop ? onPointerDown : undefined}
              onPointerMove={isTop ? onPointerMove : undefined}
              onPointerUp={isTop ? onPointerUp : undefined}
              onPointerCancel={isTop ? onPointerUp : undefined}
            />
          )
        })}
      </div>

      {/* Hints */}
      <div className="swipe-hints">
        <span className="hint hint-no">← No</span>
        <span className="hint hint-maybe">↓ Maybe</span>
        <span className="hint hint-yes">Yes →</span>
      </div>

      {/* Action buttons */}
      <div className="action-buttons">
        <button
          type="button"
          className="action-btn btn-no"
          onClick={() => handleButtonSwipe('no')}
          aria-label="No"
        >
          ✕
        </button>
        <button
          type="button"
          className="action-btn btn-undo"
          onClick={undo}
          disabled={session.history.length === 0}
          aria-label="Undo"
        >
          ↺
        </button>
        <button
          type="button"
          className="action-btn btn-maybe"
          onClick={() => handleButtonSwipe('maybe')}
          aria-label="Maybe"
        >
          ?
        </button>
        <button
          type="button"
          className="action-btn btn-yes"
          onClick={() => handleButtonSwipe('yes')}
          aria-label="Yes"
        >
          ♥
        </button>
      </div>
    </section>
  )
}
