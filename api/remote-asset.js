// Vercel Serverless Function: /remote-asset?u=<encodedUrl>
// 通用远端资源 CORS 代理，复刻 vite dev 中的 remoteAssetProxy。
import http from 'http';
import https from 'https';

export default (req, res) => {
  try {
    const raw = new URL(req.url || '', 'http://x').searchParams.get('u');
    if (!raw) {
      res.statusCode = 400;
      res.end('missing u');
      return;
    }
    const target = new URL(raw);
    const client = target.protocol === 'http:' ? http : https;
    const upstream = client.request(
      {
        method: req.method,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: target.pathname + target.search,
        headers: {
          ...(req.headers.range ? { range: req.headers.range } : {}),
          'user-agent': req.headers['user-agent'] || 'Mozilla/5.0',
        },
      },
      (upRes) => {
        res.setHeader('access-control-allow-origin', '*');
        res.setHeader('access-control-allow-methods', 'GET,HEAD,OPTIONS');
        res.setHeader('access-control-allow-headers', '*');
        for (const [k, v] of Object.entries(upRes.headers)) {
          if (v === undefined) continue;
          if (/^access-control-/i.test(k)) continue;
          res.setHeader(k, v);
        }
        res.statusCode = upRes.statusCode || 200;
        upRes.pipe(res);
      },
    );
    upstream.on('error', (err) => {
      console.error('[remote-asset] error:', err.message, target.href);
      res.statusCode = 502;
      res.end('upstream error: ' + err.message);
    });
    upstream.end();
  } catch (e) {
    res.statusCode = 400;
    res.end('bad url: ' + (e && e.message));
  }
};