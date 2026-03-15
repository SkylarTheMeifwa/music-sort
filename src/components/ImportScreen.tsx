import { useEffect, useState } from 'react'
import {
  clearStoredToken,
  exchangeCodeForToken,
  extractSpotifyTrackIds,
  fetchTracksByIds,
  getValidAccessToken,
  MANUAL_TRACKS_SOURCE_ID,
  readStoredToken,
  startSpotifyLogin,
  writeStoredToken,
} from '../lib/spotify'
import { parseMinutesToMs } from '../lib/format'
import { useAppStore } from '../store'
import type { SessionState } from '../types'

export function ImportScreen() {
  const session = useAppStore((s) => s.session)
  const startSession = useAppStore((s) => s.startSession)
  const setView = useAppStore((s) => s.setView)
  const setTarget = useAppStore((s) => s.setTarget)

  const [isAuthenticated, setIsAuthenticated] = useState(!!readStoredToken())
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState('')
  const [manualTrackInput, setManualTrackInput] = useState('')
  const [targetMinutes, setTargetMinutes] = useState('60')
  const [loading, setLoading] = useState(false)
  const [loadingProgress, setLoadingProgress] = useState<number | null>(null)
  const [loadingLabel, setLoadingLabel] = useState('Preparing import...')
  const [error, setError] = useState('')
  const parsedTrackIds = extractSpotifyTrackIds(manualTrackInput)

  // Handle OAuth callback code exchange on mount
  useEffect(() => {
    async function init() {
      try {
        const params = new URLSearchParams(window.location.search)
        const code = params.get('code')
        const oauthErr = params.get('error')
        const state = params.get('state')
        const expectedState = sessionStorage.getItem('spotify_oauth_state')

        if (oauthErr) throw new Error(`Spotify login failed: ${oauthErr}`)

        if (code) {
          if (!state || state !== expectedState) {
            throw new Error('OAuth state mismatch — please try logging in again.')
          }
          const exchanged = await exchangeCodeForToken(code)
          writeStoredToken({
            accessToken: exchanged.access_token,
            refreshToken: exchanged.refresh_token ?? null,
            expiresAt: Date.now() + exchanged.expires_in * 1000,
            clientId: import.meta.env.VITE_SPOTIFY_CLIENT_ID as string,
            scope: exchanged.scope,
          })
          sessionStorage.removeItem('spotify_oauth_state')
          const clean = `${window.location.origin}${window.location.pathname}`
          window.history.replaceState({}, document.title, clean)
        }

        if (readStoredToken()) {
          setIsAuthenticated(true)
        }
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'Authentication failed.')
        setIsAuthenticated(false)
      } finally {
        setAuthLoading(false)
      }
    }

    void init()
  }, [])

  const handleTargetChange = (value: string) => {
    setTargetMinutes(value)
    setTarget(parseMinutesToMs(value))
  }

  const handleLoadTrackIds = async () => {
    setError('')

    if (parsedTrackIds.length === 0) {
      setError('Paste Spotify track IDs or track URLs into the track import box.')
      return
    }

    setLoading(true)
    setLoadingLabel('Authorizing Spotify session...')
    setLoadingProgress(8)
    try {
      const token = await getValidAccessToken()
      setLoadingLabel('Fetching tracks by ID...')
      setLoadingProgress(15)
      const tracks = await fetchTracksByIds(token, parsedTrackIds, (completed, total) => {
        const ratio = total > 0 ? completed / total : 0
        setLoadingProgress(15 + Math.round(ratio * 75))
        setLoadingLabel(`Fetching tracks by ID... (${completed}/${total})`)
      })

      if (tracks.length === 0) {
        setError('No valid Spotify tracks were found in the pasted IDs/URLs.')
        return
      }

      const songs = Object.fromEntries(
        tracks.map((track) => [track.id, { ...track, status: 'unknown' as const }]),
      )
      const songOrder = tracks.map((track) => track.id)
      const targetMs = parseMinutesToMs(targetMinutes)
      setLoadingLabel('Building sorting session...')
      setLoadingProgress(94)

      const newSession: SessionState = {
        playlistId: MANUAL_TRACKS_SOURCE_ID,
        playlistName: `Imported Tracks (${tracks.length})`,
        sourceType: 'tracks',
        pass: 1,
        queueIndex: 0,
        passQueueIds: [...songOrder],
        targetMs,
        muted: false,
        songOrder,
        songs,
        history: [],
      }
      startSession(newSession)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pasted tracks.')
    } finally {
      setLoading(false)
      setLoadingProgress(null)
    }
  }

  if (authLoading) {
    return (
      <section className="screen import-screen">
        <h1 className="app-title">Music Sort</h1>
        <p className="app-subtitle">Connecting to Spotify…</p>
      </section>
    )
  }

  return (
    <section className="screen import-screen">
      <h1 className="app-title">Music Sort</h1>
      <p className="app-subtitle">
        Swipe songs into Yes / Maybe / No to build the perfect playlist.
      </p>

      {authError && (
        <div className="auth-error-banner">
          <span>{authError}</span>
          <button type="button" onClick={() => setAuthError('')} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {!isAuthenticated && (
        <button
          type="button"
          className="btn-primary"
          onClick={() =>
            startSpotifyLogin().catch((err) =>
              setAuthError(err instanceof Error ? err.message : 'Failed to start Spotify login.'),
            )
          }
        >
          Log in with Spotify
        </button>
      )}

      {isAuthenticated && (
        <div className="import-form">
          <div className="import-divider">Paste Spotify track IDs / track URLs</div>

          <div className="import-block">
            <div className="import-block-header">
              <h2>Track IDs</h2>
            </div>
            <textarea
              className="id-input"
              rows={6}
              placeholder={'4uLU6hMCjMI75M1A2tKUQC\nhttps://open.spotify.com/track/1301WleyT98MSxVHPZCA6M\n1A2B3C4D5E6F7G8H9I0JKL'}
              value={manualTrackInput}
              onChange={(e) => setManualTrackInput(e.target.value)}
            />
            <p className="helper-text">
              Detected {parsedTrackIds.length} valid track ID{parsedTrackIds.length === 1 ? '' : 's'}.
            </p>
            <button
              type="button"
              className="btn-secondary"
              disabled={loading}
              onClick={() => void handleLoadTrackIds()}
            >
              {loading ? 'Loading…' : 'Import Tracks'}
            </button>
          </div>

          <div className="target-row">
            <label htmlFor="targetMin">Target duration (HH:MM or minutes)</label>
            <input
              id="targetMin"
              className="target-input"
              inputMode="text"
              placeholder="1:30"
              value={targetMinutes}
              onChange={(e) => handleTargetChange(e.target.value)}
            />
          </div>
          <p className="helper-text">Examples: 1:30 = 1 hour 30 min, or 90 = 90 minutes.</p>

          {error && <p className="error-msg">{error}</p>}

          {session && (
            <button type="button" className="btn-secondary" onClick={() => setView('swipe')}>
              Resume Saved Session
            </button>
          )}

          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              clearStoredToken()
              setIsAuthenticated(false)
            }}
          >
            Log out of Spotify
          </button>
        </div>
      )}

      {loading && (
        <div className="progress-modal-backdrop" role="presentation">
          <section className="progress-modal" role="dialog" aria-modal="true" aria-label="Import progress">
            <h3>Importing Songs</h3>
            <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={loadingProgress ?? 0}>
              <div className="progress-fill" style={{ width: `${loadingProgress ?? 0}%` }} />
            </div>
            <p className="helper-text">{loadingLabel}</p>
            <p className="helper-text">{loadingProgress ?? 0}%</p>
          </section>
        </div>
      )}
    </section>
  )
}
