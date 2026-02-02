import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import App from './App'
import { OrgLayout } from './pages/org/OrgLayout'
import { OrgOverviewPage } from './pages/org/OrgOverviewPage'
import { OrgStationsPage } from './pages/org/OrgStationsPage'
import { OrgTimetablePage } from './pages/org/OrgTimetablePage'
import { OrgTrainsPage } from './pages/org/OrgTrainsPage'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element not found')
}

// Note: StrictMode disabled temporarily for Pixi.js compatibility
// Pixi.js doesn't handle double mounting/unmounting well
const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: null },
      {
        path: 'org',
        element: <OrgLayout />,
        children: [
          { index: true, element: <OrgOverviewPage /> },
          { path: 'overview', element: <OrgOverviewPage /> },
          { path: 'trains', element: <OrgTrainsPage /> },
          { path: 'stations', element: <OrgStationsPage /> },
          { path: 'timetable', element: <OrgTimetablePage /> },
        ],
      },
    ],
  },
])

createRoot(rootElement).render(<RouterProvider router={router} />)
