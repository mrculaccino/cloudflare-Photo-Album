/**
 * 登录接口：校验密码，成功后种 cookie 并跳回首页
 */
import { AUTH_COOKIE, AUTH_MAX_AGE, sha256Hex, loginPage } from './_login.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const password = env.PAS_WARD ? String(env.PAS_WARD) : '';

  let input = '';
  try {
    const form = await request.formData();
    input = String(form.get('password') || '');
  } catch (e) {
    input = '';
  }

  if (password && input === password) {
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
