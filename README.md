# simple-site-optimizer

A lightweight utility for server-side rendering (SSR) and static site generation (SSG) of Single Page Applications using Express and Puppeteer.

## Installation

```bash
npm install simple-site-optimizer
```

## How SSG Works (Static Site Generation)
SSG is done through Puppeteer at build time. Your frontend code needs little to no changes.

### How it works
1. You list your static routes in your configuration (e.g. `config.js`).
2. At build time, Puppeteer visits each route and saves the fully-rendered HTML.
3. When a user or bot visits that route, the saved HTML is served instantly.
4. Bots can crawl the page without executing JS.
5. Browsers see UI immediately without waiting for CSR.

Puppeteer only runs at build time — zero impact on production performance.

### Saving API data at build time
If your static page loads data from an API, that data also needs to be saved for SSG to work:

After fetching your data, assign it to `window.EXPORT_STATIC_PAGE_DATA`:
```javascript
window.EXPORT_STATIC_PAGE_DATA = data;
```

On the client, check if saved data is available:
```javascript
let preLoadedData = window.getPreLoadedData && window.getPreLoadedData();
```
- `getPreLoadedData` is injected by the server — no imports needed
- It checks the current page path and returns the saved data if it matches
- This prevents the client from re-fetching data that was already saved at build time

### BOT_ONLY mode for SSG
If hydration breaks due to non-deterministic logic (like `Math.random`), you can restrict SSG to bots only:
```javascript
// in your config
staticRendering: "BOT_ONLY"
```

## How SSR Works (Server Side Rendering)
SSR in this project works differently from traditional frameworks like Next.js or Remix. For dynamic routes (e.g., `/post/:id`) where you might have thousands of pages, each route has two loaders that handle bots and clients separately:

### Data-Only SSR (for clients / browsers)
For real users, SSR is data-only:
1. When a client requests `/post/123`, the server calls `loaderForClient`
2. The returned data is injected into `window._PRELOADED_DATA_`
3. The standard SPA JavaScript bundle is served alongside the data
4. Since data arrives with the page, the UI renders instantly — no API wait time
5. CSR still happens, but with data already available

**Why this approach?**
- No hydration issues — the same React components render client-side as usual
- No server-side React rendering needed
- Data is just available sooner

```javascript
// In your component
let preLoadedData = window.getPreLoadedData && window.getPreLoadedData();

if (preLoadedData) {
  // Data arrived with the page — use it directly
  data = preLoadedData;
} else {
  // Client-side navigation — fetch normally
  data = await fetch("/api/posts/" + id).then((r) => r.json());
}
```

### Bot Template SSR (for bots / crawlers)
For bots (Google, social media crawlers, etc.), UI doesn't matter — only content matters:
1. When a bot requests `/post/123`, the server calls `loaderForBot`
2. The returned data is rendered into a built-in HTML template — clean, semantic HTML
3. No JavaScript is executed — bots get pure content
4. This ensures excellent SEO without any frontend complexity

#### `loaderForBot` return structure
`loaderForBot` must return this object:
```javascript
{
  htmlHeadCode: "",   // Extra HTML for <head> (meta tags, Open Graph, etc.)
  images: "",         // Comma-separated image URLs
  mainImage: "",      // Primary image URL for the page
  title: "",          // Page title (rendered as <h1> and <title>)
  text: "",           // Main text content
  items: [            // List of content sections
    {
      title: "",      // Section title (rendered as <h2>)
      link: "",       // Link URL
      images: "",     // Comma-separated image URLs
      mainImage: ""   // Primary image for this section
    }
  ]
}
```

## Getting Started

