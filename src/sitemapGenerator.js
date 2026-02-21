import { match } from "path-to-regexp";

let pageSize = 10000; // 10K per sitemap page

export async function handleSitemapRequest(req, res, config) {
    const { domain, staticRoutes, dynamicRoutes, sitemapMaxSizePerPage } = config;

    if (sitemapMaxSizePerPage) {
        pageSize = sitemapMaxSizePerPage;
    }

    if (!domain) {
        console.warn("Domain not configured in config.js");
        return res.status(500).send("Domain configuration missing");
    }

    const reqPath = req.path;

    // 1. Root Sitemap Index: /sitemap.xml
    if (reqPath === "/sitemap.xml") {
        let dynamicSitemapIndex = "";

        // Add indices for dynamic routes
        for (const route of dynamicRoutes) {
            if (route.sitemapGenerator) {
                try {
                    const { uniqueName } = await route.sitemapGenerator();
                    if (uniqueName) {
                        dynamicSitemapIndex += `
  <sitemap>
    <loc>${domain}/sitemap-${uniqueName}.xml</loc>
  </sitemap>`;
                    }
                } catch (e) {
                    console.error("Error generating sitemap info for route", e);
                }
            }
        }

        // Always return a sitemap index
        let content = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${domain}/sitemap-static.xml</loc>
  </sitemap>
${dynamicSitemapIndex}
</sitemapindex>`;
        res.type('application/xml');
        return res.send(content);
    }

    // 1.5 Handle implicit static sitemap: /sitemap-static.xml
    if (reqPath === '/sitemap-static.xml') {
        let content = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;
        for (const route of staticRoutes) {
            content += `
  <url>
    <loc>${domain}${route}</loc>
    <changefreq>daily</changefreq>
    <priority>0.7</priority>
  </url>`;
        }
        content += `</urlset>`;
        res.type('application/xml');
        return res.send(content);
    }


    // 2. Paginated Dynamic Sitemap: /sitemap-<uniqueName>-<page>.xml
    // Check this FIRST because the regex for index (/-([a-zA-Z0-9_-]+).xml)
    // might also match /-post-1.xml if we are not careful (since -1 is allowed in the char class).
    const pageMatch = reqPath.match(/^\/sitemap-([a-zA-Z0-9_-]+)-(\d+)\.xml$/);
    if (pageMatch) {
        const uniqueName = pageMatch[1];
        const page = parseInt(pageMatch[2], 10);

        let targetRoute = null;
        let loader = null;
        let total = 0;

        for (const r of dynamicRoutes) {
            if (r.sitemapGenerator) {
                const info = await r.sitemapGenerator();
                if (info.uniqueName === uniqueName) {
                    targetRoute = r;
                    loader = info.loader;
                    total = info.total;
                    break;
                }
            }
        }

        if (!targetRoute || !loader) {
            return res.status(404).send("Sitemap not found");
        }


        const itemsToSkip = (page - 1) * pageSize;

        const items = await loader({ limit: pageSize, itemsToSkip });

        let content = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

        for (const item of items) {
            const lastmod = item.lastUpdatedAt || item.lastmod || new Date().toISOString();
            let url = item.url;
            if (!url.startsWith("http")) {
                url = domain + (url.startsWith("/") ? "" : "/") + url;
            }

            content += `
  <url>
    <loc>${url}</loc>
    <lastmod>${lastmod}</lastmod>
  </url>`;
        }

        content += `</urlset>`;
        res.type('application/xml');
        return res.send(content);
    }

    // 3. Dynamic Route Sitemap Index: /sitemap-<uniqueName>.xml
    const indexMatch = reqPath.match(/^\/sitemap-([a-zA-Z0-9_-]+)\.xml$/);
    if (indexMatch) {
        const uniqueName = indexMatch[1];
        if (uniqueName === 'static') return res.status(404).send('Not Found'); // handled elsewhere

        let targetRoute = null;
        let totalItems = 0;

        for (const r of dynamicRoutes) {
            if (r.sitemapGenerator) {
                const info = await r.sitemapGenerator();
                if (info.uniqueName === uniqueName) {
                    targetRoute = r;
                    totalItems = info.total;
                    break;
                }
            }
        }

        if (!targetRoute) {
            return res.status(404).send("Sitemap not found");
        }

        // Generate Index

        const totalPages = Math.ceil(totalItems / pageSize);

        // Handle case where totalItems is 0? 
        // If 0, totalPages = 0. We might want to handle empty properly.
        // Assuming at least 1? If 0, loop won't run, empty index.

        let content = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

        for (let i = 1; i <= totalPages; i++) {
            content += `
  <sitemap>
    <loc>${domain}/sitemap-${uniqueName}-${i}.xml</loc>
  </sitemap>`;
        }

        content += `</sitemapindex>`;
        res.type('application/xml');
        return res.send(content);
    }

}
