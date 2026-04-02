
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

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null
    const checkSongData = async () => {
      try {
        const resp = await fetch('/song-data.json')
        if (resp.ok) {
          const data = await resp.json()
          setSongDataPresent(true)
          setSongData(data)
        } else {
          setSongDataPresent(false)
          setSongData(null)
        }
      } catch {
        setSongDataPresent(false)
        setSongData(null)
      }
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
        <p className="helper-text">The app will auto-refresh when the file is added.</p>
      </section>
    );
  }

  return (
    <section className="screen import-screen">
      <h1 className="app-title">Music Sort</h1>
      <p className="app-subtitle">{songData ? `${songData.length} songs loaded from song-data.json.` : 'Loading song-data.json...'}</p>
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
              previewUrl: track.previewUrl,
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
