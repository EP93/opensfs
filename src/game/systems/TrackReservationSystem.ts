/**
 * TrackReservationSystem - Fixed-block reservations on top of a PathResult.
 *
 * This is a first-pass signalling model:
 * - Each path segment's `link.trackId` is treated as a block.
 * - A train must reserve blocks ahead; if it cannot reserve the next block, it must stop.
 */

import type { PathResult, TrackGraph } from '@/game/graph/TrackGraph'

export interface ReservationUpdate {
  blockedAtOffset: number | null
  blockedBlockId: string | null
  blockedByTrainId: string | null
  blockedReason: 'block' | 'section_direction' | 'junction' | null
  blockedResourceId: string | null
}

interface TrainReservationState {
  reservedBlocks: Set<string>
  reservedNodes: Set<string>
  releaseCursor: number
}

export class TrackReservationSystem {
  private trackGraph: TrackGraph
  private reservedByBlockId: Map<string, string> = new Map() // blockId -> trainId
  private reservedByNodeId: Map<string, string> = new Map() // nodeId -> trainId
  private sectionLockDirection: Map<string, 'forward' | 'backward'> = new Map() // sectionId -> dir
  private sectionLockOwner: Map<string, string> = new Map() // sectionId -> trainId
  private sectionReservedCount: Map<string, number> = new Map() // sectionId -> count of reserved blocks
  private trainState: Map<string, TrainReservationState> = new Map()

  constructor(trackGraph: TrackGraph) {
    this.trackGraph = trackGraph
  }

  setTrainPath(trainId: string): void {
    this.clearTrain(trainId)
    this.trainState.set(trainId, {
      reservedBlocks: new Set(),
      reservedNodes: new Set(),
      releaseCursor: 0,
    })
  }

  clearTrain(trainId: string): void {
    const state = this.trainState.get(trainId)
    if (state) {
      for (const blockId of Array.from(state.reservedBlocks)) {
        this.releaseBlock(trainId, blockId)
      }
      for (const nodeId of Array.from(state.reservedNodes)) {
        this.releaseNode(trainId, nodeId)
      }
    } else {
      for (const [blockId, owner] of this.reservedByBlockId.entries()) {
        if (owner === trainId) this.releaseBlock(trainId, blockId)
      }
      for (const [nodeId, owner] of this.reservedByNodeId.entries()) {
        if (owner === trainId) this.releaseNode(trainId, nodeId)
      }
    }

    this.trainState.delete(trainId)
  }

  getReservedBy(blockId: string): string | undefined {
    return this.reservedByBlockId.get(blockId)
  }

  getAnyBlockStopOwner(blockId: string, viewerTrainId?: string): string | null {
    const owner = this.reservedByBlockId.get(blockId)
    if (owner && owner !== viewerTrainId) return owner

    const sectionId = this.trackGraph.getSectionId(blockId)
    if (!sectionId) return null
    const lockOwner = this.sectionLockOwner.get(sectionId)
    if (lockOwner && lockOwner !== viewerTrainId) return lockOwner

    return null
  }

  getReservations(): Array<{ blockId: string; trainId: string }> {
    const out: Array<{ blockId: string; trainId: string }> = []
    for (const [blockId, trainId] of this.reservedByBlockId.entries()) {
      out.push({ blockId, trainId })
    }
    return out
  }

