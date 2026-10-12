import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import packageJson from '../package.json'
import './index.css'

document.title = `Kupo v${packageJson.version}`

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// Use contextBridge
window.electron?.ipcRenderer?.on("main-process-message", (_message) => {
  console.log(_message);
});
