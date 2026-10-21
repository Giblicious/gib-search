const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
app.setPath('userData', path.join(__dirname, 'profile'));
// Only this disposable test window is created. No vault or installed Obsidian.
let window;
const timeout = setTimeout(() => { console.error('Electron search check timed out'); app.exit(2); }, 240000);
ipcMain.on('report', (_, value) => console.log(JSON.stringify(value)));
ipcMain.on('done', (_, value) => { console.log(JSON.stringify(value)); clearTimeout(timeout); app.exit(value.ok ? 0 : 1); });
app.whenReady().then(async () => {
  window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false } });
  window.webContents.on('console-message', (...args) => { const details = args.length === 1 ? args[0] : { level: args[1], message: args[2] }; if (details.level === 'error' || details.level === 3) console.error(details.message); });
  window.webContents.on('render-process-gone', (_, detail) => { console.error(detail.reason); app.exit(3); });
  await window.loadFile(path.join(__dirname, 'index.html'));
}).catch(error => { console.error(error); app.exit(1); });
