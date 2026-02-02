/** Geographic coordinate */
export interface Coordinate {
  lat: number
  lon: number
}

/** A railway station */
export interface Station {
  id: string
  name: string
  position: Coordinate
  type: 'main' | 'regional' | 'local' | 'halt'
  platforms: number
  connectedTracks: string[]
}

/** A segment of track between two points */
export interface TrackSegment {
  id: string
  from: Coordinate
  to: Coordinate
  geometry: Coordinate[]
  length: number
  maxSpeed: number
  electrified: boolean
  trackType: 'main' | 'branch' | 'siding' | 'yard'
}

/** A complete track connecting stations */
export interface Track {
  id: string
  segments: TrackSegment[]
  stations: string[]
  name?: string
}

/** Train configuration */
export interface TrainConfig {
  id: string
  name: string
  type: 'ice' | 'ic' | 're' | 'rb' | 's-bahn' | 'freight'
  maxSpeed: number
  acceleration: number
  capacity: number
  length: number
  color: string
}

/** Active train on the network */
export interface Train {
  id: string
  config: TrainConfig
  currentTrackId: string
  position: number
  speed: number
  direction: 1 | -1
  state: 'moving' | 'stopped' | 'loading' | 'waiting'
  schedule: TrainScheduleEntry[]
  currentScheduleIndex: number
}

/** Train schedule entry */
export interface TrainScheduleEntry {
  stationId: string
  arrivalTime?: number
  departureTime?: number
  platform?: number
}

/** Game time state */
export interface GameTime {
  tick: number
  speed: number
  paused: boolean
  date: Date
}

/** Player resources */
export interface PlayerResources {
  money: number
  reputation: number
}

/** Complete game state */
export interface GameState {
  time: GameTime
  resources: PlayerResources
  stations: Map<string, Station>
  tracks: Map<string, Track>
  trains: Map<string, Train>
  selectedEntity: SelectedEntity | null
}

/** Selected entity reference */
export type SelectedEntity =
  | { type: 'station'; id: string }
  | { type: 'train'; id: string }
  | { type: 'track'; id: string }

/** Camera/viewport state */
export interface Viewport {
  x: number
  y: number
  zoom: number
  width: number
  height: number
}
