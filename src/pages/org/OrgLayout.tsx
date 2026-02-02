import { Link, NavLink, Outlet } from 'react-router-dom'

function navLinkClassName({ isActive }: { isActive: boolean }): string {
  return `block rounded px-3 py-2 text-sm transition-colors ${
    isActive ? 'bg-db-gray-dark/70 text-white' : 'text-db-gray-light hover:bg-db-gray-dark/50'
  }`
}

export function OrgLayout() {
  return (
    <div className="pointer-events-none absolute inset-0 z-40">
      <div className="pointer-events-auto absolute inset-0 bg-db-dark/95 backdrop-blur">
        <div className="grid h-full grid-cols-[260px_1fr]">
          <aside className="border-r border-db-gray-dark p-4">
            <div className="mb-4">
              <div className="text-white font-semibold">Organization</div>
              <div className="text-xs text-db-gray-light">Freiburg (starter region)</div>
            </div>

            <nav className="space-y-1">
              <NavLink to="/org/overview" className={navLinkClassName}>
                Overview
              </NavLink>
              <NavLink to="/org/trains" className={navLinkClassName}>
                Trains
              </NavLink>
              <NavLink to="/org/stations" className={navLinkClassName}>
                Stations
              </NavLink>
              <NavLink to="/org/timetable" className={navLinkClassName}>
                Timetable
              </NavLink>
            </nav>

            <div className="mt-6 border-t border-db-gray-dark pt-4">
              <Link
                to="/"
                className="inline-flex w-full items-center justify-center rounded bg-db-gray-dark/50 px-3 py-2 text-sm text-db-gray-light hover:bg-db-gray-dark"
              >
                Back to map
              </Link>
            </div>
          </aside>

          <section className="min-w-0">
            <header className="flex h-12 items-center justify-between border-b border-db-gray-dark px-6">
              <div className="text-white font-semibold">Org Management</div>
              <div className="text-xs text-db-gray-light">Live operations</div>
            </header>

            <div className="h-[calc(100%-3rem)] overflow-auto px-6 py-5">
              <Outlet />
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
