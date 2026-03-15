import type { SongCardData } from '../types'

const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize'
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'
const SPOTIFY_API_BASE = 'https://api.spotify.com/v1'
const PKCE_VERIFIER_KEY = 'spotify_pkce_verifier'
const TOKEN_STORAGE_KEY = 'music_sort_spotify_token_v1'
export const LIKED_SONGS_SOURCE_ID = 'liked-songs'
export const MANUAL_TRACKS_SOURCE_ID = 'manual-tracks'

const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined

// ── Token storage ────────────────────────────────────────────────────────────

export interface StoredToken {
  accessToken: string
  refreshToken: string | null
  expiresAt: number
  clientId: string
  scope: string
}

export interface SpotifyProfile {
  id: string
  display_name: string | null
  email?: string
}

export interface CreatedSpotifyPlaylist {
  id: string
  name: string
  externalUrl: string | null
}

function getRequiredScopes(): string[] {
  return [
    'playlist-read-private',
    'playlist-read-collaborative',
    'playlist-modify-private',
    'playlist-modify-public',
    'user-library-read',
    'user-read-private',
  ]
}

function getMissingScopes(scope: string): string[] {
  const granted = new Set(scope.split(/\s+/).filter(Boolean))
  return getRequiredScopes().filter((requiredScope) => !granted.has(requiredScope))
}

export function readStoredToken(): StoredToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as StoredToken
  } catch {
    return null
  }
}

export function writeStoredToken(token: StoredToken): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(token))
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY)
}

export async function getValidAccessToken(): Promise<string> {
  const clientId = assertClientId()
  const stored = readStoredToken()
  if (!stored) throw new Error('Not authenticated. Please log in with Spotify.')

  if (!stored.clientId || stored.clientId !== clientId) {
    clearStoredToken()
    throw new Error('Spotify app configuration changed. Please log in with Spotify again.')
  }

  if (!stored.scope || getMissingScopes(stored.scope).length > 0) {
    clearStoredToken()
    throw new Error('Spotify permissions are incomplete. Please log in with Spotify again and approve access.')
  }

  if (stored.expiresAt > Date.now() + 30_000) return stored.accessToken

  if (!stored.refreshToken) {
    clearStoredToken()
    throw new Error('Session expired. Please log in again.')
  }

  const refreshed = await refreshSpotifyToken(stored.refreshToken)
  const next: StoredToken = {
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token ?? stored.refreshToken,
    expiresAt: Date.now() + refreshed.expires_in * 1000,
    clientId,
    scope: refreshed.scope || stored.scope,
  }
  writeStoredToken(next)
  return next.accessToken
}

interface SpotifyToken {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token?: string
  scope: string
}

interface SpotifyPlaylist {
  id: string
  name: string
  tracks: {
    total: number
  }
}

interface SpotifyTrackItem {
  track: {
    id: string | null
    uri: string
    name: string
    duration_ms: number
    preview_url: string | null
    artists: Array<{ name: string }>
    album: { images: Array<{ url: string }> }
  } | null
}

interface SpotifyTrack {
  id: string | null
  uri: string
  name: string
  duration_ms: number
  preview_url: string | null
  artists: Array<{ name: string }>
  album: { images: Array<{ url: string }> }
}

function toSongCardData(track: SpotifyTrack, index: number): SongCardData {
  return {
    id: `${track.id}_${index}`,
    uri: track.uri,
    name: track.name,
    artists: track.artists.map((artist) => artist.name),
    durationMs: track.duration_ms,
    imageUrl: track.album.images[0]?.url || '',
    previewUrl: track.preview_url,
  }
}

function appendTrackItems(items: SpotifyTrackItem[], songs: SongCardData[]): void {
  for (const item of items) {
    const track = item.track
    if (!track?.id) continue

    songs.push(toSongCardData(track, songs.length))
  }
}

function assertClientId(): string {
  if (!CLIENT_ID) {
    throw new Error('Missing VITE_SPOTIFY_CLIENT_ID in environment variables.')
  }

  return CLIENT_ID
}