### Configuration
```javascript
const staticRoutes = [
  "/",
  // Add other static routes here
];

let config = {
  buildFolder: buildDir,
  staticRoutes,
  dynamicRoutes: [
    {
      path: "/post/:id",
      loaderForBot: async ({ params }) => {
        return {
          htmlHeadCode: "",
          images: "",
          mainImage: "",
          title: "Post Title",
          text: "Post content...",
          items: [],
        };
      },
      loaderForClient: async ({ params }) => {
        let res = await fetch("https://jsonplaceholder.typicode.com/posts/" + params.id);
        return res.json();
      },
      sitemapGenerator: async () => {
        return {
          uniqueName: "posts",
          total: 100000,
          loader: async ({ limit, itemsToSkip }) => {
            let items = [];
            for (let i = 0; i < limit; i++) {
              items.push({
                url: \`/post/\${itemsToSkip + i}\`,
                lastUpdatedAt: new Date().toISOString(),
              });
            }
            return items;
          },
        };
      },
    },
  ],
  port: PORT,
  prerenderingPort: PRERENDER_PORT,
  domain: "https://example.com",
};

export default config;
```

### Server Usage

```javascript
import { runServer, doPrerendering } from 'simple-site-optimizer';
import config from './config.js';

// Start your main SSR server
runServer(config);

// Or, use the prerendering util as part of your build pipeline
doPrerendering(config);
```

### Commands
| Command | Description |
|---|---|
| `npm run dev` | Start backend & frontend (no SSR/SSG) |
| `npm run build` | Build frontend + pre-render static pages |
| `npm run optimized-frontend` | Start frontend with SSR & SSG enabled |
| `npm run backend` | Start backend only |

*(Important: Run `npm run build` before `npm run optimized-frontend` — the build step does the pre-rendering).*

## Hydration Setup
If you replace the frontend folder, enable hydration in your entry file:

```javascript
import React from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import { BrowserRouter } from "react-router-dom";

let container = document.getElementById("root");

let Component = (
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

if (container.innerHTML.trim()) {
  hydrateRoot(container, Component);
} else {
  createRoot(container).render(Component);
}
```

## Sitemap Generation

### Setup
1. Add your domain
```javascript
let config = {
  domain: "https://your-domain.com",
  // ... other config
};
```
2. Add `sitemapGenerator` to dynamic routes
```javascript
{
  path: "/post/:id",
  loaderForBot: async ({ params }) => { /* ... */ },
  loaderForClient: async ({ params }) => { /* ... */ },

  sitemapGenerator: async () => {
    const totalPosts = 100000;

    return {
      uniqueName: "post",          // Unique identifier for this route
      total: totalPosts,           // Total number of pages
      loader: async ({ limit, itemsToSkip }) => {
        // Fetch a batch of URLs from your database
        return posts.map(post => ({
          url: \`/post/\${post.id}\`,
          lastUpdatedAt: post.updatedAt,  // ISO date string
        }));
      },
    };
  },
}
```

### Loader parameters
| Parameter | Description |
|---|---|
| limit | Max items to return (default: 10,000) |
| itemsToSkip | Number of items to skip (for pagination) |

### Generated endpoints
| Endpoint | Description |
|---|---|
| `/sitemap.xml` | Main sitemap index |
| `/sitemap-static.xml` | Static routes sitemap |
| `/sitemap-<name>.xml` | Dynamic route sitemap index (e.g., `/sitemap-post.xml`) |
| `/sitemap-<name>-<page>.xml` | Paginated sitemap (e.g., `/sitemap-post-1.xml`) — up to 10,000 URLs each |

## Precautions
- If using `<a target="_blank">`, always add `rel="noopener noreferrer"`. Without it, Puppeteer may add the attribute for security, causing hydration mismatches (This is a theoretical issue — in practice it hasn't occurred).

## Benefits
- Minimal learning curve — You only need to know React & Express
- Minimal frontend changes — Frontend is a standard React app
- Works with any frontend — Replace the frontend folder with Vue, Svelte, etc.
- No hydration issues — Data-only SSR for clients avoids hydration problems
- Perfect SEO — Bots get clean, semantic HTML with all content

## Use Cases
- Add SSR to a Capacitor project: Capacitor requires a clean build folder, but frameworks like Next.js tightly integrate backend and frontend code. With data-only SSR, your Capacitor project needs very minimal changes.
- Large existing codebase: If rewriting in Next.js / Remix isn't practical, this approach requires very minimal frontend changes.
