export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '0:00'
  }

  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function formatDurationHm(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '0:00:00'
  }

  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

export function parseMinutesToMs(minutes: string): number {
  const input = minutes.trim()
  if (!input) {
    return 0
  }

  // Support HH:MM (or H:MM) input.
  if (input.includes(':')) {
    const parts = input.split(':')
    if (parts.length !== 2) {
      return 0
    }

    const [hoursPart, minsPart] = parts.map((part) => part.trim())
    if (!/^\d+$/.test(hoursPart) || !/^\d+$/.test(minsPart)) {
      return 0
    }

    const hours = Number(hoursPart)
    const mins = Number(minsPart)
    if (!Number.isFinite(hours) || !Number.isFinite(mins) || mins < 0 || mins >= 60) {
      return 0
    }

    return (hours * 60 + mins) * 60_000
  }

  // Backward-compatible: plain minutes (e.g., "90" or "90.5").
  const parsed = Number(input)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0
  }

  return Math.round(parsed * 60_000)
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
