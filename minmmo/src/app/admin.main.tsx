
import React from 'react'
import ReactDOM from 'react-dom/client'
import { AdminPortal } from '@cms/AdminPortal'
import { load, subscribe } from '@config/store'
import { rebuildFromConfig } from '@content/registry'

rebuildFromConfig(load())
subscribe(rebuildFromConfig)

ReactDOM.createRoot(document.getElementById('root')!).render(<AdminPortal />)
