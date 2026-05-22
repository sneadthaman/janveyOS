export interface CrawlJob {
  id: string;
  vendor: string;
  start_url: string;
  allowed_domains: string[];
  include_patterns: string[];
  exclude_patterns: string[];
  max_pages: number;
  max_depth: number;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  pages_found: number;
  pages_ingested: number;
  errors: Array<{ message: string; url?: string }>;
  created_at: string;
  completed_at?: string | null;
}

export interface CrawledPage {
  id: string;
  crawl_job_id: string;
  url: string;
  page_title?: string | null;
  content_hash?: string | null;
  parse_status: "pending" | "parsed" | "skipped" | "failed";
  created_at: string;
}
