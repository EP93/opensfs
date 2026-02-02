/**
 * SignalSystem - Minimal signal model based on block reservations.
 *
 * Signals are loaded from NetworkData and displayed/queried as STOP/PROCEED based
 * on whether adjacent blocks are reserved by another train.
 */

import type { NetworkData } from '@/types/network'
import type { TrackReservationSystem } from './TrackReservationSystem'

export type SignalAspect = 'STOP' | 'PROCEED'

export class SignalSystem {
  private blockIdsBySignalId: Map<string, string[]> = new Map()
  private reservationSystem: TrackReservationSystem

  constructor(reservationSystem: TrackReservationSystem) {
    this.reservationSystem = reservationSystem
  }

  loadNetwork(network: NetworkData): void {
    this.blockIdsBySignalId.clear()

    const edgesByNode = new Map<string, string[]>()
    const addEdge = (nodeId: string, blockId: string): void => {
      const list = edgesByNode.get(nodeId)
      if (list) list.push(blockId)
      else edgesByNode.set(nodeId, [blockId])
    }

    for (const e of network.edges) {
      addEdge(e.fromNodeId, e.id)
      addEdge(e.toNodeId, e.id)
    }

    for (const signal of network.signals) {
      const incident = edgesByNode.get(signal.nodeId) ?? []
      this.blockIdsBySignalId.set(signal.id, incident)
    }
  }

  getAspect(signalId: string, viewerTrainId?: string): SignalAspect {
    const blocks = this.blockIdsBySignalId.get(signalId)
    if (!blocks || blocks.length === 0) return 'PROCEED'

    for (const blockId of blocks) {
      const owner = this.reservationSystem.getReservedBy(blockId)
      if (owner && owner !== viewerTrainId) {
        return 'STOP'
      }
    }
    return 'PROCEED'
  }
}
