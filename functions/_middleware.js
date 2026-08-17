/**
 * Cloudflare Pages 全局中间件：密码门
 *
 * 所有请求（页面、静态资源、/api/data）都会先经过这里：
 * - 已登录（cookie 有效）→ 放行
 * - 未登录 → 返回登录页（密码只存在环境变量 PAS_WARD）
 * - 未配置 PAS_WARD → 不启用保护（避免网站被锁死）
 */
import { AUTH_COOKIE, sha256Hex, getCookie, loginPage } from './_login.js';

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const password = env.PAS_WARD ? String(env.PAS_WARD) : '';

  // 登录接口放行，由 functions/login.js 处理
  if (url.pathname === '/login') {
    if (request.method === 'POST') return next();
    return new Response(loginPage(''), {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' }
    });
  }

  // 未配置密码时不启用保护
  if (!password) return next();

  const expected = await sha256Hex(password);
  const cookie = getCookie(request.headers.get('Cookie'), AUTH_COOKIE);
  if (cookie === expected) return next();

  return new Response(loginPage(''), {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' }
  });
}
