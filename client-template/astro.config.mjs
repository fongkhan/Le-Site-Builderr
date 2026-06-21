// @ts-check
import { defineConfig } from 'astro/config';

// If building a specific site, use its subfolder under /sites/ as the base URL
const activeSiteSlug = process.env.ACTIVE_SITE_SLUG || '';
const base = activeSiteSlug ? `/sites/${activeSiteSlug}` : '/';

// https://astro.build/config
export default defineConfig({
  base: base
});
