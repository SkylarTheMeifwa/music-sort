
import './App.css'
import { ImportScreen } from './components/ImportScreen'
import { ResultsScreen } from './components/ResultsScreen'
import { SwipeView } from './components/SwipeView'
import { useAppStore } from './store'
import React from 'react'
import GenerateSongData from './components/GenerateSongData'


function App() {
  const view = useAppStore((s) => s.view)
  const [showGenerator, setShowGenerator] = React.useState(false)
  return (
    <main className="app-root">
      <button style={{ position: 'absolute', top: 8, right: 8, zIndex: 10 }} onClick={() => setShowGenerator((v) => !v)}>
        {showGenerator ? 'Back to App' : 'Generate Song Data'}
      </button>
      {showGenerator ? (
        <GenerateSongData />
      ) : (
        <>
          {view === 'import' && <ImportScreen />}
          {view === 'swipe' && <SwipeView />}
          {view === 'results' && <ResultsScreen />}
        </>
      )}
    </main>
  )
}

export default App
