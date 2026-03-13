export type SongStatus = 'unknown' | 'yes' | 'maybe' | 'no'

export interface SongCardData {
  id: string
  uri: string
  name: string
  artists: string[]
  durationMs: number
  imageUrl: string
  previewUrl: string | null
}

export interface SortedSong extends SongCardData {
  status: SongStatus
}

export interface SwipeDecision {
  songId: string
  fromStatus: SongStatus
  toStatus: Exclude<SongStatus, 'unknown'>
  queueIndexBefore: number
  passBefore: number
  passQueueBefore: string[]
}

export interface SessionState {
  playlistId: string
  playlistName: string
  pass: number
  queueIndex: number
  passQueueIds: string[]
  targetMs: number
  muted: boolean
  songOrder: string[]
  songs: Record<string, SortedSong>
  history: SwipeDecision[]
}
