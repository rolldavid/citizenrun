const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The web app and the API share one origin in development: these paths go to the local API.
const FORWARDED_PREFIXES = ['/v1/', '/og/', '/m/', '/map/', '/tiles/', '/.well-known/'];
const FORWARDED_PATHS = ['/healthz', '/readyz'];

function isForwarded(url) {
  const path = (url ?? '').split('?')[0];
  return (
    FORWARDED_PATHS.includes(path) || FORWARDED_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
}

function forward(req, res) {
  const target = new URL(process.env.DEV_API_ORIGIN || 'http://localhost:8080');
  const transport = target.protocol === 'https:' ? https : http;
  const upstream = transport.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, host: target.host },
    },
    (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(502);
    res.end();
  });
  req.pipe(upstream);
}

const defaultEnhance = config.server?.enhanceMiddleware;

config.server = {
  ...config.server,
  enhanceMiddleware: (metroMiddleware, server) => {
    const inner = defaultEnhance ? defaultEnhance(metroMiddleware, server) : metroMiddleware;
    return (req, res, next) => {
      if (isForwarded(req.url)) {
        forward(req, res);
        return;
      }
      inner(req, res, next);
    };
  },
};

module.exports = config;
