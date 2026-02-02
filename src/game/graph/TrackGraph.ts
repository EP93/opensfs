/**
 * TrackGraph - Network representation of the railway track system.
 * Uses ngraph for graph data structure and pathfinding.
 */

import type { Graph, Link } from 'ngraph.graph'
import createGraph from 'ngraph.graph'
import type { PathFinder as NGraphPathFinder } from 'ngraph.path'
import pathFinder from 'ngraph.path'
import { type LonLat, lonLatToMercator, type Point } from '@/game/utils/geo'
import type { NetworkData, NetworkNodeKind } from '@/types/network'

export interface PlannedStopConstraint {
  stationId: string
  platform: string | null
}

/** Node data stored in the graph */
export interface TrackNodeData {
  /** Node position in world coordinates */
  position: Point
  /** Node position in [lon, lat] */
  lonLat: LonLat
  /** Node kind (track/stop/signal/etc.) */
  kind: NetworkNodeKind
  /** Node degree in the topology graph */
  degree: number
  /** Connected station ID (if this node is near a station) */
  stationId: string | null
  /** Station name (for display) */
  stationName: string | null
}

/** Link (edge) data stored in the graph */
export interface TrackLinkData {
  /** Track segment ID */
  trackId: string
  /** OSM way ID backing this segment (or -1 for synthetic connectors) */
  osmWayId: number
  /** Length in meters */
  length: number
  /** Maximum speed in km/h */
  maxSpeed: number
  /** Whether the track is electrified */
  electrified: boolean
  /** Track usage (main, branch, etc.) */
  usage: string
  /** Service tag (siding, spur, yard, etc.) */
  service: string | null
  /** Railway type (rail, light_rail, etc.) */
  railway: string
  /** Whether this is a synthetic connector edge */
  isConnector: boolean
  /** Coordinates along the track (for rendering) */
  coordinates: Point[]
}

/** Path segment for train navigation */
export interface PathSegment {
  /** Source node ID */
  fromNodeId: string
  /** Target node ID */
  toNodeId: string
  /** Link data */
  link: TrackLinkData
  /** Total distance from path start in meters */
  cumulativeDistance: number
}

/** Complete path result */
export interface PathResult {
  /** Ordered list of path segments */
  segments: PathSegment[]
  /** Total path length in meters */
  totalLength: number
  /** Ordered list of station IDs along the path */
  stations: string[]
  /** Whether the path was found */
  found: boolean
}

/** Position along a path */
export interface PathPosition {
  /** Segment index in the path */
  segmentIndex: number
  /** Offset within the segment in meters */
  segmentOffset: number
  /** Total distance from path start in meters */
  totalOffset: number
  /** World position */
  worldPosition: Point
  /** Heading in radians */
  heading: number
  /** Current track link data */
  linkData: TrackLinkData
}

export class TrackGraph {
  private graph: Graph<TrackNodeData, TrackLinkData>
  private stationNodeMap: Map<string, string> = new Map() // stationId -> nodeId
  private stationStopNodeMap: Map<string, string[]> = new Map() // stationId -> candidate nodeIds
  private stopMetaByNodeId: Map<string, { platformRef: string | null }> = new Map()
  private stationStopsByStationId: Map<
    string,
    Array<{ stationId: string; nodeId: string; platformRef: string | null; world: Point }>
  > = new Map()
  private stationAxisByStationId: Map<string, { center: Point; axis: Point }> = new Map()
  private stationCenterByStationId: Map<string, Point> = new Map()
  private finder: NGraphPathFinder<TrackNodeData> | null = null
  private nodePathCache: Map<string, string[]> = new Map()
  private linkByTrackId: Map<string, TrackLinkData> = new Map()
  private edgeOrientationByTrackId: Map<
    string,
    { fromNodeId: string; toNodeId: string; preferredDirection: 'forward' | 'backward' | null }
  > = new Map()

  constructor() {
    this.graph = createGraph({ multigraph: true })
  }

