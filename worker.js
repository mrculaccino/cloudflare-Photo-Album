/**
 * TheDupe - Cloudflare Worker（Assets + API）
 *
 * 部署方式：Workers 静态资源（wrangler.toml 中 assets.directory = ./dist）
 * - GET /api/data：返回商品数据 + WhatsApp 号码（号码只从环境变量 WA_NUMBER 读取）
 * - 其余请求：由 ASSETS binding 提供 dist/ 下的静态资源
 */
import catalog from './data.json';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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
