const http = require('node:http');
const agent = new http.Agent({ keepAlive: true, maxSockets: 32 });
const servers = [];

function handle(req, res) {
  if (!req.url || !req.url.startsWith('/') || req.url.startsWith('//')) {
    res.writeHead(400); res.end('Invalid local request'); return;
  }
  const target = http.request({ hostname: '127.0.0.1', port: 3014, path: req.url,
    method: req.method, headers: req.headers, agent }, upstream => {
    res.writeHead(upstream.statusCode, upstream.headers);
    upstream.on('error', () => res.destroy());
    upstream.pipe(res);
  });
  target.setTimeout(60000, () => target.destroy());
  target.on('error', () => {
    if (res.headersSent) res.destroy();
    else { res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Local preview is unavailable'); }
  });
  req.on('aborted', () => target.destroy());
  res.on('close', () => { if (!res.writableFinished) target.destroy(); });
  req.pipe(target);
}

for (const host of ['127.0.0.1', '::1']) {
  const server = http.createServer(handle);
  servers.push(server);
  server.on('error', error => { console.error(error.code); process.exit(1); });
  server.on('upgrade', (_req, socket) => socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'));
  server.listen(3001, host, () => console.log(`Local QoE preview: ${host}:3001 -> 127.0.0.1:3014`));
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  agent.destroy();
  for (const server of servers) { server.close(); server.closeAllConnections(); }
});