  /**
   * Build the graph from topological network data
   */
  buildFromNetwork(network: NetworkData): void {
    this.graph.clear()
    this.stationNodeMap.clear()
    this.stationStopNodeMap.clear()
    this.stopMetaByNodeId.clear()
    this.stationStopsByStationId.clear()
    this.stationAxisByStationId.clear()
    this.stationCenterByStationId.clear()
    this.nodePathCache.clear()
    this.linkByTrackId.clear()
    this.edgeOrientationByTrackId.clear()
    this.finder = null

    const signalDirectionByNodeId = new Map<string, 'forward' | 'backward' | 'both'>()
    for (const s of network.signals) {
      signalDirectionByNodeId.set(s.nodeId, s.direction)
    }

    // Nodes
    for (const n of network.nodes) {
      const lonLat: LonLat = [n.lon, n.lat]
      this.graph.addNode(n.id, {
        position: lonLatToMercator(lonLat),
        lonLat,
        kind: n.kind,
        degree: 0,
        stationId: null,
        stationName: null,
      })
    }

    // Edges (bidirectional by default; directionality can be added later).
    for (const edge of network.edges) {
      const fromNodeId = edge.fromNodeId
      const toNodeId = edge.toNodeId

      if (!this.graph.getNode(fromNodeId) || !this.graph.getNode(toNodeId)) continue
      if (edge.geometry.length < 2) continue

      const worldCoords: Point[] = edge.geometry.map(([lon, lat]) =>
        lonLatToMercator([lon, lat] as LonLat)
      )

      const signalDirs = [
        signalDirectionByNodeId.get(fromNodeId),
        signalDirectionByNodeId.get(toNodeId),
      ]
      let forwardSignals = 0
      let backwardSignals = 0
      for (const d of signalDirs) {
        if (!d) continue
        if (d === 'both') {
          forwardSignals++
          backwardSignals++
        } else if (d === 'forward') {
          forwardSignals++
        } else if (d === 'backward') {
          backwardSignals++
        }
      }

      let preferredDirection: 'forward' | 'backward' | null = null
      if (forwardSignals > 0 && backwardSignals === 0) preferredDirection = 'forward'
      if (backwardSignals > 0 && forwardSignals === 0) preferredDirection = 'backward'

      this.edgeOrientationByTrackId.set(edge.id, { fromNodeId, toNodeId, preferredDirection })

      const forwardSpeed = edge.maxSpeedForwardKmh ?? edge.maxSpeedKmh ?? 100
      const backwardSpeed = edge.maxSpeedBackwardKmh ?? edge.maxSpeedKmh ?? 100
      const isConnector =
        edge.osmWayId === -1 || edge.railway === 'connector' || edge.usage === 'connector'

      const linkDataForward: TrackLinkData = {
        trackId: edge.id,
        osmWayId: edge.osmWayId,
        length: edge.lengthM,
        maxSpeed: forwardSpeed,
        electrified: edge.electrified,
        usage: edge.usage,
        service: edge.service,
        railway: edge.railway,
        isConnector,
        coordinates: worldCoords,
      }

      this.graph.addLink(fromNodeId, toNodeId, linkDataForward)
      if (!this.linkByTrackId.has(linkDataForward.trackId)) {
        this.linkByTrackId.set(linkDataForward.trackId, linkDataForward)
      }

      const linkDataBackward: TrackLinkData = {
        ...linkDataForward,
        maxSpeed: backwardSpeed,
        coordinates: [...worldCoords].reverse(),
      }

      this.graph.addLink(toNodeId, fromNodeId, linkDataBackward)
    }

    // Degrees (used for heuristics/penalties)
    this.graph.forEachNode((node) => {
      if (!node.data) return
      const degree = node.links?.size ?? 0
      node.data.degree = degree
    })

    this.finder = pathFinder.aStar(this.graph, {
      oriented: true,
      distance: (fromNode, toNode, link) => {
        if (!link.data) return 1000
        if (!fromNode.data || !toNode.data) return 1000
        return this.getLinkCost(
          String(fromNode.id),
          String(toNode.id),
          fromNode.data,
          toNode.data,
          link.data
        )
      },
    })

    // Associate stations with primary stop targets from the network
    let associatedCount = 0
    let notFoundCount = 0
    for (const station of network.stations) {
      const candidates = [
        ...station.stopNodeIds,
        ...(station.stationNodeId ? [station.stationNodeId] : []),
      ]
      const usable: string[] = []
      const seen = new Set<string>()

      for (const candidate of candidates) {
        if (!candidate) continue
        if (seen.has(candidate)) continue
        if (!this.graph.getNode(candidate)) continue
        seen.add(candidate)
        usable.push(candidate)
      }

      this.stationStopNodeMap.set(station.id, usable)
      const primaryStopNodeId = usable[0]

      if (!primaryStopNodeId) {
        notFoundCount++
        continue
      }

      const node = this.graph.getNode(primaryStopNodeId)
      if (!node?.data) {
        notFoundCount++
        continue
      }
      node.data.stationId = station.id
      node.data.stationName = station.name
      this.stationNodeMap.set(station.id, primaryStopNodeId)
      associatedCount++
    }
    console.log(
      `TrackGraph: ${associatedCount}/${network.stations.length} stations associated with nodes (${notFoundCount} not found)`
    )

    this.buildStationPlatformData(network)
  }

