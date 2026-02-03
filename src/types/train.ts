/**
 * Train type definitions for the railway system.
 * Supports rolling stock from multiple countries with detailed specifications.
 */

/** Train type identifier (e.g., "BR462", "TGV-Duplex", "ETR500") */
export type TrainTypeId = string

/** Train service category */
export type ServiceCategory =
  | 'ICE'
  | 'IC'
  | 'EC'
  | 'TGV'
  | 'RE'
  | 'RB'
  | 'S'
  | 'IR'
  | 'TER'
  | 'Freight'

/** Traction type */
export type TractionType = 'electric' | 'diesel' | 'diesel-electric' | 'hybrid' | 'battery'

/** Bogie type */
export type BogieType = 'Jacobs' | 'conventional' | 'articulated' | 'tilting'

/** Train operational state */
export type OperationalState =
  | 'depot' // In depot, not active
  | 'preparing' // Getting ready to depart
  | 'departing' // Accelerating from station
  | 'running' // En route between stations
  | 'approaching' // Decelerating toward station
  | 'at_station' // Stopped at station
  | 'turnaround' // Parked at station awaiting next assignment
  | 'terminated' // Service ended

/** Position on the track network */
export interface TrackPosition {
  /** Track segment ID */
  trackId: string
  /** Offset in meters from start of track */
  offset: number
  /** Direction: 1 = forward (increasing offset), -1 = backward */
  direction: 1 | -1
}

/** World position for rendering */
export interface WorldPosition {
  /** Web Mercator X coordinate */
  x: number
  /** Web Mercator Y coordinate */
  y: number
  /** Heading angle in radians (0 = east, PI/2 = north) */
  heading: number
}

/** Physical specifications */
export interface TrainSpecifications {
  /** Length in meters */
  length: number
  /** Width in meters */
  width: number
  /** Height in meters */
  height: number
  /** Weight in tonnes */
  weight: number
  /** Number of axles */
  axles: number
  /** Bogie type */
  bogieType: BogieType
  /** Bogie spacing in meters */
  bogieSpacing: number
  /** Wheel diameter in mm */
  wheelDiameter: number
}

/** Performance characteristics */
export interface TrainPerformance {
  /** Maximum design speed in km/h */
  maxSpeed: number
  /** Maximum operational speed in km/h */
  maxOperationalSpeed: number
  /** Acceleration in m/s² */
  acceleration: number
  /** Service braking deceleration in m/s² */
  deceleration: number
  /** Emergency braking deceleration in m/s² */
  emergencyDeceleration: number
  /** Power output in kW */
  powerOutput: number
  /** Traction type */
  tractionType: TractionType
  /** Supported voltage systems */
  voltages: string[]
  /** Adhesion coefficient */
  adhesionCoefficient: number
}

/** Passenger capacity */
export interface TrainCapacity {
  /** First class seats */
  seatedFirstClass: number
  /** Second class seats */
  seatedSecondClass: number
  /** Standing capacity */
  standing: number
  /** Wheelchair spaces */
  wheelchairSpaces: number
  /** Bicycle spaces */
  bicycleSpaces: number
}

/** Passenger capacity for a single car */
export interface TrainCarCapacity {
  /** First class seats */
  seatedFirstClass: number
  /** Second class seats */
  seatedSecondClass: number
  /** Standing capacity */
  standing: number
  /** Wheelchair spaces */
  wheelchairSpaces: number
  /** Bicycle spaces */
  bicycleSpaces: number
}

/** Single-car specification (per unit) */
export interface TrainCarSpec {
  /** Car identifier within a unit (e.g., "A", "B") */
  id: string
  /** Car class */
  class: 'first' | 'second' | 'mixed'
  /** Car kind */
  kind: 'standard' | 'cab' | 'bistro' | 'bike' | 'accessible'
  /** Length in meters */
  lengthMeters: number
  /** Passenger capacity */
  capacity: TrainCarCapacity
}

/** Live occupancy for a car */
export interface TrainCarOccupancy {
  seatedFirstClass: number
  seatedSecondClass: number
  standing: number
  total: number
  loadRatio: number
}

/** Car instance within a consist */
export interface TrainCarInstance {
  /** Sequential car number (1..N) */
  number: number
  /** Car identifier within the unit */
  id: string
  /** Class */
  class: TrainCarSpec['class']
  /** Kind */
  kind: TrainCarSpec['kind']
  /** Length in meters */
  lengthMeters: number
  /** Center offset from the front of the consist in meters */
  offsetFromFrontMeters: number
  /** Passenger capacity */
  capacity: TrainCarCapacity
  /** Live occupancy */
  occupancy: TrainCarOccupancy
}

