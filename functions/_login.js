/**
 * 密码门共享模块（供 _middleware.js 与 login.js 使用）
 *
 * 密码值只存在于环境变量 PAS_WARD，永远不会出现在前端代码/静态资源里。
 * 登录成功后种一个 HttpOnly cookie（值为密码的 SHA-256），中间件校验该 cookie。
 */
export const AUTH_COOKIE = 'dupe_auth';
export const AUTH_MAX_AGE = 60 * 60 * 24 * 30; // 30 天

export async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function getCookie(header, name) {
  if (!header) return null;
  const prefix = name + '=';
  for (const part of header.split(';')) {
    const s = part.trim();
    if (s.startsWith(prefix)) return s.slice(prefix.length);
  }
  return null;
}

export function loginPage(error) {
  const errHtml = error ? `<p class="error">${error}</p>` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TheDupe</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
           background: #0f1011; color: #f5f5f5; min-height: 100vh;
           display: flex; align-items: center; justify-content: center; }
    .card { background: #1b1d1f; border: 1px solid #2c2f33; border-radius: 14px;
            padding: 36px 32px; width: 100%; max-width: 360px; text-align: center; }
    .logo { font-size: 26px; font-weight: 800; letter-spacing: .3px; }
    .sub { color: #9aa0a6; margin: 10px 0 24px; font-size: 14px; }
    input[type=password] { width: 100%; padding: 12px 14px; border-radius: 10px;
                           border: 1px solid #3a3d42; background: #121416; color: #f5f5f5;
                           font-size: 15px; outline: none; }
    input[type=password]:focus { border-color: #25D366; }
    button { width: 100%; margin-top: 14px; padding: 12px; border: 0; border-radius: 10px;
             background: #25D366; color: #062b14; font-weight: 700; font-size: 15px; cursor: pointer; }
    button:hover { background: #1fbf5a; }
    .error { color: #ff7a7a; margin-top: 14px; font-size: 13px; }
  </style>
</head>
<body>
  <form class="card" method="post" action="/login">
    <div class="logo">TheDupe</div>
    <p class="sub">Enter the password to continue</p>
    <input type="password" name="password" placeholder="Password"
           autocomplete="current-password" required autofocus>
    <button type="submit">Enter</button>
    ${errHtml}
  </form>
</body>
</html>`;
}