  /**
   * Find the shortest path between two stations
   */
  findPath(fromStationId: string, toStationId: string): PathResult {
    const fromPrimary = this.stationNodeMap.get(fromStationId)
    const toPrimary = this.stationNodeMap.get(toStationId)

    const fromCandidates =
      this.stationStopNodeMap.get(fromStationId) ?? (fromPrimary ? [fromPrimary] : [])
    const toCandidates = this.stationStopNodeMap.get(toStationId) ?? (toPrimary ? [toPrimary] : [])

    if (fromCandidates.length === 0 || toCandidates.length === 0) {
      return { segments: [], totalLength: 0, stations: [], found: false }
    }

    let bestPath: string[] | null = null
    let bestLength = Number.POSITIVE_INFINITY

    for (const fromNodeId of fromCandidates) {
      for (const toNodeId of toCandidates) {
        const path = this.findNodePath(fromNodeId, toNodeId)
        if (!path) continue
        const length = this.getNodePathLength(path)
        if (length < bestLength) {
          bestLength = length
          bestPath = path
        }
      }
    }

    if (!bestPath || bestPath.length < 2 || !Number.isFinite(bestLength)) {
      return { segments: [], totalLength: 0, stations: [], found: false }
    }

    const segments: PathSegment[] = []
    const stations: string[] = []
    let cumulativeDistance = 0

    for (let i = 0; i < bestPath.length - 1; i++) {
      const fromNodeId = bestPath[i]
      const toNodeId = bestPath[i + 1]
      if (!fromNodeId || !toNodeId) continue

      const fromNode = this.graph.getNode(fromNodeId)
      const link = this.getBestLink(fromNodeId, toNodeId)
      if (!link?.data) continue

      segments.push({
        fromNodeId,
        toNodeId,
        link: link.data,
        cumulativeDistance,
      })

      cumulativeDistance += link.data.length

      const stationId = fromNode?.data?.stationId
      if (stationId && !stations.includes(stationId)) {
        stations.push(stationId)
      }
    }

    const lastNodeId = bestPath[bestPath.length - 1]
    if (lastNodeId) {
      const lastNode = this.graph.getNode(lastNodeId)
      const stationId = lastNode?.data?.stationId
      if (stationId && !stations.includes(stationId)) {
        stations.push(stationId)
      }
    }

    return { segments, totalLength: cumulativeDistance, stations, found: true }
  }

  private getBestLink(fromNodeId: string, toNodeId: string): Link<TrackLinkData> | null {
    const links = this.graph.getLinks(fromNodeId)
    if (!links) return null

    let best: Link<TrackLinkData> | null = null
    let bestCost = Number.POSITIVE_INFINITY
    let bestLength = Number.POSITIVE_INFINITY

    const fromNode = this.graph.getNode(fromNodeId)
    const toNode = this.graph.getNode(toNodeId)
    const fromData = fromNode?.data
    const toData = toNode?.data

    for (const link of links) {
      const candidate = link as Link<TrackLinkData>
      if (String(candidate.toId) !== toNodeId) continue
      if (!candidate.data) continue

      const length = candidate.data.length
      const cost =
        fromData && toData
          ? this.getLinkCost(fromNodeId, toNodeId, fromData, toData, candidate.data)
          : length

      if (
        cost < bestCost ||
        (cost === bestCost && length < bestLength) ||
        (cost === bestCost && length === bestLength && best === null)
      ) {
        best = candidate
        bestCost = cost
        bestLength = length
      }
    }

    return best
  }

  private findNodePath(fromNodeId: string, toNodeId: string): string[] | null {
    if (!this.finder) return null
    if (!this.graph.getNode(fromNodeId) || !this.graph.getNode(toNodeId)) return null

    const key = `${fromNodeId}|${toNodeId}`
    const cached = this.nodePathCache.get(key)
    if (cached) return cached

    const path = this.finder.find(fromNodeId, toNodeId)
    if (path.length < 2) return null

    // ngraph.path returns nodes in reverse order (target to source)
    const ordered = path
      .slice()
      .reverse()
      .map((n) => String(n.id))

    if (this.nodePathCache.size > 10_000) this.nodePathCache.clear()
    this.nodePathCache.set(key, ordered)

    return ordered
  }

  private getNodePathLength(nodeIds: string[]): number {
    let total = 0
    for (let i = 0; i < nodeIds.length - 1; i++) {
      const fromId = nodeIds[i]
      const toId = nodeIds[i + 1]
      if (!fromId || !toId) continue
      const link = this.getBestLink(fromId, toId)
      if (!link?.data) return Number.POSITIVE_INFINITY
      total += link.data.length
    }
    return total
  }

