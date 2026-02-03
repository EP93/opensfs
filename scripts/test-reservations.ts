/**
 * Deterministic reservation tests for section direction locks + junction locks.
 *
 * Usage: bun run scripts/test-reservations.ts
 */

import assert from 'node:assert/strict'
import { type PathResult, TrackGraph, type TrackLinkData } from '../src/game/graph/TrackGraph'
import { TrackReservationSystem } from '../src/game/systems/TrackReservationSystem'
import type { NetworkData, NetworkEdge, NetworkNode } from '../src/types/network'

function makeNode(id: string, kind: NetworkNode['kind']): NetworkNode {
  return { id, osmNodeId: 0, lon: 0, lat: 0, kind }
}

function makeEdge(id: string, fromNodeId: string, toNodeId: string, lengthM: number): NetworkEdge {
  return {
    id,
    osmWayId: 0,
    fromNodeId,
    toNodeId,
    railway: 'rail',
    usage: 'main',
    service: null,
    electrified: false,
    maxSpeedKmh: 100,
    maxSpeedForwardKmh: 100,
    maxSpeedBackwardKmh: 100,
    lengthM,
    geometry: [
      [0, 0],
      [0.001, 0.001],
    ],
  }
}

function makeLink(trackId: string, length: number): TrackLinkData {
  return {
    trackId,
    osmWayId: 0,
    length,
    maxSpeed: 100,
    electrified: false,
    usage: 'main',
    service: null,
    railway: 'rail',
    isConnector: false,
    coordinates: [
      [0, 0],
      [1, 1],
    ],
  }
}

function makePath(
  segments: Array<{ from: string; to: string; trackId: string; length: number }>
): PathResult {
  let cumulativeDistance = 0
  const out: PathResult['segments'] = []
  for (const s of segments) {
    out.push({
      fromNodeId: s.from,
      toNodeId: s.to,
      link: makeLink(s.trackId, s.length),
      cumulativeDistance,
    })
    cumulativeDistance += s.length
  }

  return { segments: out, totalLength: cumulativeDistance, stations: [], found: true }
}

function testSectionDirectionLock(): void {
  const nodes: NetworkNode[] = [
    makeNode('A', 'switch'),
    makeNode('M', 'track'),
    makeNode('B', 'switch'),
  ]
  const edges: NetworkEdge[] = [makeEdge('e1', 'A', 'M', 100), makeEdge('e2', 'M', 'B', 100)]

  const network: NetworkData = {
    version: 1,
    region: 'test-section-lock',
    nodes,
    edges,
    stations: [],
    signals: [],
  }

  const graph = new TrackGraph()
  graph.buildFromNetwork(network)
  const reservationSystem = new TrackReservationSystem(graph)

  const train1Path = makePath([
    { from: 'A', to: 'M', trackId: 'e1', length: 100 },
    { from: 'M', to: 'B', trackId: 'e2', length: 100 },
  ])

  const train2Path = makePath([
    { from: 'B', to: 'M', trackId: 'e2', length: 100 },
    { from: 'M', to: 'A', trackId: 'e1', length: 100 },
  ])

  reservationSystem.setTrainPath('T1')
  const t1 = reservationSystem.updateTrain('T1', train1Path, 0, 0, 50, 0)
  assert.equal(t1.blockedAtOffset, null)
  assert.equal(t1.blockedReason, null)

  reservationSystem.setTrainPath('T2')
  const t2 = reservationSystem.updateTrain('T2', train2Path, 0, 0, 50, 0)
  assert.equal(t2.blockedAtOffset, 0)
  assert.equal(t2.blockedBlockId, 'e2')
  assert.equal(t2.blockedReason, 'section_direction')
  assert.equal(t2.blockedByTrainId, 'T1')
  assert.ok(t2.blockedResourceId?.startsWith('section:') ?? false)
}

function testJunctionLock(): void {
  const nodes: NetworkNode[] = [
    makeNode('A', 'track'),
    makeNode('B', 'track'),
    makeNode('C', 'track'),
    makeNode('J', 'switch'),
  ]
  const edges: NetworkEdge[] = [
    makeEdge('eJA', 'J', 'A', 100),
    makeEdge('eJB', 'J', 'B', 100),
    makeEdge('eJC', 'J', 'C', 100),
  ]
  const network: NetworkData = {
    version: 1,
    region: 'test-junction-lock',
    nodes,
    edges,
    stations: [],
    signals: [],
  }

  const graph = new TrackGraph()
  graph.buildFromNetwork(network)
  const reservationSystem = new TrackReservationSystem(graph)

  const train1Path = makePath([
    { from: 'A', to: 'J', trackId: 'eJA', length: 100 },
    { from: 'J', to: 'B', trackId: 'eJB', length: 100 },
  ])

  const train2Path = makePath([
    { from: 'C', to: 'J', trackId: 'eJC', length: 100 },
    { from: 'J', to: 'A', trackId: 'eJA', length: 100 },
  ])

  reservationSystem.setTrainPath('T1')
  const t1 = reservationSystem.updateTrain('T1', train1Path, 0, 0, 250, 0)
  assert.equal(t1.blockedReason, null)

  reservationSystem.setTrainPath('T2')
  const t2 = reservationSystem.updateTrain('T2', train2Path, 0, 0, 250, 0)
  assert.equal(t2.blockedAtOffset, 100)
  assert.equal(t2.blockedReason, 'junction')
  assert.equal(t2.blockedResourceId, 'J')
  assert.equal(t2.blockedByTrainId, 'T1')
}

testSectionDirectionLock()
testJunctionLock()
console.log('Reservation tests passed.')
