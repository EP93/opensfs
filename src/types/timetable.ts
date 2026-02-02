/**
 * Timetable type definitions for the Deutsche Bahn-inspired Fahrplan system.
 */

import type { ServiceCategory, TrainTypeId } from './train'

/** Stop in a timetable entry */
export interface TimetableStop {
  /** Station ID */
  stationId: string
  /** Station name (for display) */
  stationName: string
  /** Scheduled arrival time in minutes from midnight (null for origin) */
  arrivalMinutes: number | null
  /** Scheduled departure time in minutes from midnight (null for terminus) */
  departureMinutes: number | null
  /** Platform number (if known) */
  platform: string | null
  /** Whether this is a request stop */
  requestStop: boolean
}

/** A single timetable entry (one train's journey) */
export interface TimetableEntry {
  /** Unique entry ID */
  id: string
  /** Line ID (e.g., "RE7") */
  lineId: string
  /** Train number */
  trainNumber: number
  /** Operating date */
  date: Date
  /** Train type ID */
  typeId: TrainTypeId
  /** Number of units */
  units: number
  /** Ordered list of stops */
  stops: TimetableStop[]
  /** Whether this service is canceled */
  canceled: boolean
}

/** Template for generating Taktfahrplan (interval timetable) */
export interface TaktTemplate {
  /** Minutes after the hour for departure from origin */
  departureMinute: number
  /** Interval in minutes between services (e.g., 60 for hourly) */
  intervalMinutes: number
  /** First hour of operation (0-23) */
  firstHour: number
  /** Last hour of operation (0-23) */
  lastHour: number
  /** Days of operation (0 = Sunday, 6 = Saturday) */
  operatingDays: number[]
}

/** Line definition (route with default timetable pattern) */
export interface LineDefinition {
  /** Line ID (e.g., "RE7") */
  id: string
  /** Full line name (e.g., "RE 7 Rheintalbahn") */
  name: string
  /** Service category */
  category: ServiceCategory
  /** Default train type */
  defaultTypeId: TrainTypeId
  /** Default number of units */
  defaultUnits: number
  /** Primary line color for display */
  color: number
  /** Route: ordered list of station IDs */
  route: string[]
  /** Station names (parallel to route array) */
  stationNames: string[]
  /** Journey times in minutes from origin to each station */
  journeyTimes: number[]
  /** Dwell times at each station in minutes (0 for terminus) */
  dwellTimes: number[]
  /** Taktfahrplan template */
  taktTemplate: TaktTemplate
  /** Whether the line operates in both directions */
  bidirectional: boolean
}

/** Departure board entry */
export interface DepartureBoardEntry {
  /** Line ID */
  lineId: string
  /** Line name/number for display */
  lineDisplay: string
  /** Destination station name */
  destination: string
  /** Scheduled departure time */
  scheduledTime: Date
  /** Expected departure time (with delay) */
  expectedTime: Date
  /** Platform */
  platform: string | null
  /** Delay in minutes */
  delayMinutes: number
  /** Status message (e.g., "On time", "+5 min", "Canceled") */
  status: string
  /** Train ID (if train exists) */
  trainId: string | null
}

/** Arrival board entry */
export interface ArrivalBoardEntry {
  /** Line ID */
  lineId: string
  /** Line name/number for display */
  lineDisplay: string
  /** Origin station name */
  origin: string
  /** Scheduled arrival time */
  scheduledTime: Date
  /** Expected arrival time (with delay) */
  expectedTime: Date
  /** Platform */
  platform: string | null
  /** Delay in minutes */
  delayMinutes: number
  /** Status message */
  status: string
  /** Train ID (if train exists) */
  trainId: string | null
}