  private getNodePathCost(nodeIds: string[]): number {
    let total = 0
    for (let i = 0; i < nodeIds.length - 1; i++) {
      const fromId = nodeIds[i]
      const toId = nodeIds[i + 1]
      if (!fromId || !toId) continue
      const fromNode = this.graph.getNode(fromId)
      const toNode = this.graph.getNode(toId)
      const link = this.getBestLink(fromId, toId)
      if (!fromNode?.data || !toNode?.data || !link?.data) return Number.POSITIVE_INFINITY
      total += this.getLinkCost(fromId, toId, fromNode.data, toNode.data, link.data)
    }
    return total
  }

  private getLinkCost(
    fromNodeId: string,
    toNodeId: string,
    from: TrackNodeData,
    to: TrackNodeData,
    link: TrackLinkData
  ): number {
    let cost = link.length

    // Strongly discourage synthetic connectors (only used to attach off-track special nodes).
    if (link.isConnector) cost += 5000

    // Prefer mainline rail over other rail modes for now (prevents odd tram/subway shortcuts).
    if (link.railway !== 'rail') cost += 10000

    // Discourage non-main service tracks (siding/spur/yard) unless necessary.
    if (link.service && link.service !== 'main') cost += 250

    // Prefer travelling in the direction suggested by real-world signal tagging (OpenRailwayMap / OSM).
    const orientation = this.edgeOrientationByTrackId.get(link.trackId)
    if (orientation?.preferredDirection) {
      const isForwardTraversal =
        fromNodeId === orientation.fromNodeId && toNodeId === orientation.toNodeId
      if (orientation.preferredDirection === 'forward' && !isForwardTraversal) cost += 5000
      if (orientation.preferredDirection === 'backward' && isForwardTraversal) cost += 5000
    }

    // Discourage short crossover-like segments at switches (reduces random side-switching).
    const junctionDegreesHigh = from.degree >= 3 && to.degree >= 3
    const isSwitchToSwitch = from.kind === 'switch' && to.kind === 'switch'
    const looksLikeCrossover = junctionDegreesHigh && link.length < 250
    if (looksLikeCrossover) cost += 2000

    // Additional crossover penalty for longer switch-to-switch connectors (common in double-track crossovers).
    // Without this, A* can still pick “Z” crossovers if they are longer than the short-link heuristic.
    const looksLikeMediumCrossover = junctionDegreesHigh && link.length < 900
    if (looksLikeMediumCrossover) cost += 3000

    const looksLikeLongCrossover = junctionDegreesHigh && isSwitchToSwitch && link.length < 900
    if (looksLikeLongCrossover) cost += 2000

    return cost
  }

  /**
   * Build a path that follows the given stop order (stop-to-stop).
   * Returns a single concatenated PathResult plus offsets where each stop is reached.
   */
  buildPathForStops(stopStationIds: string[]): { path: PathResult; stopOffsets: number[] } {
    const effectiveStops = stopStationIds.filter((id) => id.trim().length > 0)
    if (effectiveStops.length < 2) {
      return { path: { segments: [], totalLength: 0, stations: [], found: false }, stopOffsets: [] }
    }

    const plannedStops: PlannedStopConstraint[] = effectiveStops.map((stationId) => ({
      stationId,
      platform: null,
    }))
    const result = this.buildPathForPlannedStops(plannedStops)
    return { path: result.path, stopOffsets: result.stopOffsets }
  }

