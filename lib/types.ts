export interface Client {
  id: string;
  name: string;
  assignee: string;
  blog_url: string;
  created_at: string;
}

export interface Keyword {
  id: string;
  client_id: string;
  keyword: string;
  priority: number;
  current_rank: number | null;
  previous_rank: number | null;
  matched_title: string | null;
  matched_url: string | null;
  smart_block_name: string | null;
  smart_block_rank: number | null;
  updated_at: string;
  created_at: string;
}

export interface ViewResult {
  rank: number;
  title: string;
  link: string;
}

export interface SmartBlockResult {
  rank: number;
  title: string;
  link: string;
  blockName: string;
}

export interface KeywordHistory {
  id: string;
  keyword_id: string;
  rank: number | null;
  tracked_date: string;
  created_at: string;
}

export interface SearchApiResponse {
  results: ViewResult[];
  found: ViewResult | null;
  foundRank: number | null;
  smartBlockResults: SmartBlockResult[];
  foundInSmartBlock: SmartBlockResult | null;
}

export interface CafeClient {
  id: string;
  name: string;
  assignee: string;
  cafe_url?: string;
  created_at: string;
}

export interface CafeKeyword {
  id: string;
  client_id: string;
  keyword: string;
  post_url: string | null;
  post_title: string | null;
  current_rank: number | null;
  previous_rank: number | null;
  matched_title: string | null;
  matched_url: string | null;
  smart_block_name: string | null;
  smart_block_rank: number | null;
  is_reply: boolean;
  reply_since: string | null;
  updated_at: string;
  created_at: string;
}

export interface CafeKeywordHistory {
  id: string;
  keyword_id: string;
  rank: number | null;
  tracked_date: string;
  created_at: string;
}

export interface ReporterKeyword {
  id: string;
  client_id: string;
  keyword: string;
  created_at: string;
  entries?: ReporterBlogEntry[];
}

export interface ReporterBlogEntry {
  id: string;
  keyword_id: string;
  blog_url: string;
  current_rank: number | null;
  previous_rank: number | null;
  smart_block_name: string | null;
  smart_block_rank: number | null;
  matched_title: string | null;
  matched_url: string | null;
  updated_at: string;
  created_at: string;
}
