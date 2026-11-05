import { useEffect } from 'react';

import { sfx } from './audio/sfx';
import { useGameStore } from './store/gameStore';
import UploadScreen from './components/UploadScreen';
import LoadingScreen from './components/LoadingScreen';
import GameScreen from './components/GameScreen';
import ResultsScreen from './components/ResultsScreen';
import RunPage from './components/RunPage';

/** Menu sounds for every button, and unlocking audio on the first gesture. */
function useUiSounds() {
  useEffect(() => {
    let hovered: Element | null = null;
    const unlock = () => sfx.unlock();
    const onOver = (event: PointerEvent) => {
      const button = (event.target as Element | null)?.closest?.('button');
      if (button && button !== hovered && !(button as HTMLButtonElement).disabled) sfx.uiHover();
      hovered = button ?? null;
    };
    const onClick = (event: MouseEvent) => {
      const button = (event.target as Element | null)?.closest?.('button');
      if (button && !(button as HTMLButtonElement).disabled) sfx.uiSelect();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerover', onOver);
    window.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('pointerover', onOver);
      window.removeEventListener('click', onClick);
    };
  }, []);
}

function App() {
  useUiSounds();
  const screen = useGameStore((state) => state.screen);
  const runId = new URLSearchParams(window.location.search).get('run');

  if (runId) {
    return <RunPage runId={runId} />;
  }

  return (
    <div key={screen} className="px-screen" style={{ width: '100%', height: '100%' }}>
      {screen === 'upload' && <UploadScreen />}
      {screen === 'loading' && <LoadingScreen />}
      {screen === 'playing' && <GameScreen />}
      {screen === 'results' && <ResultsScreen />}
    </div>
  );
}

export default App;