  buildPathForPlannedStops(
    stops: PlannedStopConstraint[],
    destinationStationId?: string
  ): { path: PathResult; stopOffsets: number[]; chosenStopNodeIds: string[] } {
    const effectiveStops = stops
      .map((s) => ({
        stationId: s.stationId.trim(),
        platform: s.platform && s.platform.trim().length > 0 ? s.platform.trim() : null,
      }))
      .filter((s) => s.stationId.length > 0)

    if (effectiveStops.length < 2) {
      return {
        path: { segments: [], totalLength: 0, stations: [], found: false },
        stopOffsets: [],
        chosenStopNodeIds: [],
      }
    }

    const destinationId =
      destinationStationId?.trim() && destinationStationId.trim().length > 0
        ? destinationStationId.trim()
        : effectiveStops[effectiveStops.length - 1]?.stationId

    const attempt = (opts: {
      applyPlatformFilter: boolean
      applySideFilter: boolean
    }): { path: PathResult; stopOffsets: number[]; chosenStopNodeIds: string[] } | null => {
      const maxCandidatesPerStop = 6
      const stopCandidates = effectiveStops.map((stop) =>
        this.getStationStopCandidates(stop.stationId, {
          platformHint: opts.applyPlatformFilter ? stop.platform : null,
          destinationStationId: opts.applySideFilter ? (destinationId ?? null) : null,
          maxCandidates: maxCandidatesPerStop,
        })
      )

      if (stopCandidates.some((c) => c.length === 0)) return null

      const chosenStopNodeIds = this.chooseStopNodesDP(stopCandidates)
      if (!chosenStopNodeIds) return null

      const segments: PathResult['segments'] = []
      const stopOffsets: number[] = [0]
      let cumulativeDistance = 0

      for (let i = 0; i < chosenStopNodeIds.length - 1; i++) {
        const fromNodeId = chosenStopNodeIds[i]
        const toNodeId = chosenStopNodeIds[i + 1]
        if (!fromNodeId || !toNodeId) continue

        const nodePath = this.findNodePath(fromNodeId, toNodeId)
        if (!nodePath) return null

        const { legSegments, legLength } = this.buildSegmentsFromNodePath(
          nodePath,
          cumulativeDistance
        )
        for (const seg of legSegments) segments.push(seg)
        cumulativeDistance += legLength
        stopOffsets.push(cumulativeDistance)
      }

      return {
        path: {
          segments,
          totalLength: cumulativeDistance,
          stations: effectiveStops.map((s) => s.stationId),
          found: segments.length > 0,
        },
        stopOffsets,
        chosenStopNodeIds,
      }
    }

    const primary =
      attempt({ applyPlatformFilter: true, applySideFilter: true }) ??
      attempt({ applyPlatformFilter: true, applySideFilter: false }) ??
      attempt({ applyPlatformFilter: false, applySideFilter: false })

    if (primary) return primary

    return {
      path: { segments: [], totalLength: 0, stations: [], found: false },
      stopOffsets: [],
      chosenStopNodeIds: [],
    }
  }

  private buildSegmentsFromNodePath(
    nodePath: string[],
    cumulativeStart: number
  ): { legSegments: PathSegment[]; legLength: number } {
    const legSegments: PathSegment[] = []
    let cumulativeDistance = cumulativeStart
    let legLength = 0

    for (let i = 0; i < nodePath.length - 1; i++) {
      const fromNodeId = nodePath[i]
      const toNodeId = nodePath[i + 1]
      if (!fromNodeId || !toNodeId) continue

      const link = this.getBestLink(fromNodeId, toNodeId)
      if (!link?.data) continue

      legSegments.push({
        fromNodeId,
        toNodeId,
        link: link.data,
        cumulativeDistance,
      })

      cumulativeDistance += link.data.length
      legLength += link.data.length
    }

    return { legSegments, legLength }
  }

  /**
   * Get position along a path at a given offset
   */
  getPositionOnPath(path: PathResult, offsetMeters: number): PathPosition | null {
    if (!path.found || path.segments.length === 0) return null

    // Clamp offset to path bounds
    const clampedOffset = Math.max(0, Math.min(offsetMeters, path.totalLength))

    // Find the segment containing this offset
    let segmentIndex = 0
    for (let i = 0; i < path.segments.length; i++) {
      const segment = path.segments[i]
      if (!segment) continue

      const segmentEnd = segment.cumulativeDistance + segment.link.length
      if (clampedOffset <= segmentEnd) {
        segmentIndex = i
        break
      }
    }

    const segment = path.segments[segmentIndex]
    if (!segment) return null

    const segmentOffset = clampedOffset - segment.cumulativeDistance
    const coords = segment.link.coordinates

    // Interpolate position along the segment
    const { position, heading } = this.interpolatePosition(
      coords,
      segmentOffset,
      segment.link.length
    )

    return {
      segmentIndex,
      segmentOffset,
      totalOffset: clampedOffset,
      worldPosition: position,
      heading,
      linkData: segment.link,
    }
  }

  /**
   * Find which station a position is at (or near)
   */
  getStationAtPosition(path: PathResult, offsetMeters: number, threshold = 50): string | null {
    const pos = this.getPositionOnPath(path, offsetMeters)
    if (!pos) return null

    const segment = path.segments[pos.segmentIndex]
    if (!segment) return null

    // Check if near start of segment (at fromNode)
    if (pos.segmentOffset < threshold) {
      const fromNode = this.graph.getNode(segment.fromNodeId)
      if (fromNode?.data?.stationId) {
        return fromNode.data.stationId
      }
    }

    // Check if near end of segment (at toNode)
    if (segment.link.length - pos.segmentOffset < threshold) {
      const toNode = this.graph.getNode(segment.toNodeId)
      if (toNode?.data?.stationId) {
        return toNode.data.stationId
      }
    }

    return null
  }

