import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT) || 8001;
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

createServer(async (request, response) => {
  try {
    const requestPath = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const relativePath = requestPath.replace(/^\/+/, '') || 'index.html';
    const filePath = resolve(projectRoot, relativePath);
    if (filePath !== projectRoot && !filePath.startsWith(projectRoot + sep)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const details = await stat(filePath);
    const actualPath = details.isDirectory() ? resolve(filePath, 'index.html') : filePath;
    const contents = await readFile(actualPath);
    response.writeHead(200, {
      'Content-Type': mimeTypes[extname(actualPath)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    response.end(contents);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}).listen(port, '127.0.0.1', () => {
  process.stdout.write('登峰灶急開發伺服器：http://127.0.0.1:' + port + '\n');
});
