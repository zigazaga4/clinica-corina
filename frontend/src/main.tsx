import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'

const radacina = document.getElementById('root')
if (!radacina) throw new Error('Elementul #root lipsește din index.html.')

createRoot(radacina).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