  /**
   * Get distance to next station on a path
   */
  getDistanceToNextStation(
    path: PathResult,
    currentOffsetMeters: number,
    currentStationIndex: number
  ): { stationId: string; distance: number } | null {
    if (currentStationIndex >= path.stations.length - 1) return null

    const nextStationId = path.stations[currentStationIndex + 1]
    if (!nextStationId) return null

    const nextNodeId = this.stationNodeMap.get(nextStationId)
    if (!nextNodeId) return null

    // Find the segment ending at this station
    for (const segment of path.segments) {
      if (segment.toNodeId === nextNodeId) {
        const stationOffset = segment.cumulativeDistance + segment.link.length
        return {
          stationId: nextStationId,
          distance: stationOffset - currentOffsetMeters,
        }
      }
    }

    return null
  }

  /**
   * Get node ID for a station
   */
  getStationNodeId(stationId: string): string | undefined {
    return this.stationNodeMap.get(stationId)
  }

  /**
   * Get all station IDs in the graph
   */
  getStationIds(): string[] {
    return Array.from(this.stationNodeMap.keys())
  }

  getNodeWorldPosition(nodeId: string): Point | null {
    const node = this.graph.getNode(nodeId)
    if (!node?.data) return null
    return node.data.position
  }

  getTrackCoordinates(trackId: string): Point[] | null {
    const link = this.linkByTrackId.get(trackId)
    return link?.coordinates ?? null
  }

  getStopPlatformRef(nodeId: string): string | null {
    return this.stopMetaByNodeId.get(nodeId)?.platformRef ?? null
  }

  getNodeIdsByKind(kind: NetworkNodeKind): string[] {
    const out: string[] = []
    this.graph.forEachNode((node) => {
      if (!node.data) return
      if (node.data.kind !== kind) return
      out.push(String(node.id))
    })
    return out
  }

  /**
   * Get graph statistics
   */
  getStats(): { nodeCount: number; linkCount: number; stationCount: number } {
    let linkCount = 0
    this.graph.forEachLink(() => {
      linkCount++
    })

    return {
      nodeCount: this.graph.getNodeCount(),
      linkCount: linkCount / 2, // Divide by 2 since we add bidirectional links
      stationCount: this.stationNodeMap.size,
    }
  }

  // Private helper methods

  private interpolatePosition(
    coords: Point[],
    offsetMeters: number,
    totalLength: number
  ): { position: Point; heading: number } {
    if (coords.length === 0) {
      return { position: [0, 0], heading: 0 }
    }

    if (coords.length === 1) {
      const coord = coords[0]
      return { position: coord ? [...coord] : [0, 0], heading: 0 }
    }

    // Calculate cumulative distances for each segment
    const segmentLengths: number[] = []
    let cumulativeLength = 0

    for (let i = 0; i < coords.length - 1; i++) {
      const from = coords[i]
      const to = coords[i + 1]
      if (!from || !to) continue

      const dx = to[0] - from[0]
      const dy = to[1] - from[1]
      const segmentLength = Math.sqrt(dx * dx + dy * dy)
      segmentLengths.push(segmentLength)
      cumulativeLength += segmentLength
    }

    // Scale factor to match actual length
    const scale = totalLength / (cumulativeLength || 1)
    const targetOffset = offsetMeters

    // Find the segment containing the offset
    let currentOffset = 0
    for (let i = 0; i < segmentLengths.length; i++) {
      const segmentLength = (segmentLengths[i] ?? 0) * scale
      const segmentEnd = currentOffset + segmentLength

      if (targetOffset <= segmentEnd || i === segmentLengths.length - 1) {
        const from = coords[i]
        const to = coords[i + 1]

        if (!from || !to) {
          const fallback = coords[0]
          return { position: fallback ? [...fallback] : [0, 0], heading: 0 }
        }

        const t = segmentLength > 0 ? (targetOffset - currentOffset) / segmentLength : 0
        const clampedT = Math.max(0, Math.min(1, t))

        const x = from[0] + (to[0] - from[0]) * clampedT
        const y = from[1] + (to[1] - from[1]) * clampedT

        // Calculate heading (angle from from to to)
        const heading = Math.atan2(to[1] - from[1], to[0] - from[0])

        return { position: [x, y], heading }
      }

      currentOffset = segmentEnd
    }

    // Fallback to last coordinate
    const lastCoord = coords[coords.length - 1]
    const secondLastCoord = coords[coords.length - 2]

    if (lastCoord && secondLastCoord) {
      const heading = Math.atan2(
        lastCoord[1] - secondLastCoord[1],
        lastCoord[0] - secondLastCoord[0]
      )
      return { position: [...lastCoord], heading }
    }

    return { position: lastCoord ? [...lastCoord] : [0, 0], heading: 0 }
  }