export function getRedirectUri(): string {
  if (import.meta.env.VITE_SPOTIFY_REDIRECT_URI) {
    return import.meta.env.VITE_SPOTIFY_REDIRECT_URI as string
  }
  // Spotify forbids 'localhost' — replace with explicit 127.0.0.1 for dev
  const origin = window.location.origin.replace('localhost', '127.0.0.1')
  return `${origin}${import.meta.env.BASE_URL}`
}

function generateRandomString(length: number): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const values = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(values)
    .map((x) => possible[x % possible.length])
    .join('')
}

async function sha256(plain: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder()
  const data = encoder.encode(plain)
  return window.crypto.subtle.digest('SHA-256', data)
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function generateCodeChallenge(codeVerifier: string): Promise<string> {
  const hashed = await sha256(codeVerifier)
  return base64UrlEncode(hashed)
}

export async function startSpotifyLogin(): Promise<void> {
  const clientId = assertClientId()
  const codeVerifier = generateRandomString(64)
  const codeChallenge = await generateCodeChallenge(codeVerifier)
  const state = generateRandomString(16)

  localStorage.setItem(PKCE_VERIFIER_KEY, codeVerifier)
  sessionStorage.setItem('spotify_oauth_state', state)

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: getRedirectUri(),
    show_dialog: 'true',
    scope: [
      ...getRequiredScopes(),
    ].join(' '),
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    state,
  })

  window.location.href = `${SPOTIFY_AUTH_URL}?${params.toString()}`
}

export async function exchangeCodeForToken(code: string): Promise<SpotifyToken> {
  const clientId = assertClientId()
  const codeVerifier = localStorage.getItem(PKCE_VERIFIER_KEY)

  if (!codeVerifier) {
    throw new Error('Missing PKCE code verifier. Please log in again.')
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: getRedirectUri(),
    client_id: clientId,
    code_verifier: codeVerifier,
  })

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Spotify token exchange failed: ${text}`)
  }

  const token = (await response.json()) as SpotifyToken
  localStorage.removeItem(PKCE_VERIFIER_KEY)
  return token
}

export async function refreshSpotifyToken(refreshToken: string): Promise<SpotifyToken> {
  const clientId = assertClientId()

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  })

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Spotify token refresh failed: ${text}`)
  }

  return (await response.json()) as SpotifyToken
}

async function spotifyFetch<T>(token: string, endpoint: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('Authorization', `Bearer ${token}`)
  if (init?.body != null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${SPOTIFY_API_BASE}${endpoint}`, {
    ...init,
    headers,
  })

  if (!response.ok) {
    const text = await response.text()
    let spotifyMessage = ''
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } }
      spotifyMessage = parsed.error?.message?.trim() || ''
    } catch {
      spotifyMessage = ''
    }

    if (response.status === 401) {
      clearStoredToken()
      throw new Error('Spotify session expired or invalid. Please log in with Spotify again.')
    }

    if (response.status === 403) {
      const details = spotifyMessage || text || 'Forbidden'
      if (endpoint.includes('/playlists/') && endpoint.includes('/tracks')) {
        throw new Error(
          `Spotify denied access to this playlist's tracks (${details}). If you pasted a playlist URL/ID, the playlist may be private or unavailable to this account. Try selecting from Your playlists first. Also confirm this account is added under app User Management and that redirect URI ${getRedirectUri()} is configured. Then log out and log in again.`,
        )
      }

      throw new Error(
        `Spotify access was denied (${details}). Confirm this Spotify account is added under app User Management and that redirect URI ${getRedirectUri()} is configured. Then log out and log in again.`,
      )
    }

    throw new Error(`Spotify API request failed: ${response.status} ${text}`)
  }

  return (await response.json()) as T
}

