import * as cheerio from "cheerio";

/**
 * Extracts job detail links and pagination from a WeWorkRemotely catalogue page.
 */
export function parseWwrCataloguePage(html, pageUrl) {
  const $ = cheerio.load(html);
  const jobUrls = new Set();

  // Find job listing links
  $("li.new-listing-container a, article.jobs li a, ul.jobs li a, a.listing-link--unlocked").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    
    // Only capture job detail pages, skip company or promo links
    if (href.includes("/remote-jobs/") || href.includes("/jobs/")) {
      try {
        const absoluteUrl = new URL(href, pageUrl).href;
        jobUrls.add(absoluteUrl);
      } catch (err) {
        // Skip malformed hrefs
      }
    }
  });

  // Find next pagination link
  let nextPageUrl = null;
  const nextEl = $("a[rel='next'], a.next_page, .pagination a:contains('Next'), a:contains('next page')").first();
  if (nextEl.length && nextEl.attr("href")) {
    try {
      nextPageUrl = new URL(nextEl.attr("href"), pageUrl).href;
    } catch (err) {
      nextPageUrl = null;
    }
  }

  return {
    jobUrls: Array.from(jobUrls),
    nextPageUrl
  };
}

/**
 * Extracts raw job fields from a WeWorkRemotely detail page with provenance receipts.
 */
export function parseWwrJobDetailPage(html, jobUrl, sourcePageUrl) {
  const $ = cheerio.load(html);

  // 1. Title
  let title = $("h1.lis-container__job__header__title, h1, .new-listing__header__title").first().text().trim();
  if (!title) {
    title = $("title").text().split("|")[0].trim() || "Untitled Role";
  }

  // 2. Company
  let company = $(".lis-container__job__sidebar__companyDetails__info__title__text, .new-listing__company-name, .company, h2.company").first().text().trim();
  if (!company) {
    company = "Unknown Company";
  }

  // 3. Location
  let locationRaw = $(".lis-container__job__sidebar__companyDetails__info__location, .new-listing__company-headquarters, .location").first().text().trim();
  if (!locationRaw) {
    locationRaw = "Remote (Worldwide)";
  }

  // 4. Job Type & Salary
  let jobTypeRaw = null;
  let salaryRaw = null;

  $(".new-listing__categories__category, .job-tag, .tag, li").each((_, el) => {
    const text = $(el).text().trim();
    if (/full[- ]?time/i.test(text)) jobTypeRaw = "Full-Time";
    if (/part[- ]?time/i.test(text)) jobTypeRaw = "Part-Time";
    if (/contract/i.test(text)) jobTypeRaw = "Contract";
    if (/\$|USD|GBP|EUR|€|£/i.test(text) && /\d/.test(text)) {
      salaryRaw = text;
    }
  });

  // 5. Description
  let descriptionRaw = null;
  const descContainer = $("#job-details, .lis-container__job__body, .job-details, article.description, main").first();
  if (descContainer.length) {
    descriptionRaw = descContainer.text().replace(/\s+/g, " ").trim();
  }

  return {
    title,
    company,
    product_url: jobUrl,
    source_site: "WeWorkRemotely",
    location_raw: locationRaw,
    salary_raw: salaryRaw,
    job_type_raw: jobTypeRaw,
    description_raw: descriptionRaw && descriptionRaw.length > 0 ? descriptionRaw : null,
    source_page: sourcePageUrl,
    fetched_at: new Date().toISOString()
  };
}
