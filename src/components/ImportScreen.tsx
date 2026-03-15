import { useCallback, useEffect, useState } from 'react'
import {
  clearStoredToken,
  exchangeCodeForToken,
  extractSpotifyPlaylistId,
  extractSpotifyTrackIds,
  fetchCurrentSpotifyProfile,
  fetchLikedTracks,
  fetchTracksByIds,
  fetchPlaylistWithTracks,
  fetchUserPlaylists,
  getStoredScope,
  getValidAccessToken,
  LIKED_SONGS_SOURCE_ID,
  MANUAL_TRACKS_SOURCE_ID,
  readStoredToken,
  startSpotifyLogin,
  writeStoredToken,
} from '../lib/spotify'
import { parseMinutesToMs } from '../lib/format'
import { useAppStore } from '../store'
import type { SessionState } from '../types'

interface PlaylistOption {
  id: string
  name: string
  total: number
}

interface AccountSummary {
  id: string
  label: string
}

export function ImportScreen() {
  const session = useAppStore((s) => s.session)
  const startSession = useAppStore((s) => s.startSession)
  const setView = useAppStore((s) => s.setView)
  const setTarget = useAppStore((s) => s.setTarget)

  const [isAuthenticated, setIsAuthenticated] = useState(!!readStoredToken())
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState('')
  const [playlists, setPlaylists] = useState<PlaylistOption[]>([])
  const [selectedPlaylistId, setSelectedPlaylistId] = useState('')
  const [manualInput, setManualInput] = useState('')
  const [manualTrackInput, setManualTrackInput] = useState('')
  const [targetMinutes, setTargetMinutes] = useState('60')
  const [loading, setLoading] = useState(false)
  const [loadingProgress, setLoadingProgress] = useState<number | null>(null)
  const [loadingLabel, setLoadingLabel] = useState('Preparing import...')
  const [error, setError] = useState('')
  const [account, setAccount] = useState<AccountSummary | null>(null)
  const [grantedScope, setGrantedScope] = useState('')
  const parsedTrackIds = extractSpotifyTrackIds(manualTrackInput)

  const loadPlaylists = useCallback(async () => {
    try {
      const token = await getValidAccessToken()
      const [profile, items] = await Promise.all([fetchCurrentSpotifyProfile(token), fetchUserPlaylists(token)])
      setAccount({ id: profile.id, label: profile.display_name || profile.id })
      setGrantedScope(getStoredScope())
      setPlaylists(items.map((p) => ({ id: p.id, name: p.name, total: p.tracks?.total ?? 0 })))
      setIsAuthenticated(true)
    } catch (err) {
      setAccount(null)
      setAuthError(err instanceof Error ? err.message : 'Failed to load playlists.')
      setIsAuthenticated(false)
    }
  }, [])

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
          await loadPlaylists()
        }
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'Authentication failed.')
        setIsAuthenticated(false)
      } finally {
        setAuthLoading(false)
      }
    }

    void init()
  }, [loadPlaylists])

  const handleTargetChange = (value: string) => {
    setTargetMinutes(value)
    setTarget(parseMinutesToMs(value))
  }

  const handleLoadPlaylist = async () => {
    setError('')
    const derivedId = extractSpotifyPlaylistId(manualInput)
    const playlistId = selectedPlaylistId || derivedId

    if (!playlistId) {
      setError('Choose a playlist from the list or paste a Spotify playlist URL/ID.')
      return
    }

    setLoading(true)
    setLoadingLabel('Authorizing Spotify session...')
    setLoadingProgress(8)
    try {
      const token = await getValidAccessToken()
      setLoadingLabel('Fetching playlist tracks...')
      setLoadingProgress(35)

      const playlist = await fetchPlaylistWithTracks(token, playlistId)
      const tracks = playlist.tracks

      if (tracks.length === 0) {
        setError('No tracks found in this playlist.')
        return
      }

      const songs = Object.fromEntries(
        tracks.map((t) => [t.id, { ...t, status: 'unknown' as const }]),
      )
      const songOrder = tracks.map((t) => t.id)
      const targetMs = parseMinutesToMs(targetMinutes)
      setLoadingLabel('Building sorting session...')
      setLoadingProgress(92)

      const newSession: SessionState = {
        playlistId,
        playlistName: playlist.name,
        sourceType: 'playlist',
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
      if (err instanceof Error && /denied access to this playlist's tracks|Spotify API request failed: 403/i.test(err.message)) {
        const usedManualInput = !selectedPlaylistId && !!derivedId
        if (usedManualInput) {
          setError('This playlist cannot be read by your current account. It may be private or owned by another user. Try choosing from Your playlists instead.')
          return
        }
      }
      setError(err instanceof Error ? err.message : 'Failed to load playlist.')
    } finally {
      setLoading(false)
      setLoadingProgress(null)
    }
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

  const handleLoadLikedSongs = async () => {
    setError('')
    setLoading(true)
    setLoadingLabel('Authorizing Spotify session...')
    setLoadingProgress(8)
    try {
      const token = await getValidAccessToken()
      setLoadingLabel('Loading liked songs...')
      setLoadingProgress(35)
      const tracks = await fetchLikedTracks(token)

      if (tracks.length === 0) {
        setError('No saved tracks found in Liked Songs.')
        return
      }

      const songs = Object.fromEntries(
        tracks.map((track) => [track.id, { ...track, status: 'unknown' as const }]),
      )
      const songOrder = tracks.map((track) => track.id)
      const targetMs = parseMinutesToMs(targetMinutes)
      setLoadingLabel('Building sorting session...')
      setLoadingProgress(92)

      const newSession: SessionState = {
        playlistId: LIKED_SONGS_SOURCE_ID,
        playlistName: 'Liked Songs',
        sourceType: 'liked',
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
      setError(err instanceof Error ? err.message : 'Failed to load Liked Songs.')
    } finally {
      setLoading(false)
      setLoadingProgress(null)
    }
  }

  const handleReloadPlaylists = () => {
    setAuthError('')
    void loadPlaylists()
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
          {account && (
            <div className="import-block">
              <div className="import-block-header">
                <h2>Connected Spotify account</h2>
              </div>
              <p className="app-subtitle">Signed in as {account.label}</p>
              <p className="app-subtitle">Account ID: {account.id}</p>
              <p className="app-subtitle">Granted scopes: {grantedScope || 'unknown'}</p>
            </div>
          )}

          {playlists.length > 0 && (
            <div className="import-block">
              <div className="import-block-header">
                <h2>Your playlists</h2>
                <button type="button" className="btn-secondary btn-inline" onClick={handleReloadPlaylists}>
                  Reload
                </button>
              </div>
              <select
                className="playlist-select"
                value={selectedPlaylistId}
                onChange={(e) => setSelectedPlaylistId(e.target.value)}
              >
                <option value="">— choose a playlist —</option>
                {playlists.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.total} songs)
                  </option>
                ))}
              </select>
            </div>
          )}

          {playlists.length === 0 && (
            <div className="import-block">
              <div className="import-block-header">
                <h2>Your playlists</h2>
              </div>
              <p className="app-subtitle">
                No playlists were returned for this Spotify account yet.
              </p>
              {account && (
                <p className="app-subtitle">
                  Verify this is the Spotify account you added to your app's User Management.
                </p>
              )}
              <button type="button" className="btn-secondary" onClick={handleReloadPlaylists}>
                Reload playlists
              </button>
            </div>
          )}

          <div className="import-block">
            <div className="import-block-header">
              <h2>Other source</h2>
            </div>
            <p className="app-subtitle">Import your saved tracks if this Spotify account has no playlists.</p>
            <button type="button" className="btn-secondary" disabled={loading} onClick={() => void handleLoadLikedSongs()}>
              {loading ? 'Loading…' : 'Use Liked Songs'}
            </button>
          </div>

          <div className="import-divider">or paste a Spotify playlist link / ID</div>

          <div className="import-block">
            <div className="import-block-header">
              <h2>Playlist URL or ID</h2>
            </div>
            <textarea
              className="id-input"
              rows={2}
              placeholder={'https://open.spotify.com/playlist/...\n37i9dQZF1DXcBWIGoYBM5M'}
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
            />
            <button
              type="button"
              className="btn-secondary"
              disabled={loading}
              onClick={() => void handleLoadPlaylist()}
            >
              {loading ? 'Loading…' : 'Import Playlist'}
            </button>
          </div>

          <div className="import-divider">or paste Spotify track IDs / track URLs</div>

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
            <label htmlFor="targetMin">Target duration (minutes)</label>
            <input
              id="targetMin"
              className="target-input"
              inputMode="decimal"
              value={targetMinutes}
              onChange={(e) => handleTargetChange(e.target.value)}
            />
          </div>

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
              setAccount(null)
              setGrantedScope('')
              setPlaylists([])
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
