// Vercel Serverless Function: /joy-compose
// 获取 JOY 官方 compose.html 并注入完整 patch（与 vite dev 共享同一份 patch 逻辑）。
import https from 'https';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { patchJoyComposeHtml } = require('./_patchJoyCompose.cjs');

const JOY_COMPOSE_URL = 'https://5r0lrpa77tvw.joyapp.jd.com/compose.html';

export default (_req, res) => {
  https
    .get(JOY_COMPOSE_URL, { headers: { 'user-agent': 'Mozilla/5.0' } }, (upstream) => {
      if ((upstream.statusCode || 500) >= 400) {
        res.statusCode = upstream.statusCode || 502;
        res.end('JOY upstream error');
        upstream.resume();
        return;
      }
      const chunks = [];
      upstream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      upstream.on('end', () => {
        const html = patchJoyComposeHtml(Buffer.concat(chunks).toString('utf8'));
        res.statusCode = 200;
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.setHeader('cache-control', 'no-store');
        res.setHeader('access-control-allow-origin', '*');
        res.end(html);
      });
    })
    .on('error', (err) => {
      console.error('[joy-compose] error:', err.message);
      res.statusCode = 502;
      res.end('JOY bridge unavailable');
    });
};