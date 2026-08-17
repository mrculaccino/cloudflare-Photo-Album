/**
 * TheDupe - Cloudflare Worker（Assets + API）
 *
 * 部署方式：Workers 静态资源（wrangler.toml 中 assets.directory = ./dist）
 * - GET /api/data：返回商品数据 + WhatsApp 号码（号码只从环境变量 WA_NUMBER 读取）
 * - 其余请求：由 ASSETS binding 提供 dist/ 下的静态资源
 */
import catalog from './data.json';
import { AUTH_COOKIE, AUTH_MAX_AGE, sha256Hex, getCookie, loginPage } from './functions/_login.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const password = env.PAS_WARD ? String(env.PAS_WARD) : '';

    // 登录请求（未配置 PAS_WARD 时不做校验，直接展示登录页）
    if (url.pathname === '/login') {
      if (request.method === 'POST' && password) {
        const form = await request.formData();
        const input = String(form.get('password') || '');
        if (input === password) {
          const expected = await sha256Hex(password);
          return new Response(null, {
            status: 302,
            headers: {
              Location: '/',
              'Set-Cookie': `${AUTH_COOKIE}=${expected}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${AUTH_MAX_AGE}`
            }
          });
        }
        return new Response(loginPage('Wrong password, please try again.'), {
          status: 401,
          headers: { 'content-type': 'text/html; charset=utf-8' }
        });
      }
      return new Response(loginPage(''), {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });
    }

    // 密码门：未配置 PAS_WARD 时不启用保护
    if (password) {
      const expected = await sha256Hex(password);
      const cookie = getCookie(request.headers.get('Cookie'), AUTH_COOKIE);
      if (cookie !== expected) {
        return new Response(loginPage(''), {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' }
        });
      }
    }

    // 商品数据接口：与 Pages Function functions/api/data.js 行为保持一致
    if (url.pathname === '/api/data') {
      const waNumber = env.WA_NUMBER ? String(env.WA_NUMBER) : '';
      return new Response(JSON.stringify({ ...catalog, waNumber }), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store'
        }
      });
    }

    // 静态资源（index.html / app.js / data.js ...）
    return env.ASSETS.fetch(request);
  }
};
