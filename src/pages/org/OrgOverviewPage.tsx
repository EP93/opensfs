import { useMemo } from 'react'
import { useTrainSnapshots } from '@/hooks/useTrainSnapshots'

export function OrgOverviewPage() {
  const trains = useTrainSnapshots()

  const stats = useMemo(() => {
    const byState = new Map<string, number>()
    for (const t of trains) {
      byState.set(t.state, (byState.get(t.state) ?? 0) + 1)
    }
    const moving = trains.filter((t) => t.state === 'running' || t.state === 'approaching').length
    return { total: trains.length, moving, byState }
  }, [trains])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Overview</h2>
        <p className="mt-1 text-sm text-db-gray-light">
          Starter org view. This will expand into finances, staffing, depot management, and KPIs.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded border border-db-gray-dark bg-db-gray-dark/20 p-4">
          <div className="text-xs text-db-gray-light">Active trains</div>
          <div className="mt-1 text-2xl font-bold text-white">{stats.total}</div>
        </div>
        <div className="rounded border border-db-gray-dark bg-db-gray-dark/20 p-4">
          <div className="text-xs text-db-gray-light">Moving</div>
          <div className="mt-1 text-2xl font-bold text-white">{stats.moving}</div>
        </div>
        <div className="rounded border border-db-gray-dark bg-db-gray-dark/20 p-4">
          <div className="text-xs text-db-gray-light">States</div>
          <div className="mt-2 space-y-1">
            {Array.from(stats.byState.entries())
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([state, count]) => (
                <div key={state} className="flex justify-between text-sm">
                  <span className="text-db-gray-light capitalize">{state.replace('_', ' ')}</span>
                  <span className="text-white">{count}</span>
                </div>
              ))}
            {stats.byState.size === 0 && <div className="text-sm text-db-gray">No trains.</div>}
          </div>
        </div>
      </div>

      <div className="rounded border border-db-gray-dark bg-db-gray-dark/10 p-4">
        <div className="text-sm font-semibold text-white">Next up</div>
        <ul className="mt-2 list-disc pl-5 text-sm text-db-gray-light">
          <li>Persistent org roster (owned trains) vs spawned services</li>
          <li>Realistic stop list / next stop for each train</li>
          <li>Operations incidents + alerts (delays, stuck trains)</li>
        </ul>
      </div>
    </div>
  )
}
