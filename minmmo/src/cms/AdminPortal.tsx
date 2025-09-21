
import React, { useState } from 'react'
import { load, save, exportConfig, importConfig } from '@config/store'

export function AdminPortal(){
  const [text, setText] = useState(() => JSON.stringify(load(), null, 2))
  const [err, setErr] = useState<string|null>(null)

  const onSave = () => {
    try {
      const parsed = JSON.parse(text)
      save(parsed)
      setErr(null)
      alert('Saved config.')
    } catch (e:any) { setErr(e.message) }
  }
  const onExport = () => {
    const blob = new Blob([exportConfig()], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'game-config.json'
    a.click()
  }
  const onImport = async (file?: File) => {
    if (!file) return
    const txt = await file.text()
    importConfig(txt)
    setText(JSON.stringify(load(), null, 2))
  }

  return (
    <div style={{ maxWidth: 1100, margin: '24px auto', padding: 16 }}>
      <h1>MinMMO Admin CMS</h1>
      <p className="small">Everything in-game is driven by this JSON. Edit and save to update.</p>
      <div className="row" style={{ gap: 8, margin: '12px 0' }}>
        <button onClick={onSave}>Save</button>
        <button onClick={onExport}>Export JSON</button>
        <label className="row" style={{ gap:6 }}>
          <input type="file" accept="application/json" onChange={e=>onImport(e.target.files?.[0]||undefined)}/>
          <span className="small">Import JSON</span>
        </label>
        <button onClick={()=>setText(JSON.stringify(load(), null, 2))}>Reload</button>
      </div>
      {err && <div className="card" style={{ borderColor:'#ff5577' }}><b>Error:</b> {err}</div>}
      <textarea
        value={text}
        onChange={e=>setText(e.target.value)}
        style={{ width:'100%', height: '65vh' }}
        spellCheck={false}
      />
    </div>
  )
}