  updateTrain(
    trainId: string,
    path: PathResult,
    currentSegmentIndex: number,
    currentOffset: number,
    lookaheadMeters: number,
    releaseBehindMeters: number
  ): ReservationUpdate {
    if (!path.found || path.segments.length === 0) {
      return {
        blockedAtOffset: null,
        blockedBlockId: null,
        blockedByTrainId: null,
        blockedReason: null,
        blockedResourceId: null,
      }
    }

    let state = this.trainState.get(trainId)
    if (!state) {
      state = { reservedBlocks: new Set(), reservedNodes: new Set(), releaseCursor: 0 }
      this.trainState.set(trainId, state)
    }

    // Release blocks far enough behind us.
    const releaseBeforeOffset = currentOffset - releaseBehindMeters
    while (state.releaseCursor < currentSegmentIndex) {
      const seg = path.segments[state.releaseCursor]
      if (!seg) break
      const segEnd = seg.cumulativeDistance + seg.link.length
      if (segEnd > releaseBeforeOffset) break
      this.releaseBlock(trainId, seg.link.trackId)
      if (this.trackGraph.isInterlockingNode(seg.fromNodeId)) {
        this.releaseNode(trainId, seg.fromNodeId)
      }
      state.releaseCursor++
    }

    // Reserve blocks ahead.
    for (let i = Math.max(0, currentSegmentIndex); i < path.segments.length; i++) {
      const seg = path.segments[i]
      if (!seg) continue
      const distanceAhead = seg.cumulativeDistance - currentOffset
      if (distanceAhead > lookaheadMeters) break

      if (i > currentSegmentIndex && this.trackGraph.isInterlockingNode(seg.fromNodeId)) {
        const nodeResult = this.reserveNode(trainId, seg.fromNodeId)
        if (nodeResult === 'blocked') {
          return {
            blockedAtOffset: seg.cumulativeDistance,
            blockedBlockId: seg.link.trackId,
            blockedByTrainId: this.reservedByNodeId.get(seg.fromNodeId) ?? null,
            blockedReason: 'junction',
            blockedResourceId: seg.fromNodeId,
          }
        }
      }

      const sectionId = this.trackGraph.getSectionId(seg.link.trackId)
      const traversalDirection = this.trackGraph.getSectionDirection(
        seg.link.trackId,
        seg.fromNodeId,
        seg.toNodeId
      )

      if (sectionId && traversalDirection) {
        const locked = this.sectionLockDirection.get(sectionId)
        if (locked && locked !== traversalDirection) {
          return {
            blockedAtOffset: seg.cumulativeDistance,
            blockedBlockId: seg.link.trackId,
            blockedByTrainId: this.sectionLockOwner.get(sectionId) ?? null,
            blockedReason: 'section_direction',
            blockedResourceId: sectionId,
          }
        }
      }

      const result = this.reserveBlock(trainId, seg.link.trackId)
      if (result === 'blocked') {
        return {
          blockedAtOffset: seg.cumulativeDistance,
          blockedBlockId: seg.link.trackId,
          blockedByTrainId: this.reservedByBlockId.get(seg.link.trackId) ?? null,
          blockedReason: 'block',
          blockedResourceId: seg.link.trackId,
        }
      }

      if (result === 'reserved' && sectionId) {
        this.sectionReservedCount.set(
          sectionId,
          (this.sectionReservedCount.get(sectionId) ?? 0) + 1
        )
        if (traversalDirection && !this.sectionLockDirection.has(sectionId)) {
          this.sectionLockDirection.set(sectionId, traversalDirection)
          this.sectionLockOwner.set(sectionId, trainId)
        }
      }
    }

    return {
      blockedAtOffset: null,
      blockedBlockId: null,
      blockedByTrainId: null,
      blockedReason: null,
      blockedResourceId: null,
    }
  }

  /**
   * Release all reserved blocks for a train except for an optional block to keep
   * (usually the current block the train is physically on).
   */
  yieldTrain(trainId: string, keepBlockId: string | null): void {
    const state = this.trainState.get(trainId)
    if (!state) return

    for (const blockId of Array.from(state.reservedBlocks)) {
      if (keepBlockId && blockId === keepBlockId) continue
      this.releaseBlock(trainId, blockId)
    }

    for (const nodeId of Array.from(state.reservedNodes)) {
      this.releaseNode(trainId, nodeId)
    }
  }

  private reserveBlock(trainId: string, blockId: string): 'reserved' | 'already' | 'blocked' {
    const owner = this.reservedByBlockId.get(blockId)
    if (!owner) {
      this.reservedByBlockId.set(blockId, trainId)
      this.getOrCreateTrainState(trainId).reservedBlocks.add(blockId)
      return 'reserved'
    }
    if (owner === trainId) return 'already'
    return 'blocked'
  }

  private releaseBlock(trainId: string, blockId: string): void {
    if (this.reservedByBlockId.get(blockId) !== trainId) return
    this.reservedByBlockId.delete(blockId)
    this.trainState.get(trainId)?.reservedBlocks.delete(blockId)

    const sectionId = this.trackGraph.getSectionId(blockId)
    if (!sectionId) return
    const current = this.sectionReservedCount.get(sectionId) ?? 0
    const next = Math.max(0, current - 1)
    if (next <= 0) {
      this.sectionReservedCount.delete(sectionId)
      this.sectionLockDirection.delete(sectionId)
      this.sectionLockOwner.delete(sectionId)
    } else {
      this.sectionReservedCount.set(sectionId, next)
    }
  }

  private reserveNode(trainId: string, nodeId: string): 'reserved' | 'already' | 'blocked' {
    const owner = this.reservedByNodeId.get(nodeId)
    if (!owner) {
      this.reservedByNodeId.set(nodeId, trainId)
      this.getOrCreateTrainState(trainId).reservedNodes.add(nodeId)
      return 'reserved'
    }
    if (owner === trainId) return 'already'
    return 'blocked'
  }

  private releaseNode(trainId: string, nodeId: string): void {
    if (this.reservedByNodeId.get(nodeId) !== trainId) return
    this.reservedByNodeId.delete(nodeId)
    this.trainState.get(trainId)?.reservedNodes.delete(nodeId)
  }

  private getOrCreateTrainState(trainId: string): TrainReservationState {
    let state = this.trainState.get(trainId)
    if (!state) {
      state = { reservedBlocks: new Set(), reservedNodes: new Set(), releaseCursor: 0 }
      this.trainState.set(trainId, state)
    }
    return state
  }
}
