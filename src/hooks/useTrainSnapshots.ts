import { useEffect, useState } from 'react'
import { useRuntimeStore } from '@/stores/useRuntimeStore'
import type { TrainLiveSnapshot } from '@/types/trainTracking'

export function useTrainSnapshots(): TrainLiveSnapshot[] {
  const game = useRuntimeStore((s) => s.game)
  const [trains, setTrains] = useState<TrainLiveSnapshot[]>([])

  useEffect(() => {
    if (!game) {
      setTrains([])
      return
    }

    setTrains(game.getTrainSnapshot())
    const unsubscribe = game.subscribeTrainSnapshots((snapshot) => setTrains(snapshot))

    return () => {
      unsubscribe()
    }
  }, [game])

  return trains
}
