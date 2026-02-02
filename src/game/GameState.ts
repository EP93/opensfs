import type { GameTime, PlayerResources, SelectedEntity, Station, Track, Train } from '@/types/game'

export class GameState {
  time: GameTime
  resources: PlayerResources
  stations: Map<string, Station>
  tracks: Map<string, Track>
  trains: Map<string, Train>
  selectedEntity: SelectedEntity | null

  constructor() {
    this.time = {
      tick: 0,
      speed: 1,
      paused: false,
      date: new Date(2024, 0, 1, 6, 0), // Start at 6:00 AM
    }

    this.resources = {
      money: 10_000_000, // Start with 10 million
      reputation: 50,
    }

    this.stations = new Map()
    this.tracks = new Map()
    this.trains = new Map()
    this.selectedEntity = null
  }

  tick(): void {
    this.time.tick += 1

    // Each tick represents 1 second of game time
    // Speed multiplier affects how fast time passes
    const gameSeconds = this.time.speed
    this.time.date = new Date(this.time.date.getTime() + gameSeconds * 1000)

    // Update trains
    for (const train of this.trains.values()) {
      this.updateTrain(train)
    }
  }

  private updateTrain(train: Train): void {
    if (train.state !== 'moving') return

    // Simple movement along track
    const track = this.tracks.get(train.currentTrackId)
    if (!track) return

    // Calculate total track length
    const trackLength = track.segments.reduce((sum, seg) => sum + seg.length, 0)

    // Move train
    const distancePerTick = (train.speed / 3600) * this.time.speed // km per tick at current speed
    train.position += distancePerTick * train.direction

    // Check if reached end of track
    if (train.position >= trackLength) {
      train.position = trackLength
      train.state = 'stopped'
    } else if (train.position <= 0) {
      train.position = 0
      train.state = 'stopped'
    }
  }

  setTimeSpeed(speed: number): void {
    // 1x = 1 in-game second per real second; 60x = 1 in-game minute per real second.
    this.time.speed = Math.max(0, Math.min(60, speed))
  }

  togglePause(): void {
    this.time.paused = !this.time.paused
  }

  selectEntity(entity: SelectedEntity | null): void {
    this.selectedEntity = entity
  }

  addStation(station: Station): void {
    this.stations.set(station.id, station)
  }

  addTrack(track: Track): void {
    this.tracks.set(track.id, track)
  }

  addTrain(train: Train): void {
    this.trains.set(train.id, train)
  }

  removeTrain(trainId: string): void {
    this.trains.delete(trainId)
  }

  getFormattedTime(): string {
    return this.time.date.toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  getFormattedDate(): string {
    return this.time.date.toLocaleDateString('de-DE', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  }
}
