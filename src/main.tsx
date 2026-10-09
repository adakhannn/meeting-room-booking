import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App.tsx'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1 } },
})

async function bootstrap() {
  const { worker } = await import('./mocks/browser.ts')
  await worker.start({
    onUnhandledRequest: 'bypass',
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
  })

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  )
}

function showStartupError() {
  const container = document.getElementById('root') ?? document.body
  const message = document.createElement('main')
  message.className = 'mx-auto max-w-xl px-4 py-16 text-center'
  message.setAttribute('role', 'alert')

  const heading = document.createElement('h1')
  heading.className = 'mb-6 text-2xl font-bold'
  heading.textContent = 'Не удалось запустить приложение'

  const reload = document.createElement('button')
  reload.type = 'button'
  reload.className = 'min-h-11 cursor-pointer rounded-lg bg-accent px-4 py-2 font-semibold text-white hover:bg-accent-strong focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-focus'
  reload.textContent = 'Перезагрузить'
  reload.addEventListener('click', () => window.location.reload())

  message.append(heading, reload)
  container.replaceChildren(message)
}

void bootstrap().catch(showStartupError)
