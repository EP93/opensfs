import { useEffect, useState } from 'react'
import { useRuntimeStore } from '@/stores/useRuntimeStore'

export function useFollowTrainId(): string | null {
  const game = useRuntimeStore((s) => s.game)
  const [followTrainId, setFollowTrainId] = useState<string | null>(null)

  useEffect(() => {
    if (!game) {
      setFollowTrainId(null)
      return
    }

    setFollowTrainId(game.getFollowTrainId())
    const unsubscribe = game.subscribeFollowTrain((id) => setFollowTrainId(id))

    return () => {
      unsubscribe()
    }
  }, [game])

  return followTrainId
}
