/**
 * Cloudflare Pages Function — GET /api/data
 *
 * 职责：向站点提供商品数据（waNumber 由环境变量注入，不硬编码在代码里）。
 *
 * - WhatsApp 号码通过 context.env.WA_NUMBER 读取；
 * - 未配置该环境变量时 waNumber 为空字符串（前端会隐藏/禁用 WhatsApp 入口）；
 * - data.json 在 Pages 构建时被打包进该函数，静态目录中不会暴露 data.json 原始文件。
 */
import catalog from '../../data.json';

export async function onRequestGet(context) {
  const { env } = context;
  const waNumber = env && env.WA_NUMBER ? String(env.WA_NUMBER) : '';

  return Response.json(
    { ...catalog, waNumber },
    {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=300'
      }
    }
  );
}
