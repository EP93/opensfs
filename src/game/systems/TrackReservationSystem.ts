/**
 * TrackReservationSystem - Fixed-block reservations on top of a PathResult.
 *
 * This is a first-pass signalling model:
 * - Each path segment's `link.trackId` is treated as a block.
 * - A train must reserve blocks ahead; if it cannot reserve the next block, it must stop.
 */

import type { PathResult } from '@/game/graph/TrackGraph'

export interface ReservationUpdate {
  blockedAtOffset: number | null
  blockedBlockId: string | null
  blockedByTrainId: string | null
}

interface TrainReservationState {
  reservedBlocks: Set<string>
  releaseCursor: number
}

export class TrackReservationSystem {
  private reservedByBlockId: Map<string, string> = new Map() // blockId -> trainId
  private trainState: Map<string, TrainReservationState> = new Map()

  setTrainPath(trainId: string): void {
    this.clearTrain(trainId)
    this.trainState.set(trainId, { reservedBlocks: new Set(), releaseCursor: 0 })
  }

  clearTrain(trainId: string): void {
    const state = this.trainState.get(trainId)
    if (state) {
      for (const blockId of state.reservedBlocks) {
        if (this.reservedByBlockId.get(blockId) === trainId) {
          this.reservedByBlockId.delete(blockId)
        }
      }
    } else {
      for (const [blockId, owner] of this.reservedByBlockId.entries()) {
        if (owner === trainId) this.reservedByBlockId.delete(blockId)
      }
    }

    this.trainState.delete(trainId)
  }

  getReservedBy(blockId: string): string | undefined {
    return this.reservedByBlockId.get(blockId)
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
      return { blockedAtOffset: null, blockedBlockId: null, blockedByTrainId: null }
    }

    let state = this.trainState.get(trainId)
    if (!state) {
      state = { reservedBlocks: new Set(), releaseCursor: 0 }
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
      state.releaseCursor++
    }

    // Reserve blocks ahead.
    for (let i = Math.max(0, currentSegmentIndex); i < path.segments.length; i++) {
      const seg = path.segments[i]
      if (!seg) continue
      const distanceAhead = seg.cumulativeDistance - currentOffset
      if (distanceAhead > lookaheadMeters) break

      const ok = this.reserveBlock(trainId, seg.link.trackId)
      if (!ok) {
        return {
          blockedAtOffset: seg.cumulativeDistance,
          blockedBlockId: seg.link.trackId,
          blockedByTrainId: this.reservedByBlockId.get(seg.link.trackId) ?? null,
        }
      }
    }

    return { blockedAtOffset: null, blockedBlockId: null, blockedByTrainId: null }
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
  }

  private reserveBlock(trainId: string, blockId: string): boolean {
    const owner = this.reservedByBlockId.get(blockId)
    if (!owner) {
      this.reservedByBlockId.set(blockId, trainId)
      this.getOrCreateTrainState(trainId).reservedBlocks.add(blockId)
      return true
    }
    if (owner === trainId) return true
    return false
  }

  private releaseBlock(trainId: string, blockId: string): void {
    if (this.reservedByBlockId.get(blockId) !== trainId) return
    this.reservedByBlockId.delete(blockId)
    this.trainState.get(trainId)?.reservedBlocks.delete(blockId)
  }

  private getOrCreateTrainState(trainId: string): TrainReservationState {
    let state = this.trainState.get(trainId)
    if (!state) {
      state = { reservedBlocks: new Set(), releaseCursor: 0 }
      this.trainState.set(trainId, state)
    }
    return state
  }
}
