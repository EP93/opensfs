/**
 * Network Types - Topological rail network derived from Overpass raw JSON.
 *
 * This format is used for pathfinding, signalling, and (optionally) rendering.
 */

export type OSMNodeId = number
export type OSMWayId = number

export type NetworkNodeKind = 'track' | 'station' | 'stop' | 'signal' | 'switch' | 'buffer_stop'

export interface NetworkNode {
  id: string // `osm:n:${OSMNodeId}`
  osmNodeId: OSMNodeId
  lon: number
  lat: number
  kind: NetworkNodeKind
  tags?: Record<string, string>
}

export interface NetworkEdge {
  id: string // `osm:w:${OSMWayId}:${index}`
  osmWayId: OSMWayId
  fromNodeId: string
  toNodeId: string
  railway: string
  usage: string
  service: string | null
  electrified: boolean
  maxSpeedKmh: number | null
  maxSpeedForwardKmh: number | null
  maxSpeedBackwardKmh: number | null
  lengthM: number
  geometry: Array<[number, number]> // lon/lat polyline including endpoints
}

export interface StationRecord {
  id: string // `station-node/${OSMNodeId}` (matches existing lineDefinitions)
  name: string
  lon: number
  lat: number
  stationNodeId: string | null
  stopNodeIds: string[]
}

export interface SignalRecord {
  id: string // `osm:n:${OSMNodeId}`
  nodeId: string
  direction: 'forward' | 'backward' | 'both'
}

export interface NetworkData {
  version: 1
  region: string
  nodes: NetworkNode[]
  edges: NetworkEdge[]
  stations: StationRecord[]
  signals: SignalRecord[]
}
