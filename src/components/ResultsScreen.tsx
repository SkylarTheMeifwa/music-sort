import { useMemo, useState } from 'react'
import { formatMs } from '../lib/format'
import {
  createSpotifyPlaylistFromTracks,
  getValidAccessToken,
  removeTracksFromPlaylist,
} from '../lib/spotify'
import { useAppStore } from '../store'

export function ResultsScreen() {
  const session = useAppStore((s) => s.session)
  const undo = useAppStore((s) => s.undo)
  const advanceToNextPass = useAppStore((s) => s.advanceToNextPass)
  const clearSession = useAppStore((s) => s.clearSession)

  const [showModal, setShowModal] = useState(false)
  const [createBusy, setCreateBusy] = useState(false)
  const [createMsg, setCreateMsg] = useState('')
  const [createdPlaylistUrl, setCreatedPlaylistUrl] = useState('')
  const [removeBusy, setRemoveBusy] = useState(false)
  const [removeMsg, setRemoveMsg] = useState('')
  const [copied, setCopied] = useState(false)
  const canRemoveFromSpotify = session?.sourceType !== 'liked'

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

  const yesUris = useMemo(() => {
    if (!session) return [] as string[]
    return session.songOrder
      .filter((id) => session.songs[id].status === 'yes')
      .map((id) => session.songs[id].uri)
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

  const handleCreateSpotifyPlaylist = async () => {
    if (!session || yesUris.length === 0 || createBusy) return

    setCreateBusy(true)
    setCreateMsg('')
    setCreatedPlaylistUrl('')

    try {
      const token = await getValidAccessToken()
      const createdAt = new Date().toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
      const sourceLabel = session.sourceType === 'liked' ? 'Liked Songs' : session.playlistName
      const playlist = await createSpotifyPlaylistFromTracks(token, {
        name: `${session.playlistName} - Yes Picks`,
        description: `Created by Music Sort from ${sourceLabel} on ${createdAt}.`,
        isPublic: false,
        uris: yesUris,
      })
      setCreateMsg(`Created ${playlist.name} with ${yesUris.length} tracks.`)
      setCreatedPlaylistUrl(playlist.externalUrl ?? '')
    } catch (err) {
      setCreateMsg(err instanceof Error ? err.message : 'Failed to create Spotify playlist.')
    } finally {
      setCreateBusy(false)
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
        {yesUris.length > 0 && (
          <button
            type="button"
            className="btn-primary"
            disabled={createBusy}
            onClick={() => void handleCreateSpotifyPlaylist()}
          >
            {createBusy ? 'Creating Spotify Playlist…' : `Create Spotify Playlist (${yesUris.length} tracks)`}
          </button>
        )}

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

      {createMsg && (
        <div className="status-block">
          <p className="success-msg">{createMsg}</p>
          {createdPlaylistUrl && (
            <a className="results-link" href={createdPlaylistUrl} target="_blank" rel="noreferrer">
              Open playlist in Spotify
            </a>
          )}
        </div>
      )}

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

              {canRemoveFromSpotify && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={removeBusy}
                  onClick={() => void handleRemoveFromSpotify()}
                >
                  {removeBusy ? 'Removing…' : 'Remove from Spotify Playlist'}
                </button>
              )}

              {!canRemoveFromSpotify && (
                <p className="modal-hint">
                  Remove from Spotify is only available for playlist imports, not Liked Songs.
                </p>
              )}

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
