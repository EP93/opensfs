import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useUIStore } from '@/stores/useUIStore'

const RAILWAY_TYPE_LABELS: Record<string, string> = {
  station: 'Railway Station',
  halt: 'Railway Halt',
  stop: 'Transit Stop',
}

const RAILWAY_TYPE_COLORS: Record<string, string> = {
  station: 'bg-db-red',
  halt: 'bg-db-petrol',
  stop: 'bg-gray-500',
}

export function StationSheet() {
  const { selectedStation, clearSelectedStation } = useUIStore()

  return (
    <Sheet
      open={selectedStation !== null}
      modal={false}
      onOpenChange={(open) => !open && clearSelectedStation()}
    >
      <SheetContent side="right" className="w-[400px] bg-db-dark border-db-gray-dark">
        {selectedStation && (
          <>
            <SheetHeader>
              <div className="flex items-center gap-3">
                <div
                  className={`w-4 h-4 rounded-full ${RAILWAY_TYPE_COLORS[selectedStation.railway] ?? 'bg-gray-500'}`}
                />
                <SheetTitle className="text-white text-xl">{selectedStation.name}</SheetTitle>
              </div>
              <SheetDescription className="text-db-gray-light">
                {RAILWAY_TYPE_LABELS[selectedStation.railway] ?? 'Railway Station'}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-6">
              {/* Station Details */}
              <section>
                <h3 className="text-sm font-semibold text-db-gray-light uppercase tracking-wide mb-3">
                  Details
                </h3>
                <dl className="space-y-2">
                  <div className="flex justify-between">
                    <dt className="text-db-gray">Type</dt>
                    <dd className="text-white capitalize">{selectedStation.railway}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-db-gray">Platforms</dt>
                    <dd className="text-white">{selectedStation.platforms}</dd>
                  </div>
                  {selectedStation.ref && (
                    <div className="flex justify-between">
                      <dt className="text-db-gray">Reference</dt>
                      <dd className="text-white font-mono">{selectedStation.ref}</dd>
                    </div>
                  )}
                  {selectedStation.operator && (
                    <div className="flex justify-between">
                      <dt className="text-db-gray">Operator</dt>
                      <dd className="text-white">{selectedStation.operator}</dd>
                    </div>
                  )}
                  {selectedStation.uicRef && (
                    <div className="flex justify-between">
                      <dt className="text-db-gray">UIC Code</dt>
                      <dd className="text-white font-mono">{selectedStation.uicRef}</dd>
                    </div>
                  )}
                </dl>
              </section>

              {/* Location */}
              <section>
                <h3 className="text-sm font-semibold text-db-gray-light uppercase tracking-wide mb-3">
                  Location
                </h3>
                <dl className="space-y-2">
                  <div className="flex justify-between">
                    <dt className="text-db-gray">Longitude</dt>
                    <dd className="text-white font-mono text-sm">
                      {selectedStation.coordinates[0].toFixed(6)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-db-gray">Latitude</dt>
                    <dd className="text-white font-mono text-sm">
                      {selectedStation.coordinates[1].toFixed(6)}
                    </dd>
                  </div>
                </dl>
              </section>

              {/* Station ID */}
              <section>
                <h3 className="text-sm font-semibold text-db-gray-light uppercase tracking-wide mb-3">
                  Identifier
                </h3>
                <p className="text-white font-mono text-xs break-all bg-db-gray-dark p-2 rounded">
                  {selectedStation.id}
                </p>
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
