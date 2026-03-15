import type { SortedSong } from '../types'
import { formatMs } from '../lib/format'

interface CardCue {
  label: string
  color: string // 'r,g,b'
  alpha: number
}

interface SongCardProps {
  song: SortedSong
  depth: number // 0 = top card
  isTop: boolean
  dragX: number
  dragY: number
  isTransitioning: boolean
  cue: CardCue | null
  audioProgress: number // 0-100
  onPointerDown?: React.PointerEventHandler<HTMLElement>
  onPointerMove?: React.PointerEventHandler<HTMLElement>
  onPointerUp?: React.PointerEventHandler<HTMLElement>
  onPointerCancel?: React.PointerEventHandler<HTMLElement>
  zIndex: number
}

export function SongCard({
  song,
  depth,
  isTop,
  dragX,
  dragY,
  isTransitioning,
  cue,
  audioProgress,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  zIndex,
}: SongCardProps) {
  const baseTransform = `translateY(${depth * 10}px) scale(${1 - depth * 0.04})`
  const topTransform = `translate(${dragX}px, ${dragY}px) rotate(${dragX / 18}deg)`
  const transform = isTop ? topTransform : baseTransform

  const transition = isTop
    ? isTransitioning
      ? 'transform 220ms cubic-bezier(0.16, 1, 0.3, 1)'
      : 'none'
    : 'transform 200ms ease'

  const artistsText = song.artists.filter(Boolean).join(', ') || 'Unknown artist'
  const hasDuration = Number.isFinite(song.durationMs) && song.durationMs > 0
  const durationText = hasDuration ? formatMs(song.durationMs) : 'Unknown duration'
  const progressMs = hasDuration ? Math.round((song.durationMs * Math.max(0, Math.min(100, audioProgress))) / 100) : 0

  return (
    <article
      className="song-card"
      style={{ transform, transition, zIndex, touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div className="card-art-wrap">
        {song.imageUrl ? (
          <img
            src={song.imageUrl}
            alt={`${song.name} album art`}
            className="card-art"
            draggable={false}
          />
        ) : (
          <div className="card-art card-art-placeholder" aria-hidden="true" />
        )}

        {isTop && cue && (
          <div
            className="card-overlay"
            style={{ backgroundColor: `rgba(${cue.color},${cue.alpha * 0.38})` }}
          >
            <span className="card-overlay-label">{cue.label}</span>
          </div>
        )}
      </div>

      <footer className="card-info">
        <p className="card-title">{song.name}</p>
        <p className="card-artists">{artistsText}</p>
        <p className="card-duration">{durationText}</p>

        {isTop && (
          <div className="progress-wrap">
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${audioProgress}%`, background: 'var(--green)' }}
              />
            </div>
            <p className="progress-label">
              {hasDuration ? `${formatMs(progressMs)} / ${durationText}` : 'Spotify playback'}
            </p>
          </div>
        )}
      </footer>
    </article>
  )
}
