import { parseWwrCataloguePage, parseWwrJobDetailPage } from "./parsers/wwrParser.js";
import { parseArbeitnowCataloguePage, parseArbeitnowJobDetailPage } from "./parsers/arbeitnowParser.js";

/**
 * Re-export dedicated parsers for direct usage.
 */
export { parseWwrCataloguePage, parseWwrJobDetailPage } from "./parsers/wwrParser.js";
export { parseArbeitnowCataloguePage, parseArbeitnowJobDetailPage } from "./parsers/arbeitnowParser.js";

/**
 * Determines target source based on URL.
 */
export function detectSourceSite(url) {
  if (url && url.includes("arbeitnow.com")) {
    return "Arbeitnow";
  }
  return "WeWorkRemotely";
}

/**
 * Federated catalogue page parser.
 * Dispatches to WWR or Arbeitnow parser based on page URL.
 */
export function parseCataloguePage(html, pageUrl) {
  if (detectSourceSite(pageUrl) === "Arbeitnow") {
    return parseArbeitnowCataloguePage(html, pageUrl);
  }
  return parseWwrCataloguePage(html, pageUrl);
}

/**
 * Federated job detail page parser.
 * Dispatches to WWR or Arbeitnow parser based on job URL.
 */
export function parseJobDetailPage(html, jobUrl, sourcePageUrl) {
  if (detectSourceSite(jobUrl) === "Arbeitnow" || detectSourceSite(sourcePageUrl) === "Arbeitnow") {
    return parseArbeitnowJobDetailPage(html, jobUrl, sourcePageUrl);
  }
  return parseWwrJobDetailPage(html, jobUrl, sourcePageUrl);
}
