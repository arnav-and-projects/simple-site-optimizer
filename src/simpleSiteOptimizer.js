import express from "express";
import { open } from "lmdb";
import cors from "cors";
import { match } from "path-to-regexp";
import path from "path";
import fs from "fs";
import { handleSitemapRequest } from "./sitemapGenerator.js";

/**
 * simpleSSR function
 * @param {Object} options
 * @param {string} options.buildFolder - Absolute path to the build folder
 * @param {string[]} options.staticRoutes - List of static routes to prerender
 * @param {Array<{loaderForBot: Function, loaderForClient: Function, path: string}>} options.dynamicRoutes - List of dynamic routes
 * @param {number} options.port - Main server port
 * @param {number} [options.prerenderingPort=4050] - Port for prerendering server
 * @param {'BOT_ONLY' | 'ALL_REQUESTS'} [options.staticRendering='ALL_REQUESTS'] - Prerendering strategy for static routes
 * @param {string} options.domain - Domain for the sitemap
 */

let removeTrailingSlashFunc = `

function removeTrailingSlash(str) {
  if (str.length > 1 && str[str.length - 1] === "/") {
    return str.slice(0, -1);
  }
  return str;
}

`;

/**
 * Escapes HTML special characters to prevent XSS.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Generates a clean HTML page for bots from the loaderForBot data.
 * @param {Object} data - The data returned by loaderForBot
 * @param {string} data.htmlHeadCode - Extra HTML to inject in <head>
 * @param {string} data.images - Comma-separated image URLs
 * @param {string} data.mainImage - Primary image URL for the page
 * @param {string} data.title - Page title
 * @param {string} data.text - Main text content
 * @param {Array<{title: string, link: string, images: string, mainImage: string}>} data.items - Content items
 * @returns {string} Full HTML string
 */