export async function fetchUserPlaylists(token: string): Promise<SpotifyPlaylist[]> {
  const playlists: SpotifyPlaylist[] = []
  let nextEndpoint = '/me/playlists?limit=50'

  while (nextEndpoint) {
    const page = await spotifyFetch<{
      items: SpotifyPlaylist[]
      next: string | null
    }>(token, nextEndpoint)

    playlists.push(...page.items.filter((p) => p != null && p.tracks != null))

    if (!page.next) {
      nextEndpoint = ''
      continue
    }

    const nextUrl = new URL(page.next)
    nextEndpoint = `${nextUrl.pathname}${nextUrl.search}`.replace('/v1', '')
  }

  return playlists
}

export async function fetchCurrentSpotifyProfile(token: string): Promise<SpotifyProfile> {
  return spotifyFetch<SpotifyProfile>(token, '/me')
}

export function getStoredScope(): string {
  return readStoredToken()?.scope || ''
}

export async function fetchPlaylistTracks(token: string, playlistId: string): Promise<SongCardData[]> {
  const songs: SongCardData[] = []
  let nextEndpoint = `/playlists/${playlistId}/tracks?limit=100&market=from_token`

  return fetchPlaylistTrackPages(token, nextEndpoint, songs)
}

async function fetchPlaylistTrackPages(
  token: string,
  initialEndpoint: string,
  songs: SongCardData[] = [],
): Promise<SongCardData[]> {
  let nextEndpoint = initialEndpoint

  while (nextEndpoint) {
    const page = await spotifyFetch<{
      items: SpotifyTrackItem[]
      next: string | null
    }>(token, nextEndpoint)

    appendTrackItems(page.items, songs)

    if (!page.next) {
      nextEndpoint = ''
      continue
    }

    const nextUrl = new URL(page.next)
    nextEndpoint = `${nextUrl.pathname}${nextUrl.search}`.replace('/v1', '')
    if (!nextUrl.searchParams.has('market')) {
      nextEndpoint += `${nextUrl.search ? '&' : '?'}market=from_token`
    }
  }

  return songs
}

export async function fetchPlaylistWithTracks(
  token: string,
  playlistId: string,
): Promise<{ id: string; name: string; tracks: SongCardData[] }> {
  const firstPage = await spotifyFetch<{
    id: string
    name: string
    tracks: {
      items: SpotifyTrackItem[]
      next: string | null
    }
  }>(
    token,
    `/playlists/${playlistId}?market=from_token&fields=id,name,tracks.items(track(id,uri,name,duration_ms,preview_url,artists(name),album(images(url)))),tracks.next`,
  )

  const tracks: SongCardData[] = []
  appendTrackItems(firstPage.tracks.items, tracks)

  if (firstPage.tracks.next) {
    const nextUrl = new URL(firstPage.tracks.next)
    let nextEndpoint = `${nextUrl.pathname}${nextUrl.search}`.replace('/v1', '')
    if (!nextUrl.searchParams.has('market')) {
      nextEndpoint += `${nextUrl.search ? '&' : '?'}market=from_token`
    }
    await fetchPlaylistTrackPages(token, nextEndpoint, tracks)
  }

  return {
    id: firstPage.id,
    name: firstPage.name,
    tracks,
  }
}

export async function fetchLikedTracks(token: string): Promise<SongCardData[]> {
  const songs: SongCardData[] = []
  let nextEndpoint = '/me/tracks?limit=50'

  while (nextEndpoint) {
    const page = await spotifyFetch<{
      items: Array<{
        track: {
          id: string | null
          uri: string
          name: string
          duration_ms: number
          preview_url: string | null
          artists: Array<{ name: string }>
          album: { images: Array<{ url: string }> }
        } | null
      }>
      next: string | null
    }>(token, nextEndpoint)

    for (const item of page.items) {
      const track = item.track
      if (!track?.id) continue

      songs.push(toSongCardData(track, songs.length))
    }

    if (!page.next) {
      nextEndpoint = ''
      continue
    }

    const nextUrl = new URL(page.next)
    nextEndpoint = `${nextUrl.pathname}${nextUrl.search}`.replace('/v1', '')
  }

  return songs
}

export async function fetchPlaylistMeta(
  token: string,
  playlistId: string,
): Promise<{ id: string; name: string }> {
  const data = await spotifyFetch<{ id: string; name: string }>(token, `/playlists/${playlistId}?market=from_token&fields=id,name`)
  return { id: data.id, name: data.name }
}

