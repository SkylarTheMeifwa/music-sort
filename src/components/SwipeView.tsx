import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { clamp, formatMs } from '../lib/format'
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

export function SwipeView() {
  const session = useAppStore((s) => s.session)
  const swipe = useAppStore((s) => s.swipe)
  const undo = useAppStore((s) => s.undo)
  const setMuted = useAppStore((s) => s.setMuted)
  const clearSession = useAppStore((s) => s.clearSession)

  const [drag, setDrag] = useState<DragState>({ x: 0, y: 0, active: false, transitioning: false })
  const [audioProgress, setAudioProgress] = useState(0)
  const [previewBlocked, setPreviewBlocked] = useState(false)

  const pointerRef = useRef<{ id: number; sx: number; sy: number } | null>(null)
  const inFlightRef = useRef(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

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

  // ── Audio ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const audio = new Audio()
    audio.loop = true
    audio.preload = 'none'
    audioRef.current = audio

    const onTime = () => {
      const d = audio.duration
      setAudioProgress(Number.isFinite(d) && d > 0 ? clamp((audio.currentTime / d) * 100, 0, 100) : 0)
    }
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onTime)

    return () => {
      audio.pause()
      audio.src = ''
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onTime)
      audioRef.current = null
    }
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    audio.pause()
    setAudioProgress(0)

    if (!topSong?.previewUrl || session?.muted) {
      audio.src = ''
      setPreviewBlocked(false)
      return
    }

    audio.src = topSong.previewUrl
    audio.currentTime = 0
    void audio.play().then(() => setPreviewBlocked(false)).catch(() => setPreviewBlocked(true))
  }, [topSong?.id, topSong?.previewUrl, session?.muted])

  const handleManualPreviewPlay = () => {
    const audio = audioRef.current
    if (!audio || !topSong?.previewUrl) return
    if (audio.src !== topSong.previewUrl) {
      audio.src = topSong.previewUrl
      audio.currentTime = 0
    }
    void audio.play().then(() => setPreviewBlocked(false)).catch(() => setPreviewBlocked(true))
  }

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
          aria-label={session.muted ? 'Unmute preview' : 'Mute preview'}
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
          <span>{formatMs(yesDurationMs)} selected</span>
          <span>{formatMs(session.targetMs)} target</span>
        </div>
      </div>

      <div className="swipe-tools">
        {topSong?.previewUrl && !session.muted && previewBlocked && (
          <button type="button" className="btn-secondary btn-inline" onClick={handleManualPreviewPlay}>
            Play Preview
          </button>
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