function generateBotHtml(data) {
  const { htmlHeadCode = "", images = "", mainImage = "", title = "", text = "", items = [] } = data;

  const safeTitle = escapeHtml(title);
  const safeText = escapeHtml(text);

  let mainImageHtml = "";
  if (mainImage) {
    mainImageHtml = `<img src="${escapeHtml(mainImage)}" alt="${safeTitle}" />`;
  }

  let imagesHtml = "";
  if (images) {
    const imageUrls = images.split(",").map((s) => s.trim()).filter(Boolean);
    imagesHtml = imageUrls.map((url) => `<img src="${escapeHtml(url)}" alt="${safeTitle}" />`).join("\n");
  }

  let itemsHtml = "";
  if (items && items.length > 0) {
    itemsHtml = items
      .map((item) => {
        const safeItemTitle = escapeHtml(item.title);

        let itemMainImageHtml = "";
        if (item.mainImage) {
          itemMainImageHtml = `<img src="${escapeHtml(item.mainImage)}" alt="${safeItemTitle}" />`;
        }

        let itemImagesHtml = "";
        if (item.images) {
          const itemImageUrls = item.images.split(",").map((s) => s.trim()).filter(Boolean);
          itemImagesHtml = itemImageUrls
            .map((url) => `<img src="${escapeHtml(url)}" alt="${safeItemTitle}" />`)
            .join("\n");
        }

        return `
        <article>
          ${item.title ? `<h2>${safeItemTitle}</h2>` : ""}
          ${item.link ? `<a href="${escapeHtml(item.link)}">${safeItemTitle || escapeHtml(item.link)}</a>` : ""}
          ${itemMainImageHtml}
          ${itemImagesHtml}
        </article>`;
      })
      .join("\n");
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  ${title ? `<title>${safeTitle}</title>` : ""}
  ${htmlHeadCode}
</head>
<body>
  <main>
    ${title ? `<h1>${safeTitle}</h1>` : ""}
    ${mainImageHtml}
    ${imagesHtml}
    ${text ? `<p>${safeText}</p>` : ""}
    ${itemsHtml}
  </main>
</body>
</html>`;
}

export default async function runServer(config) {
  const {
    buildFolder,
    staticRoutes,
    dynamicRoutes,
    port,
    prerenderingPort = 4050,
    staticRendering = "ALL_REQUESTS",
    domain,
  } = config;


  // 1. Validation
  if (port === prerenderingPort) {
    throw new Error("Main port and prerendering port cannot be the same");
  }

  // 2. Initialize LMDB
  const db = open({
    path: "pre-rendered-data",
    compression: true,
  });

  // 4. Main Server
  const mainApp = express();
  mainApp.use(cors());

  // Read the SPA index.html once for client-side dynamic route serving
  const indexHtmlPath = path.join(buildFolder, "index.html");
  let indexHtml = "";
  try {
    indexHtml = fs.readFileSync(indexHtmlPath, "utf-8");
  } catch (err) {
    console.warn("Could not read index.html from build folder:", err.message);
  }

  // Middleware to handle requests
  mainApp.use(async (req, res, next) => {
    const reqPathRaw = req.path;

    const isBot = /bot|googlebot|crawler|spider|robot|crawling/i.test(
      req.headers["user-agent"] || "",
    );

    // Check for sitemap request
    if (reqPathRaw.startsWith("/sitemap")) {
      const handled = await handleSitemapRequest(req, res, config);
      if (handled !== undefined) return;
      if (res.headersSent) return;
    }

    let [reqPath, queryString] = reqPathRaw.split("?");
    reqPath = removeTrailingSlash(reqPath);

    // Check if it's a static route
    if (staticRoutes.includes(reqPath)) {
      if (staticRendering === "BOT_ONLY" && !isBot) {
        return next();
      }

      const cached = db.get(reqPath);
      if (cached) {
        // cached is { html, data }
        const { html, data } = cached;

        const injection = `
          <script>
            window._PRELOADED_DATA_ = {
              data: ${JSON.stringify(data)},
              path: "${reqPath}"
            };
            window.getPreLoadedData = function() {
              var currentPath = removeTrailingSlash(window.location.pathname);
              if (window._PRELOADED_DATA_ && window._PRELOADED_DATA_.path === currentPath) {
                return window._PRELOADED_DATA_.data;
              }
            };

            ${removeTrailingSlashFunc}
          </script>`;

        let finalHtml = html;
        if (finalHtml.includes("<head>")) {
          finalHtml = finalHtml.replace("<head>", `<head>${injection}`);
        } else {
          finalHtml += injection;
        }
        return res.send(finalHtml);
      }
    }

    // Check if it's a dynamic route
    for (const routeConfig of dynamicRoutes) {
      const matcher = match(routeConfig.path, {
        decode: decodeURIComponent,
        strict: false,
      });
      const result = matcher(reqPath);

      const query = Object.fromEntries(new URLSearchParams(queryString));

      if (result) {
        try {
          const reqContext = {
            ...req,
            params: result.params,
            query,
          };

          if (isBot) {
            // --- BOT PATH ---
            // Call loaderForBot to get structured content
            if (!routeConfig.loaderForBot) break;

            const botData = await routeConfig.loaderForBot(reqContext);
            const botHtml = generateBotHtml(botData);
            return res.send(botHtml);
          } else {
            // --- CLIENT PATH ---
            // Call loaderForClient to get data, inject into window._PRELOADED_DATA_
            if (!routeConfig.loaderForClient) break;

            const clientData = await routeConfig.loaderForClient(reqContext);

            const injection = `
            <script>
              window._PRELOADED_DATA_ = {
                data: ${JSON.stringify(clientData)},
                path: "${reqPath}"
              };
              window.getPreLoadedData = function() {
                var currentPath = removeTrailingSlash(window.location.pathname);
                if (window._PRELOADED_DATA_ && window._PRELOADED_DATA_.path === currentPath) {
                  return window._PRELOADED_DATA_.data;
                }
              };

               ${removeTrailingSlashFunc}
            </script>`;

            // Inject data into the SPA index.html
            let finalHtml = indexHtml;
            if (finalHtml.includes("<head>")) {
              finalHtml = finalHtml.replace("<head>", `<head>${injection}`);
            } else {
              finalHtml += injection;
            }
            return res.send(finalHtml);
          }
        } catch (err) {
          console.error(`Error handling dynamic route ${reqPath}:`, err);
          // Fallback to next()
        }
      }
    }

    next();
  });

  // Serve static files (assets etc)
  mainApp.use(express.static(buildFolder));

  // Final Fallback for SPA (if not handled above)
  mainApp.get("*", (req, res) => {
    res.sendFile(path.join(buildFolder, "index.html"));
  });

  return new Promise((resolve, reject) => {
    const server = mainApp.listen(port, () => {
      console.log(`Main server started on port ${port}`);
      console.log(`http://localhost:${port}`);
      resolve(server);
    });
    server.on("error", reject);
  });
}

function removeTrailingSlash(str) {
  if (str.length > 1 && str[str.length - 1] === "/") {
    return str.slice(0, -1);
  }
  return str;
}
