import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'

async function bootstrap() {
  const { worker } = await import('./mocks/browser.ts')
  await worker.start({
    onUnhandledRequest: 'bypass',
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
  })

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