  private buildStationPlatformData(network: NetworkData): void {
    const tagsByNodeId = new Map<string, Record<string, string>>()
    for (const n of network.nodes) {
      if (n.tags) tagsByNodeId.set(n.id, n.tags)
    }

    for (const station of network.stations) {
      const stationCenter = lonLatToMercator([station.lon, station.lat] as LonLat)
      this.stationCenterByStationId.set(station.id, stationCenter)

      const candidateNodeIds = this.stationStopNodeMap.get(station.id) ?? []
      const stops: Array<{
        stationId: string
        nodeId: string
        platformRef: string | null
        world: Point
      }> = []

      for (const nodeId of candidateNodeIds) {
        const node = this.graph.getNode(nodeId)
        if (!node?.data) continue

        const tags = tagsByNodeId.get(nodeId)
        const platformRef = this.extractPlatformRef(tags)
        this.stopMetaByNodeId.set(nodeId, { platformRef })

        stops.push({
          stationId: station.id,
          nodeId,
          platformRef,
          world: node.data.position,
        })
      }

      this.stationStopsByStationId.set(station.id, stops)
    }

    this.computeStationAxes()
  }

  private computeStationAxes(): void {
    const minNeighborDistanceMeters = 30

    for (const [stationId, stops] of this.stationStopsByStationId.entries()) {
      if (stops.length === 0) continue

      let centerX = 0
      let centerY = 0
      for (const s of stops) {
        centerX += s.world[0]
        centerY += s.world[1]
      }
      const center: Point = [centerX / stops.length, centerY / stops.length]

      const vectors: Array<[number, number]> = []
      for (const stop of stops) {
        const links = this.graph.getLinks(stop.nodeId)
        if (!links) continue

        for (const link of links) {
          const l = link as Link<TrackLinkData>
          const data = l.data
          if (!data) continue
          if (data.isConnector) continue
          if (data.railway !== 'rail') continue

          const toId = String(l.toId)
          const neighbor = this.graph.getNode(toId)
          if (!neighbor?.data) continue

          const dx = neighbor.data.position[0] - stop.world[0]
          const dy = neighbor.data.position[1] - stop.world[1]
          const len = Math.hypot(dx, dy)
          if (len < minNeighborDistanceMeters) continue
          vectors.push([dx / len, dy / len])
        }
      }

      if (vectors.length === 0) continue

      const seed = vectors[0] ?? [1, 0]
      let sumX = 0
      let sumY = 0
      for (const v of vectors) {
        const dot = seed[0] * v[0] + seed[1] * v[1]
        const vx = dot < 0 ? -v[0] : v[0]
        const vy = dot < 0 ? -v[1] : v[1]
        sumX += vx
        sumY += vy
      }

      const sumLen = Math.hypot(sumX, sumY)
      if (sumLen < 1e-6) continue

      const axis: Point = [sumX / sumLen, sumY / sumLen]
      this.stationAxisByStationId.set(stationId, { center, axis })
    }
  }

  private getStationStopCandidates(
    stationId: string,
    opts: {
      platformHint: string | null
      destinationStationId: string | null
      maxCandidates: number
    }
  ): string[] {
    const stops = this.stationStopsByStationId.get(stationId) ?? []
    const usableStops = stops.filter((s) => this.graph.getNode(s.nodeId))

    const normalizedHint = opts.platformHint ? this.normalizePlatform(opts.platformHint) : null
    let candidates = normalizedHint
      ? usableStops.filter((s) => {
          const ref = s.platformRef ? this.normalizePlatform(s.platformRef) : null
          return ref !== null && ref === normalizedHint
        })
      : usableStops

    if (candidates.length === 0) {
      candidates = usableStops
    }

    if (opts.destinationStationId) {
      const rightSide = this.filterRightSideCandidates(
        stationId,
        candidates,
        opts.destinationStationId
      )
      if (rightSide.length > 0) candidates = rightSide
    }

    const limited = candidates.slice(0, Math.max(1, opts.maxCandidates))
    return limited.map((c) => c.nodeId)
  }

  private filterRightSideCandidates(
    stationId: string,
    candidates: Array<{
      stationId: string
      nodeId: string
      platformRef: string | null
      world: Point
    }>,
    destinationStationId: string
  ): Array<{ stationId: string; nodeId: string; platformRef: string | null; world: Point }> {
    const axisInfo = this.stationAxisByStationId.get(stationId)
    if (!axisInfo) return []

    const destCenter =
      this.stationAxisByStationId.get(destinationStationId)?.center ??
      this.stationCenterByStationId.get(destinationStationId)
    if (!destCenter) return []

    const center = axisInfo.center
    let axisX = axisInfo.axis[0]
    let axisY = axisInfo.axis[1]

    const destVecX = destCenter[0] - center[0]
    const destVecY = destCenter[1] - center[1]
    const dot = axisX * destVecX + axisY * destVecY
    if (dot < 0) {
      axisX = -axisX
      axisY = -axisY
    }

    const epsilonMeters = 1
    const right: typeof candidates = []
    for (const c of candidates) {
      const ox = c.world[0] - center[0]
      const oy = c.world[1] - center[1]
      const lateral = axisX * oy - axisY * ox
      if (lateral < -epsilonMeters) right.push(c)
    }
    return right
  }

