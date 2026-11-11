import { createServer } from 'node:http';
import { getEnv } from './config/env.js';
import { routeRequest } from './http/app.js';

const env = getEnv();

const server = createServer(async (req, res) => {
  const request = new Request(`http://${req.headers.host || 'localhost'}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : req,
    duplex: ['GET', 'HEAD'].includes(req.method) ? undefined : 'half',
  });

  const response = await routeRequest(request, { env, logger: console });
  const body = Buffer.from(await response.arrayBuffer());

  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  res.end(body);
});

server.listen(env.port, () => {
  console.log(`Ofirone backend gateway escuchando en http://localhost:${env.port}`);
});