export async function removeTracksFromPlaylist(
  token: string,
  playlistId: string,
  uris: string[],
): Promise<void> {
  for (let i = 0; i < uris.length; i += 100) {
    const chunk = uris.slice(i, i + 100)
    await spotifyFetch<{ snapshot_id: string }>(token, `/playlists/${playlistId}/tracks`, {
      method: 'DELETE',
      body: JSON.stringify({ tracks: chunk.map((uri) => ({ uri })) }),
    })
  }
}

export async function createSpotifyPlaylist(
  token: string,
  options: { name: string; description?: string; isPublic?: boolean },
): Promise<CreatedSpotifyPlaylist> {
  const profile = await fetchCurrentSpotifyProfile(token)
  const playlist = await spotifyFetch<{
    id: string
    name: string
    external_urls?: { spotify?: string }
  }>(token, `/users/${profile.id}/playlists`, {
    method: 'POST',
    body: JSON.stringify({
      name: options.name,
      description: options.description || '',
      public: options.isPublic ?? false,
    }),
  })

  return {
    id: playlist.id,
    name: playlist.name,
    externalUrl: playlist.external_urls?.spotify ?? null,
  }
}

export async function addTracksToPlaylist(
  token: string,
  playlistId: string,
  uris: string[],
): Promise<void> {
  for (let i = 0; i < uris.length; i += 100) {
    const chunk = uris.slice(i, i + 100)
    await spotifyFetch<{ snapshot_id: string }>(token, `/playlists/${playlistId}/tracks`, {
      method: 'POST',
      body: JSON.stringify({ uris: chunk }),
    })
  }
}

export async function createSpotifyPlaylistFromTracks(
  token: string,
  options: { name: string; description?: string; isPublic?: boolean; uris: string[] },
): Promise<CreatedSpotifyPlaylist> {
  const playlist = await createSpotifyPlaylist(token, options)
  if (options.uris.length > 0) {
    await addTracksToPlaylist(token, playlist.id, options.uris)
  }
  return playlist
}

export function extractSpotifyTrackIds(input: string): string[] {
  const tokens = input
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter(Boolean)

  const ids: string[] = []
  const seen = new Set<string>()

  for (const token of tokens) {
    let trackId: string | null = null

    if (/^[a-zA-Z0-9]{22}$/.test(token)) {
      trackId = token
    } else {
      try {
        const url = new URL(token)
        const parts = url.pathname.split('/').filter(Boolean)
        const trackIndex = parts.findIndex((part) => part === 'track')
        if (trackIndex >= 0 && parts[trackIndex + 1]) {
          trackId = parts[trackIndex + 1]
        }
      } catch {
        trackId = null
      }
    }

    if (trackId && !seen.has(trackId)) {
      seen.add(trackId)
      ids.push(trackId)
    }
  }

  return ids
}

export async function fetchTracksByIds(token: string, trackIds: string[]): Promise<SongCardData[]> {
  const songs: SongCardData[] = []

  for (let i = 0; i < trackIds.length; i += 50) {
    const chunk = trackIds.slice(i, i + 50)
    const page = await spotifyFetch<{ tracks: Array<SpotifyTrack | null> }>(
      token,
      `/tracks?ids=${encodeURIComponent(chunk.join(','))}&market=from_token`,
    )

    for (const track of page.tracks) {
      if (!track?.id) continue
      songs.push(toSongCardData(track, songs.length))
    }
  }

  return songs
}

export function extractSpotifyPlaylistId(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) {
    return null
  }

  if (/^[a-zA-Z0-9]+$/.test(trimmed)) {
    return trimmed
  }

  try {
    const url = new URL(trimmed)
    const parts = url.pathname.split('/').filter(Boolean)
    const playlistIndex = parts.findIndex((part) => part === 'playlist')
    if (playlistIndex >= 0 && parts[playlistIndex + 1]) {
      return parts[playlistIndex + 1]
    }
  } catch {
    return null
  }

  return null
}