/** Coupling configuration */
export interface TrainCoupling {
  /** Whether the train can be coupled to form multiple units */
  canCouple: boolean
  /** Maximum number of coupled units */
  maxCoupledUnits: number
  /** Coupler type (e.g., "Scharfenberg", "Screw") */
  couplerType: string
  /** Whether coupling is automatic */
  automaticCoupling: boolean
}

/** Visual appearance */
export interface TrainAppearance {
  /** Primary color (hex string) */
  primaryColor: string
  /** Secondary color (hex string) */
  secondaryColor: string
  /** Accent color (hex string) */
  accentColor: string
  /** Livery name */
  livery: string
  /** Sprite ID for rendering */
  spriteId: string
}

/** Onboard features */
export interface TrainFeatures {
  /** Air conditioning */
  airConditioning: boolean
  /** WiFi */
  wifi: boolean
  /** Power outlets */
  powerOutlets: boolean
  /** Passenger information display type */
  passengerInformation: 'LED' | 'LCD' | 'none'
  /** Accessibility level */
  accessibility: 'full' | 'partial' | 'none'
  /** Number of toilets */
  toilets: number
  /** Bistro/restaurant car */
  bistro: boolean
  /** First class available */
  firstClass: boolean
}

/** Complete train type specification (loaded from JSON) */
export interface TrainTypeSpec {
  /** Unique identifier */
  id: TrainTypeId
  /** Full name (e.g., "Desiro HC") */
  name: string
  /** Manufacturer */
  manufacturer: string
  /** Country code (ISO 3166-1 alpha-2) */
  country: string
  /** Operating company */
  operator: string
  /** Service categories this type is used for */
  serviceCategories: ServiceCategory[]
  /** Physical specifications */
  specifications: TrainSpecifications
  /** Performance characteristics */
  performance: TrainPerformance
  /** Passenger capacity */
  capacity: TrainCapacity
  /** Optional per-car definitions (single unit) */
  cars?: TrainCarSpec[]
  /** Coupling configuration */
  coupling: TrainCoupling
  /** Visual appearance */
  appearance: TrainAppearance
  /** Onboard features */
  features: TrainFeatures
}

/** Train consist (actual train composition) */
export interface TrainConsist {
  /** Train type specification */
  typeSpec: TrainTypeSpec
  /** Number of coupled units */
  units: number
  /** Cars making up this consist (expanded by unit) */
  cars: TrainCarInstance[]
  /** Total length in meters */
  totalLength: number
  /** Total seated capacity (first + second class) */
  totalSeatedCapacity: number
  /** Total standing capacity */
  totalStandingCapacity: number
  /** Total first class seats */
  totalFirstClassSeats: number
  /** Total wheelchair spaces */
  totalWheelchairSpaces: number
  /** Total bicycle spaces */
  totalBicycleSpaces: number
}

/** Active train state */
export interface TrainState {
  /** Unique train ID (e.g., "RE7-1234-20240101") */
  id: string
  /** Train consist */
  consist: TrainConsist
  /** Line ID (e.g., "RE7", "RB27") */
  lineId: string
  /** Train number within the line */
  trainNumber: number
  /** Scheduled departure time of the first stop */
  scheduledDeparture: Date
  /** Timetable entry ID backing this service */
  timetableEntryId: string
  /** Stop node ID of the platform/stop position last used (for service chaining) */
  lastStopNodeId: string | null
  /** When this train becomes available for a new service (for service chaining) */
  availableForServiceAt: Date | null
  /** Current position on track */
  trackPosition: TrackPosition
  /** Calculated world position for rendering */
  worldPosition: WorldPosition
  /** Current speed in km/h */
  currentSpeed: number
  /** Target speed in km/h */
  targetSpeed: number
  /** Operational state */
  state: OperationalState
  /** Current timetable entry index */
  currentStopIndex: number
  /** Delay in seconds (positive = late, negative = early) */
  delay: number
  /** Passengers currently on board */
  passengers: number
  /** Load factor (0..1) */
  loadFactor: number
  /** Origin station ID */
  originStationId: string
  /** Destination station ID */
  destinationStationId: string
  /** Path (ordered list of track IDs) from current position to destination */
  path: string[]
  /** Current position within the path */
  pathIndex: number
  /** Distance traveled on current path segment in meters */
  pathSegmentOffset: number
}

/** Train spawn request (for timetable system) */
export interface TrainSpawnRequest {
  /** Train type ID */
  typeId: TrainTypeId
  /** Number of units */
  units: number
  /** Line ID */
  lineId: string
  /** Train number */
  trainNumber: number
  /** Origin station ID */
  originStationId: string
  /** Destination station ID */
  destinationStationId: string
  /** Scheduled departure time (Date) */
  scheduledDeparture: Date
}
