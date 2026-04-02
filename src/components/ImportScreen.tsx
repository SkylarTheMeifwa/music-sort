
import { useEffect, useState } from 'react'
import type { SongData, SongStatus } from '../types'
import { parseMinutesToMs } from '../lib/format'
import { useAppStore } from '../store'

import type { SessionState } from '../types'

export function ImportScreen() {
  const session = useAppStore((s) => s.session)
  const startSession = useAppStore((s) => s.startSession)
  const setView = useAppStore((s) => s.setView)
  const setTarget = useAppStore((s) => s.setTarget)

  const [targetMinutes, setTargetMinutes] = useState('60')
  const [songDataPresent, setSongDataPresent] = useState(false)
  const [songData, setSongData] = useState<SongData[] | null>(null)
  const [songDataSource, setSongDataSource] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null
    const base = import.meta.env.BASE_URL
    const songDataPaths = ['song-data.json', 'song%20data.json', 'song%20data'].map(
      (name) => new URL(name, base).toString(),
    )

    const isValidSongData = (value: unknown): value is SongData[] => {
      if (!Array.isArray(value)) return false
      return value.every((item) => {
        if (!item || typeof item !== 'object') return false
        const row = item as Partial<SongData>
        return (
          typeof row.id === 'string' &&
          typeof row.name === 'string' &&
          Array.isArray(row.artists) &&
          row.artists.every((a) => typeof a === 'string') &&
          typeof row.albumCover === 'string' &&
          typeof row.durationMs === 'number'
        )
      })
    }

    const checkSongData = async () => {
      for (const path of songDataPaths) {
        try {
          const resp = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' })
          if (!resp.ok) continue

          const data: unknown = await resp.json()
          if (!isValidSongData(data)) {
            setSongDataPresent(false)
            setSongData(null)
            setSongDataSource(null)
            setLoadError('Song data file was found, but JSON shape is invalid.')
            return
          }

          setSongDataPresent(true)
          setSongData(data)
          setSongDataSource(path)
          setLoadError(null)
          return
        } catch {
          // Continue trying alternate file names.
        }
      }

      setSongDataPresent(false)
      setSongData(null)
      setSongDataSource(null)
      setLoadError(null)
    }

    checkSongData()
    timer = setInterval(checkSongData, 2000)
    return () => { if (timer) clearInterval(timer) }
  }, [])

  const handleTargetChange = (value: string) => {
    setTargetMinutes(value)
    setTarget(parseMinutesToMs(value))
  }

  if (!songDataPresent) {
    return (
      <section className="screen import-screen">
        <h1 className="app-title">Music Sort</h1>
        <p className="app-subtitle">Place your <b>song-data.json</b> file in <code>public/song-data.json</code> to begin.</p>
        <p className="helper-text">Also accepted: <code>song data.json</code> or <code>song data</code>.</p>
        <p className="helper-text">The app will auto-refresh when the file is added.</p>
        {loadError && <p className="helper-text">{loadError}</p>}
      </section>
    );
  }

  return (
    <section className="screen import-screen">
      <h1 className="app-title">Music Sort</h1>
      <p className="app-subtitle">{songData ? `${songData.length} songs loaded from ${songDataSource ?? 'song data file'}.` : 'Loading song data file...'}</p>
      <div className="target-row">
        <label htmlFor="targetMin">Target duration (HH:MM or minutes)</label>
        <input
          id="targetMin"
          className="target-input"
          inputMode="text"
          placeholder="1:30"
          value={targetMinutes}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleTargetChange(e.target.value)}
        />
      </div>
      <p className="helper-text">Examples: 1:30 = 1 hour 30 min, or 90 = 90 minutes.</p>
      <button
        type="button"
        className="btn-primary"
        disabled={!songData || songData.length === 0}
        onClick={() => {
          if (!songData) return;
          const songs = Object.fromEntries(
            songData.map((track) => [track.id, {
              id: track.id,
              uri: '',
              name: track.name,
              artists: track.artists,
              durationMs: track.durationMs,
              imageUrl: track.albumCover,
              previewUrl: track.previewUrl ?? null,
              status: 'unknown' as SongStatus,
            }])
          );
          const songOrder = songData.map((track) => track.id);
          const targetMs = parseMinutesToMs(targetMinutes);
          const newSession: SessionState = {
            playlistId: 'song-data',
            playlistName: `Song Data Import (${songData.length})`,
            sourceType: 'tracks',
            pass: 1,
            queueIndex: 0,
            passQueueIds: [...songOrder],
            targetMs,
            muted: false,
            songOrder,
            songs,
            history: [],
          };
          startSession(newSession);
        }}
      >
        Start Sorting
      </button>
      {session && (
        <button type="button" className="btn-secondary" onClick={() => setView('swipe')}>
          Resume Saved Session
        </button>
      )}
    </section>
  );
}
