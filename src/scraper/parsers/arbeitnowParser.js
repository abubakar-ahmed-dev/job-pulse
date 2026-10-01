import * as cheerio from "cheerio";

/**
 * Extracts job detail links and pagination from an Arbeitnow catalogue page.
 */
export function parseArbeitnowCataloguePage(html, pageUrl) {
  const $ = cheerio.load(html);
  const jobUrls = new Set();

  // Find job listing links:
  // Arbeitnow links point to /jobs/companies/<company>/<role>-<id>
  $("a[href*='/jobs/companies/']").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    // Filter out pure company overview links (which have only 4 segments, e.g. /jobs/companies/xyz)
    // Job detail links have a job slug after the company name: /jobs/companies/<company>/<job-slug-id>
    try {
      const urlObj = new URL(href, pageUrl);
      const parts = urlObj.pathname.split("/").filter(Boolean);
      // ['jobs', 'companies', 'company-name', 'job-slug-123']
      if (parts.length >= 4 && parts[0] === "jobs" && parts[1] === "companies") {
        jobUrls.add(urlObj.href);
      }
    } catch (err) {
      // Malformed href
    }
  });

  // Next page pagination link
  let nextPageUrl = null;
  const nextEl = $("a[rel='next'], a:contains('Next'), a:contains('Next Page')").first();
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
 * Extracts raw job fields from an Arbeitnow detail page with Schema.org JSON-LD and Cheerio DOM.
 */
export function parseArbeitnowJobDetailPage(html, jobUrl, sourcePageUrl) {
  const $ = cheerio.load(html);

  let title = null;
  let company = null;
  let locationRaw = null;
  let salaryRaw = null;
  let jobTypeRaw = null;
  let descriptionRaw = null;

  // 1. Try extracting structured data from JSON-LD schema
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const rawJson = $(el).text();
      const parsed = JSON.parse(rawJson);
      
      let jobPosting = null;
      if (parsed["@type"] === "JobPosting") {
        jobPosting = parsed;
      } else if (Array.isArray(parsed["@graph"])) {
        jobPosting = parsed["@graph"].find((item) => item["@type"] === "JobPosting");
      }

      if (jobPosting) {
        if (!title && jobPosting.title) title = String(jobPosting.title).trim();
        if (!company && jobPosting.hiringOrganization?.name) {
          company = String(jobPosting.hiringOrganization.name).trim();
        }
        if (!locationRaw) {
          if (jobPosting.jobLocationType === "TELECOMMUTE" || jobPosting.applicantLocationRequirements) {
            locationRaw = "Remote";
          } else if (jobPosting.jobLocation?.address?.addressLocality) {
            locationRaw = String(jobPosting.jobLocation.address.addressLocality).trim();
          }
        }
        if (!jobTypeRaw && jobPosting.employmentType) {
          jobTypeRaw = Array.isArray(jobPosting.employmentType)
            ? jobPosting.employmentType.join(", ")
            : String(jobPosting.employmentType);
        }
        if (!descriptionRaw && jobPosting.description) {
          // Parse HTML inside description string
          const $desc = cheerio.load(jobPosting.description);
          descriptionRaw = $desc.text().replace(/\s+/g, " ").trim();
        }
        if (!salaryRaw && jobPosting.baseSalary?.value?.value) {
          const currency = jobPosting.baseSalary.currency || "EUR";
          salaryRaw = `${jobPosting.baseSalary.value.value} ${currency}`;
        }
      }
    } catch (e) {
      // Ignore JSON parse error, fallback to DOM
    }
  });

  // 2. DOM extraction fallback
  if (!title) {
    title = $("h1").first().text().trim();
  }
  if (!title) {
    title = $("title").text().split("|")[0].split("–")[0].trim() || "Untitled Role";
  }

  if (!company) {
    company = $("a[href*='/companies/']").first().text().trim() || "Unknown Company";
  }

  if (!locationRaw) {
    const locEl = $("[itemprop='addressLocality'], .location, span:contains('Remote'), span:contains('Hybrid')").first();
    locationRaw = locEl.length ? locEl.text().trim() : "Remote / Germany";
  }

  if (!descriptionRaw) {
    const descContainer = $("[itemprop='description'], .job-description, article, #job-description").first();
    if (descContainer.length) {
      descriptionRaw = descContainer.text().replace(/\s+/g, " ").trim();
    }
  }

  // Tags and job types
  if (!jobTypeRaw) {
    $("span, div, a").each((_, el) => {
      const text = $(el).text().trim();
      if (/full[- ]?time/i.test(text)) jobTypeRaw = "Full-Time";
      else if (/part[- ]?time/i.test(text)) jobTypeRaw = "Part-Time";
      else if (/internship|werkstudent/i.test(text)) jobTypeRaw = "Internship";
      else if (/contract/i.test(text)) jobTypeRaw = "Contract";
    });
    if (!jobTypeRaw) jobTypeRaw = "Full-Time";
  }

  return {
    title,
    company,
    product_url: jobUrl,
    source_site: "Arbeitnow",
    location_raw: locationRaw,
    salary_raw: salaryRaw,
    job_type_raw: jobTypeRaw,
    description_raw: descriptionRaw && descriptionRaw.length > 0 ? descriptionRaw : null,
    source_page: sourcePageUrl,
    fetched_at: new Date().toISOString()
  };
}
