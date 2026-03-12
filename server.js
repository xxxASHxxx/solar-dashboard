const http = require('http');
const fs = require('fs');
const path = require('path');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const { WebSocketServer } = require('ws');

const PORT = 3000;
const BAUD_RATE = 9600;
const DEFAULT_COM = 'COM5';

// ---------- MIME types for static file serving ----------
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ---------- HTTP server — serves public/ ----------
const server = http.createServer((req, res) => {
  let filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// ---------- WebSocket server ----------
const wss = new WebSocketServer({ server });
let clientCount = 0;

wss.on('connection', (ws) => {
  clientCount++;
  console.log(`[WS] Client connected (${clientCount} total)`);

  ws.on('close', () => {
    clientCount--;
    console.log(`[WS] Client disconnected (${clientCount} remaining)`);
  });
});

function broadcast(data) {
  const json = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(json);
    }
  });
}

// ---------- Serial line parser ----------
const LINE_REGEX = /Left_Sensor:(\d+),Right_Sensor:(\d+),Tracker_Angle:(\d+),Estimated_Efficiency_%:(\d+)/;

function parseLine(line) {
  const match = line.match(LINE_REGEX);
  if (!match) return null;
  return {
    left: parseInt(match[1], 10),
    right: parseInt(match[2], 10),
    angle: parseInt(match[3], 10),
    efficiency: parseInt(match[4], 10),
  };
}

// ---------- Auto-detect COM port ----------
async function findArduinoPort() {
  try {
    const ports = await SerialPort.list();
    console.log('[Serial] Available ports:');
    ports.forEach((p) => {
      console.log(`  ${p.path}  manufacturer=${p.manufacturer || 'unknown'}  pnpId=${p.pnpId || ''}  friendlyName=${p.friendlyName || ''}`);
    });

    // Priority 1: match CH340 / wch manufacturer (the actual Arduino USB chip)
    let match = ports.find((p) => {
      const mfr = (p.manufacturer || '').toLowerCase();
      const friendly = (p.friendlyName || '').toLowerCase();
      return mfr.includes('ch340') || mfr.includes('wch') ||
             friendly.includes('ch340') || friendly.includes('usb-serial');
    });

    // Priority 2: match generic USB in pnpId (but not Bluetooth)
    if (!match) {
      match = ports.find((p) => {
        const pnp = (p.pnpId || '').toLowerCase();
        const friendly = (p.friendlyName || '').toLowerCase();
        return (pnp.includes('usb') && !friendly.includes('bluetooth'));
      });
    }

    if (match) {
      console.log(`[Serial] Auto-detected Arduino on ${match.path}`);
      return match.path;
    }
  } catch (err) {
    console.warn('[Serial] Port scan failed:', err.message);
  }

  console.log(`[Serial] No CH340/USB port found — defaulting to ${DEFAULT_COM}`);
  return DEFAULT_COM;
}

// ---------- Open serial port & start streaming ----------
async function startSerial() {
  const comPort = await findArduinoPort();
  let dataReceived = false;

  const serial = new SerialPort({ path: comPort, baudRate: BAUD_RATE, autoOpen: false });
  const parser = serial.pipe(new ReadlineParser({ delimiter: '\r\n' }));

  serial.open((err) => {
    if (err) {
      console.error(`[Serial] Failed to open ${comPort}: ${err.message}`);
      console.error('[Serial] Dashboard will run but no live data will flow. Plug in Arduino and restart.');
      return;
    }
    console.log(`[Serial] Opened ${comPort} @ ${BAUD_RATE} baud`);
  });

  parser.on('data', (line) => {
    if (!dataReceived) {
      dataReceived = true;
      console.log('[Serial] Data stream started');
    }

    const parsed = parseLine(line.trim());
    if (parsed) {
      broadcast(parsed);
    }
  });

  serial.on('error', (err) => {
    console.error('[Serial] Error:', err.message);
  });

  serial.on('close', () => {
    console.warn('[Serial] Port closed');
  });
}

// ---------- Start everything ----------
server.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  Solar Tracker Dashboard`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`========================================\n`);
  startSerial();
});
