export type BuiltInSourceId = 'divar' | 'sheypoor' | 'iran-tejarat' | 'niyazban';

export type SourceId = 'auto' | BuiltInSourceId | 'niaz' | 'generic';

export type SourceCatalogItem = {
  id: BuiltInSourceId;
  label: string;
  description: string;
  homepage: string;
  supportsCity: boolean;
  access: 'public-phone' | 'login-may-be-required';
};

export type TopicCampaignResult = {
  topic: string;
  city: string;
  campaign: Campaign;
  projects: Project[];
  runs: Run[];
};

export type Campaign = {
  id: number;
  topic: string;
  city: string;
  region: string;
  sources: BuiltInSourceId[];
  projectCount: number;
  runningRuns: number;
  completedRuns: number;
  failedRuns: number;
  progress: number;
  leadsFound: number;
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed';
  createdAt: string;
};

export type Project = {
  id: number;
  campaignId: number | null;
  name: string;
  targetUrl: string;
  source: SourceId;
  city: string;
  keywords: string[];
  maxPages: number;
  delayMs: number;
  status: 'ready' | 'running' | 'paused';
  createdAt: string;
  updatedAt: string;
};

export type Lead = {
  id: number;
  projectId: number;
  source: string;
  title: string;
  phone: string;
  phoneMasked: string;
  city: string;
  category: string;
  url: string;
  score: number;
  status: 'new' | 'qualified' | 'contacted' | 'excluded';
  isBusiness: boolean;
  discoveredAt: string;
};

export type Run = {
  id: number;
  projectId: number;
  projectName: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  pagesScanned: number;
  leadsFound: number;
  duplicatesSkipped: number;
  blockedPages: number;
  progress: number;
  message: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type DashboardData = {
  stats: {
    totalLeads: number;
    todayLeads: number;
    activeProjects: number;
    runningJobs: number;
    uniquePhones: number;
    averageScore: number;
  };
  recentLeads: Lead[];
  recentRuns: Run[];
  sourceCounts: Array<{ source: string; count: number }>;
  dailyCounts: Array<{ day: string; count: number }>;
};
