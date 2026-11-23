// Electron does not await lifecycle listeners. Hold every quit request while
// cleanup is pending, then allow the ordinary quit sequence to run once.
export function createBeforeQuitHandler(cleanup: () => Promise<void>, quit: () => void) {
  let state: 'idle' | 'cleaning' | 'complete' = 'idle';
  return (event: Pick<Electron.Event, 'preventDefault'>) => {
    if (state === 'complete') {
      return;
    }
    event.preventDefault();
    if (state === 'cleaning') {
      return;
    }
    state = 'cleaning';
    void cleanup()
      .catch((error) => console.error('Error during launcher shutdown:', error))
      .finally(() => {
        state = 'complete';
        quit();
      });
  };
}