  private chooseStopNodesDP(stopCandidates: string[][]): string[] | null {
    // Dynamic programming across stops to avoid flip-flopping between parallel tracks.
    const dpCosts: number[][] = stopCandidates.map(() => [])
    const dpPrev: number[][] = stopCandidates.map(() => [])

    const firstCandidates = stopCandidates[0]
    if (!firstCandidates || firstCandidates.length === 0) return null
    dpCosts[0] = firstCandidates.map(() => 0)
    dpPrev[0] = firstCandidates.map(() => -1)

    for (let i = 0; i < stopCandidates.length - 1; i++) {
      const fromList = stopCandidates[i]
      const toList = stopCandidates[i + 1]
      if (!fromList || !toList) return null

      dpCosts[i + 1] = toList.map(() => Number.POSITIVE_INFINITY)
      dpPrev[i + 1] = toList.map(() => -1)
      const nextCosts = dpCosts[i + 1]
      const nextPrev = dpPrev[i + 1]

      for (let a = 0; a < fromList.length; a++) {
        const fromNodeId = fromList[a]
        if (!fromNodeId) continue
        const baseCost = dpCosts[i]?.[a] ?? Number.POSITIVE_INFINITY
        if (!Number.isFinite(baseCost)) continue

        for (let b = 0; b < toList.length; b++) {
          const toNodeId = toList[b]
          if (!toNodeId) continue

          const nodePath = this.findNodePath(fromNodeId, toNodeId)
          if (!nodePath) continue

          const legCost = this.getNodePathCost(nodePath)
          if (!Number.isFinite(legCost)) continue

          const candidateCost = baseCost + legCost
          if (candidateCost < (nextCosts?.[b] ?? Number.POSITIVE_INFINITY)) {
            if (nextCosts) nextCosts[b] = candidateCost
            if (nextPrev) nextPrev[b] = a
          }
        }
      }
    }

    const lastCosts = dpCosts[dpCosts.length - 1] ?? []
    let bestLastIndex = -1
    let bestLastCost = Number.POSITIVE_INFINITY
    for (let i = 0; i < lastCosts.length; i++) {
      const c = lastCosts[i]
      if (c !== undefined && c < bestLastCost) {
        bestLastCost = c
        bestLastIndex = i
      }
    }

    if (bestLastIndex === -1) return null

    const chosenStopNodeIds: string[] = new Array(stopCandidates.length)
    let cursor = bestLastIndex
    for (let i = stopCandidates.length - 1; i >= 0; i--) {
      const list = stopCandidates[i]
      if (!list) return null
      const chosen = list[cursor]
      if (!chosen) return null
      chosenStopNodeIds[i] = chosen
      cursor = dpPrev[i]?.[cursor] ?? -1
      if (i > 0 && cursor === -1) return null
    }

    return chosenStopNodeIds
  }

  private extractPlatformRef(tags: Record<string, string> | undefined): string | null {
    const direct =
      this.cleanString(tags?.['local_ref']) ??
      this.cleanString(tags?.['ref']) ??
      this.cleanString(tags?.['ref:IFOPT:description'])
    if (direct) return direct

    const description = this.cleanString(tags?.['description'])
    if (!description) return null

    const match = description.match(/(?:Gleis|Platform)\s*([0-9]+[a-zA-Z]?)/)
    return match?.[1] ? match[1] : null
  }

  private normalizePlatform(value: string): string | null {
    const cleaned = this.cleanString(value)
    if (!cleaned) return null

    const gleisMatch = cleaned.match(/(?:gleis|platform)\s*([0-9]+[a-zA-Z]?)/i)
    if (gleisMatch?.[1]) return gleisMatch[1].toUpperCase()

    const bare = cleaned.match(/^([0-9]+[a-zA-Z]?)$/)
    if (bare?.[1]) return bare[1].toUpperCase()

    const anyDigits = cleaned.match(/([0-9]+[a-zA-Z]?)/)
    if (anyDigits?.[1]) return anyDigits[1].toUpperCase()

    return cleaned.toUpperCase()
  }

  private cleanString(value: unknown): string | null {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
}
