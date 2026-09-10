import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { urmaresteMarginileSigure } from './app/margini'
import './index.css'

const radacina = document.getElementById('root')
if (!radacina) throw new Error('Elementul #root lipsește din index.html.')

// Înaintea primei randări: altfel bara de file apare o clipă sub pastila de
// gesturi și abia apoi sare la locul ei.
urmaresteMarginileSigure()

createRoot(radacina).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
