// Vercel Serverless Function: /joy-proxy/*
// 转发 JOY compose.html 内相对资源到官方源，复刻 vite dev 中的 joy-proxy 中间件。
import https from 'https';

const JOY_ORIGIN = 'https://5r0lrpa77tvw.joyapp.jd.com/';

export default (req, res) => {
  // req.url 可能是 /joy-proxy/xxx 或经 rewrite 后的 /api/joy-proxy/xxx，统一去掉前缀
  const rest = (req.url || '/').replace(/^\/(?:api\/)?joy-proxy\/?/, '');
  const target = new URL(rest, JOY_ORIGIN);

  const upstream = https.request(
    target,
    {
      method: req.method,
      headers: {
        ...(req.headers.range ? { range: req.headers.range } : {}),
        ...(req.headers['content-type'] ? { 'content-type': req.headers['content-type'] } : {}),
        ...(req.headers.accept ? { accept: req.headers.accept } : {}),
        'user-agent': req.headers['user-agent'] || 'Mozilla/5.0',
      },
    },
    (upstreamRes) => {
      res.statusCode = upstreamRes.statusCode || 200;
      for (const [key, value] of Object.entries(upstreamRes.headers)) {
        if (value === undefined || /^access-control-/i.test(key)) continue;
        res.setHeader(key, value);
      }
      res.setHeader('access-control-allow-origin', '*');
      upstreamRes.pipe(res);
    },
  );
  upstream.on('error', (err) => {
    console.error('[joy-proxy] error:', err.message);
    res.statusCode = 502;
    res.end('JOY asset unavailable');
  });
  req.pipe(upstream);
};