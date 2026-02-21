# simple-site-optimizer

A lightweight utility for server-side rendering (SSR) and prerendering of Single Page Applications.

## Installation

```bash
npm install simple-site-optimizer
```

## Usage

```javascript
import { runServer, doPrerendering } from 'simple-site-optimizer';

// Start your main SSR server
runServer({
  buildFolder: './dist',
  staticRoutes: ['/about', '/contact'],
  dynamicRoutes: [], // add custom loaders here
  port: 3000,
  domain: 'https://example.com'
});

// Or, use the prerendering util as part of your build pipeline
doPrerendering({
  buildFolder: './dist',
  staticRoutes: ['/about', '/contact'],
  port: 3000,
  prerenderingPort: 4050
});
```

## Features
- Fast SSR caching with LMDB
- Built-in sitemap generation
- Configurable bot vs client routing
- Puppeteer-based prerendering support
