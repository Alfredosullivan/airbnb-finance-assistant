// Servidor estático mínimo para previsualizar el directorio public/
// Solo para desarrollo local — no usar en producción.
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT    = 5500;
const PUBLIC  = path.join(__dirname, 'public');
const MIME    = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

http.createServer((req, res) => {
  // GET /app → sirve el dashboard; GET / → sirve la landing (index.html)
  const urlPath = req.url === '/app' ? '/app.html' : (req.url === '/' ? '/index.html' : req.url);
  let filePath = path.join(PUBLIC, urlPath);
  const ext    = path.extname(filePath).toLowerCase();

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found: ' + req.url);
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log('Preview server running at http://localhost:' + PORT);
});
