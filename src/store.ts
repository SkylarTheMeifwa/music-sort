import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SessionState, SongStatus, SwipeDecision } from './types'

export type ViewMode = 'import' | 'swipe' | 'results'

interface AppStore {
  session: SessionState | null
  view: ViewMode
  setView: (view: ViewMode) => void
  startSession: (session: SessionState) => void
  setMuted: (muted: boolean) => void
  setTarget: (ms: number) => void
  swipe: (toStatus: Exclude<SongStatus, 'unknown'>) => void
  undo: () => void
  advanceToNextPass: () => void
  clearSession: () => void
  patchSongMeta: (uri: string, artists: string[], durationMs: number) => void
}

function calcYesDuration(songs: SessionState['songs'], order: string[]): number {
  return order.reduce<number>(
    (acc, id) => (songs[id]?.status === 'yes' ? acc + songs[id].durationMs : acc),
    0,
  )
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      session: null,
      view: 'import' as ViewMode,

      setView: (view) => set({ view }),

      startSession: (session) => set({ session, view: 'swipe' }),

      setMuted: (muted) =>
        set((s) => (s.session ? { session: { ...s.session, muted } } : {})),

      setTarget: (targetMs) =>
        set((s) => (s.session ? { session: { ...s.session, targetMs } } : {})),

      swipe: (toStatus) =>
        set((s) => {
          const prev = s.session
          if (!prev) return {}
          const songId = prev.passQueueIds[prev.queueIndex]
          if (!songId) return {}

          const fromStatus = prev.songs[songId].status
          const songs = {
            ...prev.songs,
            [songId]: { ...prev.songs[songId], status: toStatus },
          }

          const decision: SwipeDecision = {
            songId,
            fromStatus,
            toStatus,
            queueIndexBefore: prev.queueIndex,
            passBefore: prev.pass,
            passQueueBefore: [...prev.passQueueIds],
          }

          let queueIndex = prev.queueIndex + 1
          let pass = prev.pass
          let passQueueIds = prev.passQueueIds
          let view: ViewMode = s.view

          const yesMs = calcYesDuration(songs, prev.songOrder)
          const targetReached = prev.targetMs > 0 && yesMs >= prev.targetMs

          if (targetReached) {
            view = 'results'
          } else if (queueIndex >= passQueueIds.length) {
            const remaining = prev.songOrder.filter((id) => songs[id].status !== 'yes')

            if (remaining.length === 0) {
              view = 'results'
            } else {
              pass = prev.pass + 1
              passQueueIds = remaining
              queueIndex = 0
            }
          }

          return {
            view,
            session: {
              ...prev,
              songs,
              queueIndex,
              pass,
              passQueueIds,
              history: [...prev.history, decision],
            },
          }
        }),

      undo: () =>
        set((s) => {
          const prev = s.session
          if (!prev || prev.history.length === 0) return {}
          const last = prev.history[prev.history.length - 1]
          return {
            view: 'swipe' as ViewMode,
            session: {
              ...prev,
              songs: {
                ...prev.songs,
                [last.songId]: { ...prev.songs[last.songId], status: last.fromStatus },
              },
              queueIndex: last.queueIndexBefore,
              pass: last.passBefore,
              passQueueIds: [...last.passQueueBefore],
              history: prev.history.slice(0, -1),
            },
          }
        }),

      advanceToNextPass: () =>
        set((s) => {
          const prev = s.session
          if (!prev) return {}
          const candidates = prev.songOrder.filter((id) => prev.songs[id].status !== 'yes')
          if (candidates.length === 0) return {}
          return {
            view: 'swipe' as ViewMode,
            session: {
              ...prev,
              pass: prev.pass + 1,
              queueIndex: 0,
              passQueueIds: candidates,
            },
          }
        }),

      clearSession: () => set({ session: null, view: 'import' as ViewMode }),

      patchSongMeta: (uri, artists, durationMs) =>
        set((s) => {
          if (!s.session) return {}
          const songId = Object.keys(s.session.songs).find(
            (id) => s.session!.songs[id].uri === uri,
          )
          if (!songId) return {}
          const song = s.session.songs[songId]
          const needsArtists = song.artists.length === 0 || song.artists.every((a) => /^unknown/i.test(a))
          const needsDuration = !song.durationMs || song.durationMs <= 0
          if (!needsArtists && !needsDuration) return {}
          return {
            session: {
              ...s.session,
              songs: {
                ...s.session.songs,
                [songId]: {
                  ...song,
                  artists: needsArtists ? artists : song.artists,
                  durationMs: needsDuration ? durationMs : song.durationMs,
                },
              },
            },
          }
        }),
    }),
    {
      name: 'music-sort-session-v1',
      partialize: (state) => ({ session: state.session, view: state.view }),
    },
  ),
)
