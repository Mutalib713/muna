import { lazy, Suspense } from 'react'
import LoadingScreen from './components/ui/LoadingScreen.jsx'

const App = lazy(() => import('./App.jsx'))

export default function Root() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <App />
    </Suspense>
  )
}
