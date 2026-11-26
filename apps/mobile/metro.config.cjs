const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { URL } = require('node:url');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// zod's entry modules (`zod/v4/core/index.js`, `zod/v4/classic/external.js`) re-export all of its
// locales, about 40 KB gzipped that no screen reads. Their import resolves to a module that exports
// English alone, the one locale zod registers by default (D-164).
const ZOD_LOCALES_REQUEST = '../locales/index.js';
const ZOD_ENTRY_FOLDER = /[\\/]node_modules[\\/]zod[\\/]v4[\\/](?:core|classic|mini)[\\/][^\\/]+$/;
const ZOD_LOCALES = path.join(__dirname, 'src', 'lib', 'zod-locales.ts');

// babel.config.cjs turns each value imported by name from the generated API client's entry into the
// request `@citizenrun/shared/api/<name>`. It resolves to the one generated file that defines the
// name, read from the client's files at each resolution so a regenerated client is never stale; a
// name no file defines, or more than one defines, resolves to the entry (D-164).
const API_ENTRY = '@citizenrun/shared/api';
const API_NAME_REQUEST = /^@citizenrun\/shared\/api\/([A-Za-z_$][\w$]*)$/;

function apiFileDefining(apiFolder, name) {
  const definition = new RegExp(
    `^export (?:async function|function|const|let|class) ${name.replace(/\$/g, '\\$')}\\b`,
    'm',
  );
  const files = [];
  for (const entry of fs.readdirSync(apiFolder, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const folder = path.join(apiFolder, entry.name);
    for (const file of fs.readdirSync(folder)) {
      const filePath = path.join(folder, file);
      if (file.endsWith('.ts') && definition.test(fs.readFileSync(filePath, 'utf8'))) {
        files.push(filePath);
      }
    }
  }
  return files.length === 1 ? files[0] : null;
}

const upstreamResolve = config.resolver.resolveRequest;

function resolveUpstream(context, moduleName, platform) {
  return upstreamResolve
    ? upstreamResolve(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === ZOD_LOCALES_REQUEST && ZOD_ENTRY_FOLDER.test(context.originModulePath)) {
    return { type: 'sourceFile', filePath: ZOD_LOCALES };
  }
  const apiName = API_NAME_REQUEST.exec(moduleName);
  if (apiName) {
    const entry = resolveUpstream(context, API_ENTRY, platform);
    const filePath =
      entry.type === 'sourceFile'
        ? apiFileDefining(path.dirname(entry.filePath), apiName[1])
        : null;
    return filePath ? { type: 'sourceFile', filePath } : entry;
  }
  return resolveUpstream(context, moduleName, platform);
};

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
