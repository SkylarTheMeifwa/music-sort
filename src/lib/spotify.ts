import type { SongCardData } from '../types'

const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize'
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'
const SPOTIFY_API_BASE = 'https://api.spotify.com/v1'
const PKCE_VERIFIER_KEY = 'spotify_pkce_verifier'
const TOKEN_STORAGE_KEY = 'music_sort_spotify_token_v1'
const CLIENT_ID_OVERRIDE_KEY = 'spotify_client_id_override'

const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined

// ── Token storage ────────────────────────────────────────────────────────────

export interface StoredToken {
  accessToken: string
  refreshToken: string | null
  expiresAt: number
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
  const stored = readStoredToken()
  if (!stored) throw new Error('Not authenticated. Please log in with Spotify.')

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

export function getConfiguredSpotifyClientId(): string | undefined {
  const override = localStorage.getItem(CLIENT_ID_OVERRIDE_KEY)?.trim()
  if (override) return override

  const envClientId = CLIENT_ID?.trim()
  return envClientId || undefined
}

export function setSpotifyClientIdOverride(clientId: string | null): void {
  const trimmed = clientId?.trim()
  if (!trimmed) {
    localStorage.removeItem(CLIENT_ID_OVERRIDE_KEY)
    return
  }
  localStorage.setItem(CLIENT_ID_OVERRIDE_KEY, trimmed)
}

function assertClientId(): string {
  const configuredClientId = getConfiguredSpotifyClientId()
  if (!configuredClientId) {
    throw new Error('Missing Spotify Client ID. Set VITE_SPOTIFY_CLIENT_ID or paste a Client ID in the app.')
  }

  return configuredClientId
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
    scope: [
      'playlist-read-private',
      'playlist-read-collaborative',
      'playlist-modify-private',
      'playlist-modify-public',
      'user-read-private',
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
  const response = await fetch(`${SPOTIFY_API_BASE}${endpoint}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })

  if (!response.ok) {
    const text = await response.text()
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

    playlists.push(...page.items)

    if (!page.next) {
      nextEndpoint = ''
      continue
    }

    const nextUrl = new URL(page.next)
    nextEndpoint = `${nextUrl.pathname}${nextUrl.search}`.replace('/v1', '')
  }

  return playlists
}

export async function fetchPlaylistTracks(token: string, playlistId: string): Promise<SongCardData[]> {
  const songs: SongCardData[] = []
  let nextEndpoint = `/playlists/${playlistId}/tracks?limit=100`

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
      if (!track?.id) {
        continue
      }

      songs.push({
        id: `${track.id}_${songs.length}`,
        uri: track.uri,
        name: track.name,
        artists: track.artists.map((artist) => artist.name),
        durationMs: track.duration_ms,
        imageUrl: track.album.images[0]?.url || '',
        previewUrl: track.preview_url,
      })
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
  const data = await spotifyFetch<{ id: string; name: string }>(token, `/playlists/${playlistId}?fields=id,name`)
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
