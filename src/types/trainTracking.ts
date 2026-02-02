import type { OperationalState } from '@/types/train'

export interface TrainCarSnapshot {
  number: number
  id: string
  class: 'first' | 'second' | 'mixed'
  kind: 'standard' | 'cab' | 'bistro' | 'bike' | 'accessible'
  lengthMeters: number
  capacity: {
    seatedFirstClass: number
    seatedSecondClass: number
    standing: number
    wheelchairSpaces: number
    bicycleSpaces: number
  }
  occupancy: {
    seatedFirstClass: number
    seatedSecondClass: number
    standing: number
    total: number
    loadRatio: number
  }
  status: 'low' | 'medium' | 'high' | 'crowded'
}

export interface TrainLiveSnapshot {
  id: string
  lineId: string
  trainNumber: number
  typeName: string
  units: number
  totalLengthMeters: number
  totalSeatedCapacity: number
  totalStandingCapacity: number
  loadFactor: number
  state: OperationalState
  currentStopIndex: number
  currentSpeedKmh: number
  delaySeconds: number
  scheduledDeparture: Date
  timetableEntryId: string
  originStationId: string
  destinationStationId: string
  worldX: number
  worldY: number
  headingRad: number
  cars: TrainCarSnapshot[]
}
