import './App.css'
import { ImportScreen } from './components/ImportScreen'
import { ResultsScreen } from './components/ResultsScreen'
import { SwipeView } from './components/SwipeView'
import { useAppStore } from './store'

function App() {
  const view = useAppStore((s) => s.view)

  return (
    <main className="app-root">
      {view === 'import' && <ImportScreen />}
      {view === 'swipe' && <SwipeView />}
      {view === 'results' && <ResultsScreen />}
    </main>
  )
}

export default App
