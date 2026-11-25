import { lazy, Suspense } from 'react'
import LoadingScreen from './components/ui/LoadingScreen.jsx'
import { AuthProvider } from './lib/authContext.jsx'

const App = lazy(() => import('./App.jsx'))

export default function Root() {
  return (
    <AuthProvider>
      <Suspense fallback={<LoadingScreen />}>
        <App />
      </Suspense>
    </AuthProvider>
  )
}
