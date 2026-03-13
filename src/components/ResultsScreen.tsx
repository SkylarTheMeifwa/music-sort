import { useMemo, useState } from 'react'
import { formatMs } from '../lib/format'
import { getValidAccessToken, removeTracksFromPlaylist } from '../lib/spotify'
import { useAppStore } from '../store'

export function ResultsScreen() {
  const session = useAppStore((s) => s.session)
  const undo = useAppStore((s) => s.undo)
  const advanceToNextPass = useAppStore((s) => s.advanceToNextPass)
  const clearSession = useAppStore((s) => s.clearSession)

  const [showModal, setShowModal] = useState(false)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [removeMsg, setRemoveMsg] = useState('')
  const [copied, setCopied] = useState(false)

  const stats = useMemo(() => {
    if (!session) return { yes: 0, maybe: 0, no: 0, yesDuration: 0 }
    let yes = 0, maybe = 0, no = 0, yesDuration = 0
    for (const id of session.songOrder) {
      const s = session.songs[id].status
      if (s === 'yes') { yes++; yesDuration += session.songs[id].durationMs }
      else if (s === 'maybe') maybe++
      else if (s === 'no') no++
    }
    return { yes, maybe, no, yesDuration }
  }, [session])

  const targetProgress = useMemo(() => {
    if (!session || session.targetMs <= 0) return 0
    return Math.min(100, (stats.yesDuration / session.targetMs) * 100)
  }, [session, stats.yesDuration])

  const cleanupLines = useMemo(() => {
    if (!session) return [] as string[]
    return session.songOrder
      .filter((id) => session.songs[id].status === 'no' || session.songs[id].status === 'maybe')
      .map((id) => `${session.songs[id].name} — ${session.songs[id].artists.join(', ')}`)
  }, [session])

  const hasRemaining = useMemo(() => {
    if (!session) return false
    return session.songOrder.some((id) => session.songs[id].status !== 'yes')
  }, [session])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(cleanupLines.join('\n'))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  const handleRemoveFromSpotify = async () => {
    if (!session || cleanupLines.length === 0 || removeBusy) return
    if (!window.confirm(`Remove ${cleanupLines.length} tracks from "${session.playlistName}" on Spotify? This cannot be undone.`)) return

    setRemoveBusy(true)
    setRemoveMsg('')
    try {
      const token = await getValidAccessToken()
      const uris = session.songOrder
        .filter((id) => session.songs[id].status === 'no' || session.songs[id].status === 'maybe')
        .map((id) => session.songs[id].uri)
      await removeTracksFromPlaylist(token, session.playlistId, uris)
      setRemoveMsg(`✓ ${uris.length} tracks removed from ${session.playlistName}.`)
    } catch (err) {
      setRemoveMsg(err instanceof Error ? err.message : 'Failed to remove tracks.')
    } finally {
      setRemoveBusy(false)
    }
  }

  if (!session) return null

  return (
    <section className="screen results-screen">
      <h2 className="results-title">Sorting Complete 🎵</h2>

      <div className="results-stats">
        <article className="stat-box green">
          <span className="stat-num">{stats.yes}</span>
          <span className="stat-label">Yes</span>
          <span className="stat-dur">{formatMs(stats.yesDuration)}</span>
        </article>
        <article className="stat-box yellow">
          <span className="stat-num">{stats.maybe}</span>
          <span className="stat-label">Maybe</span>
        </article>
        <article className="stat-box red">
          <span className="stat-num">{stats.no}</span>
          <span className="stat-label">No</span>
        </article>
      </div>

      <div className="duration-bar-wrap">
        <div className="duration-track">
          <div className="duration-fill" style={{ width: `${targetProgress}%` }} />
        </div>
        <div className="duration-labels">
          <span>{formatMs(stats.yesDuration)} selected</span>
          <span>{formatMs(session.targetMs)} target</span>
        </div>
      </div>

      <div className="results-actions">
        {cleanupLines.length > 0 && (
          <button type="button" className="btn-primary" onClick={() => setShowModal(true)}>
            Cleanup List ({cleanupLines.length} tracks)
          </button>
        )}

        {hasRemaining && (
          <button type="button" className="btn-secondary" onClick={advanceToNextPass}>
            Review Remaining Songs Again
          </button>
        )}

        <button type="button" className="btn-secondary" onClick={undo}>
          Undo Last Swipe
        </button>

        <button type="button" className="btn-secondary" onClick={clearSession}>
          Start Over
        </button>
      </div>

      {showModal && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setShowModal(false)}
        >
          <section className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Cleanup List</h3>
            <p className="modal-hint">
              All No + Maybe tracks — remove these from <strong>{session.playlistName}</strong> to keep only your Yes picks.
            </p>

            <textarea
              className="export-text"
              readOnly
              rows={10}
              value={cleanupLines.join('\n')}
            />

            <div className="modal-actions">
              <button type="button" className="btn-primary" onClick={() => void handleCopy()}>
                {copied ? 'Copied!' : 'Copy to Clipboard'}
              </button>

              <button
                type="button"
                className="btn-secondary"
                disabled={removeBusy}
                onClick={() => void handleRemoveFromSpotify()}
              >
                {removeBusy ? 'Removing…' : 'Remove from Spotify Playlist'}
              </button>

              {removeMsg && <p className="error-msg">{removeMsg}</p>}

              <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>
                Close
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  )
}
