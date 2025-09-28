
import React from 'react'
import ReactDOM from 'react-dom/client'
import { AdminPortal } from '@cms/AdminPortal'
import { load, subscribe } from '@config/store'
import { rebuildFromConfig } from '@content/registry'

subscribe(rebuildFromConfig)

load()
  .then(rebuildFromConfig)
  .catch((error) => {
    console.error('Failed to load configuration', error)
  })

ReactDOM.createRoot(document.getElementById('root')!).render(<AdminPortal />)
