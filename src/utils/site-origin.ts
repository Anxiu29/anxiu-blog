type SiteEnvironment = { SITE_URL?: string; VERCEL_PROJECT_PRODUCTION_URL?: string };

/** Keep sitemap, canonical URLs and feeds on the same production origin. */
export function resolveSiteOrigin(env: SiteEnvironment = {}) {
 const raw = env.SITE_URL?.trim() || (env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
  ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL.trim()}` : 'https://anxiu-blog.vercel.app');
 const url = new URL(raw);
 if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
  throw new Error('SITE_URL 必须是 HTTPS 站点根地址，例如 https://your-blog.vercel.app');
 }
 return url.origin;
}
