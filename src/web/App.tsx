import { useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowUpLeft, BadgeCheck, BarChart3, BriefcaseBusiness,
  Check, ChevronDown, CircleHelp, Copy, Database, Download, ExternalLink, Eye,
  FileSpreadsheet, Filter, Gauge, Globe2, LayoutDashboard, ListFilter, LoaderCircle,
  MapPin, Menu, MoreHorizontal, Pause, Phone, Play, Plus, Radar, RefreshCw, Search, Settings,
  ShieldCheck, Sparkles, Target, TimerReset, Users, X, Zap,
} from 'lucide-react';
import type { BuiltInSourceId, Campaign, DashboardData, Lead, Project, Run, SourceCatalogItem, SourceId, TopicCampaignResult } from '../shared/types';
import CloudCaptureView from './CloudCaptureView';
import HistoryControls from './HistoryControls';

type View = 'dashboard' | 'projects' | 'leads' | 'captured' | 'runs' | 'exports' | 'settings';
class AuthRequiredError extends Error {}

const sourceLabel: Record<string, string> = {
  auto: 'تشخیص خودکار', divar: 'دیوار', sheypoor: 'شیپور', 'iran-tejarat': 'ایران تجارت',
  niyazban: 'نیازبان', niaz: 'نیاز', generic: 'سایت عمومی',
};
const statusLabel: Record<string, string> = {
  ready: 'آماده', running: 'در حال اجرا', paused: 'متوقف', queued: 'در صف', completed: 'تکمیل‌شده', skipped: 'بررسی دستی',
  partial: 'تکمیل ناقص', failed: 'ناموفق', cancelled: 'لغوشده', new: 'جدید', qualified: 'باارزش', contacted: 'پیگیری‌شده', excluded: 'کنارگذاشته',
};

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...options?.headers } });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401 && path !== '/api/auth/login') throw new AuthRequiredError(payload.error ?? 'ورود لازم است.');
  if (!response.ok) throw new Error(payload.error ?? 'خطا در ارتباط با سرور');
  return payload as T;
}

function faNumber(value: number | string): string {
  return Number(value).toLocaleString('fa-IR');
}

function faDate(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('fa-IR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

const navItems: Array<{ id: View; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', label: 'داشبورد', icon: LayoutDashboard },
  { id: 'projects', label: 'پویش‌های انبوه', icon: Target },
  { id: 'leads', label: 'بانک سرنخ‌ها', icon: Users },
  { id: 'captured', label: 'آگهی‌های مرورگر', icon: Globe2 },
  { id: 'runs', label: 'تاریخچه اجرا', icon: Activity },
  { id: 'exports', label: 'خروجی و گزارش', icon: FileSpreadsheet },
  { id: 'settings', label: 'تنظیمات', icon: Settings },
];

export default function App() {
  const [view, setView] = useState<View>('dashboard');
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [sources, setSources] = useState<SourceCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [topicModalOpen, setTopicModalOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [globalSearch, setGlobalSearch] = useState('');
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

  const loadAll = async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [d, p, l, r, s, c] = await Promise.all([
        api<DashboardData>('/api/dashboard'), api<Project[]>('/api/projects'), api<Lead[]>('/api/leads'), api<Run[]>('/api/runs'), api<SourceCatalogItem[]>('/api/sources'), api<Campaign[]>('/api/campaigns'),
      ]);
      setDashboard(d); setProjects(p); setLeads(l); setRuns(r); setSources(s); setCampaigns(c);
    } catch (error) {
      if (error instanceof AuthRequiredError) setAuthRequired(true);
      else setToast({ kind: 'error', text: error instanceof Error ? error.message : 'خطا در دریافت اطلاعات' });
    } finally { setLoading(false); }
  };

  useEffect(() => { void loadAll(); }, []);
  useEffect(() => {
    if (!runs.some((run) => run.status === 'running' || run.status === 'queued')) return;
    const timer = window.setInterval(() => void loadAll(true), 1800);
    return () => window.clearInterval(timer);
  }, [runs]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const filteredLeads = useMemo(() => {
    const term = globalSearch.trim().toLowerCase();
    return leads.filter((lead) => {
      const matchesCampaign = !selectedCampaignId || projects.find((project) => project.id === lead.projectId)?.campaignId === selectedCampaignId;
      const matchesTerm = !term || `${lead.title} ${lead.phone} ${lead.city} ${lead.category}`.toLowerCase().includes(term);
      return matchesCampaign && matchesTerm;
    });
  }, [leads, projects, selectedCampaignId, globalSearch]);

  const runProject = async (project: Project) => {
    try {
      await api<Run>(`/api/projects/${project.id}/run`, { method: 'POST', body: '{}' });
      setToast({ kind: 'ok', text: `اجرای «${project.name}» شروع شد.` });
      await loadAll(true);
      setView('runs');
    } catch (error) { setToast({ kind: 'error', text: error instanceof Error ? error.message : 'اجرای پروژه ممکن نشد.' }); }
  };

  const updateLead = async (lead: Lead, status: Lead['status']) => {
    try {
      await api(`/api/leads/${lead.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      setLeads((items) => items.map((item) => item.id === lead.id ? { ...item, status } : item));
      setToast({ kind: 'ok', text: 'وضعیت سرنخ به‌روزرسانی شد.' });
    } catch (error) { setToast({ kind: 'error', text: error instanceof Error ? error.message : 'خطا در ذخیره' }); }
  };

  const launchCampaign = async (topic: string, city = 'کل ایران', selectedSources?: BuiltInSourceId[]) => {
    try {
      const result = await api<TopicCampaignResult>('/api/campaigns/topic', {
        method: 'POST',
        body: JSON.stringify({ topic, city, sources: selectedSources, maxPages: 7, complianceAccepted: true }),
      });
      setTopicModalOpen(false);
      await loadAll(true);
      setSelectedCampaignId(result.campaign.id);
      setToast({ kind: 'ok', text: `پویش «${result.topic}» ثبت شد؛ فقط منابع دارای داده عمومی خودکار بررسی می‌شوند.` });
      setView('projects');
    } catch (error) {
      setToast({ kind: 'error', text: error instanceof Error ? error.message : 'ساخت پویش ممکن نشد.' });
      throw error;
    }
  };

  const retryCampaign = async (campaign: Campaign) => {
    try {
      await api(`/api/campaigns/${campaign.id}/run`, { method: 'POST', body: '{}' });
      await loadAll(true);
      setToast({ kind: 'ok', text: `منابع عمومی «${campaign.topic}» دوباره بررسی شدند.` });
    } catch (error) {
      setToast({ kind: 'error', text: error instanceof Error ? error.message : 'اجرای دوباره ممکن نشد.' });
    }
  };

  const handleNavigate = (next: View) => { setView(next); setSidebarOpen(false); };

  const login = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoginBusy(true); setLoginError('');
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: loginPassword }) });
      setLoginPassword(''); setAuthRequired(false);
      await loadAll();
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'ورود ممکن نشد.');
    } finally { setLoginBusy(false); }
  };

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST', body: '{}' });
    setDashboard(null); setLeads([]); setProjects([]); setRuns([]); setCampaigns([]); setAuthRequired(true);
  };

  if (authRequired) return <main className="login-page"><form className="login-card" onSubmit={login}>
    <div className="brand-mark"><Radar size={29} /></div><h1>ورود به رادار لید</h1>
    <p>بانک شماره‌ها و فایل‌های خروجی فقط پس از ورود مدیریتی نمایش داده می‌شوند.</p>
    <label htmlFor="panel-password">رمز پنل</label>
    <input id="panel-password" type="password" autoComplete="current-password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} required autoFocus />
    {loginError && <span className="login-error"><AlertTriangle size={15} /> {loginError}</span>}
    <button className="primary-button" type="submit" disabled={loginBusy}>{loginBusy ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />} ورود امن</button>
    <small>کد تأیید سایت‌های آگهی را اینجا وارد نکنید.</small>
  </form></main>;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark"><Radar size={27} strokeWidth={2.4} /></div>
          <div><strong>رادار لید</strong><span>LEAD INTELLIGENCE</span></div>
        </div>
        <nav>
          <p className="nav-label">فضای کاری</p>
          {navItems.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => handleNavigate(item.id)}><Icon size={20} /><span>{item.label}</span>{item.id === 'leads' && leads.length > 0 && <em>{faNumber(leads.length)}</em>}</button>;
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="compliance-mini"><ShieldCheck size={18} /><div><b>حالت امن فعال</b><span>رعایت robots.txt و نرخ درخواست</span></div></div>
          <button className="help-link" onClick={() => void logout()}><ShieldCheck size={18} /> خروج از پنل</button>
          <button className="help-link"><CircleHelp size={18} /> راهنمای شروع سریع</button>
        </div>
      </aside>
      {sidebarOpen && <button className="sidebar-backdrop" aria-label="بستن منو" onClick={() => setSidebarOpen(false)} />}

      <main className="main-area">
        <header className="topbar">
          <button className="icon-btn mobile-menu" aria-label="بازکردن منو" onClick={() => setSidebarOpen(true)}><Menu size={21} /></button>
          <div className="searchbox"><Search size={19} /><input value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} placeholder="جستجو در سرنخ‌ها، شماره یا شهر…" /></div>
          <div className="topbar-actions">
            <div className="live-pill"><i /> سیستم آماده است</div>
            <button className="icon-btn" onClick={() => void loadAll()} title="به‌روزرسانی"><RefreshCw size={19} /></button>
            <button className="primary-button" onClick={() => setTopicModalOpen(true)}><Radar size={19} /> پویش موضوعی</button>
          </div>
        </header>

        <section className="workspace">
          {loading && !dashboard ? <LoadingState /> : <>
            {view === 'dashboard' && <Dashboard data={dashboard!} projects={projects} campaigns={campaigns} sources={sources} onLaunch={launchCampaign} onAdvanced={() => setModalOpen(true)} onNavigate={setView} />}
            {view === 'projects' && <CampaignsView campaigns={campaigns} projects={projects} onNew={() => setTopicModalOpen(true)} onAdvanced={() => setModalOpen(true)} onRetry={retryCampaign} onResults={(campaign) => { setSelectedCampaignId(campaign.id); setView('leads'); }} />}
            {view === 'leads' && <LeadsView leads={filteredLeads} projects={projects} campaigns={campaigns} selectedCampaignId={selectedCampaignId} onCampaignChange={setSelectedCampaignId} onUpdate={updateLead} />}
            {view === 'captured' && <CloudCaptureView />}
            {view === 'runs' && <RunsView runs={runs} onRefresh={() => void loadAll(true)} />}
            {view === 'exports' && <ExportsView leads={leads} projects={projects} />}
            {view === 'settings' && <SettingsView />}
          </>}
        </section>
      </main>

      {modalOpen && <NewProjectModal onClose={() => setModalOpen(false)} onCreated={async () => { setModalOpen(false); await loadAll(true); setToast({ kind: 'ok', text: 'پروژه با موفقیت ساخته شد.' }); setView('projects'); }} />}
      {topicModalOpen && <TopicCampaignModal sources={sources} onClose={() => setTopicModalOpen(false)} onAdvanced={() => { setTopicModalOpen(false); setModalOpen(true); }} onLaunch={launchCampaign} />}
      {toast && <div className={`toast ${toast.kind}`}><span>{toast.kind === 'ok' ? <Check size={18} /> : <AlertTriangle size={18} />}</span>{toast.text}</div>}
    </div>
  );
}

function PageHead({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) {
  return <div className="page-head"><div><p>{eyebrow}</p><h1>{title}</h1><span>{description}</span></div>{actions && <div className="page-actions">{actions}</div>}</div>;
}

function Dashboard({ data, campaigns, sources, onLaunch, onAdvanced, onNavigate }: { data: DashboardData; projects: Project[]; campaigns: Campaign[]; sources: SourceCatalogItem[]; onLaunch: (topic: string) => Promise<void>; onAdvanced: () => void; onNavigate: (view: View) => void }) {
  const maxDay = Math.max(1, ...data.dailyCounts.map((item) => item.count));
  const sourceTotal = Math.max(1, data.sourceCounts.reduce((sum, item) => sum + item.count, 0));
  const colors = ['#39d6c5', '#6d8cff', '#ffad5a', '#be7aff'];
  const gradient = data.sourceCounts.length ? `conic-gradient(${data.sourceCounts.map((item, index) => {
    const before = data.sourceCounts.slice(0, index).reduce((sum, value) => sum + value.count, 0) / sourceTotal * 100;
    const after = before + item.count / sourceTotal * 100;
    return `${colors[index % colors.length]} ${before}% ${after}%`;
  }).join(',')})` : 'conic-gradient(#1b2940 0 100%)';
  return <>
    <PageHead eyebrow="رادار بازار ایران" title="موضوع بده؛ منابع با ما" description="یک موضوع بنویس تا رادار آن را هم‌زمان در منابع منتخب بازار ایران دنبال کند." actions={<button className="ghost-button" onClick={onAdvanced}><Globe2 size={17} /> لینک اختصاصی</button>} />
    <TopicLauncher sources={sources} onLaunch={onLaunch} />
    {!campaigns.length && <div className="welcome-banner">
      <div className="welcome-icon"><Sparkles size={27} /></div><div><b>اولین پویش آماده است</b><span>فقط موضوع بالا را وارد کن؛ لینک هر منبع و صف اجرا خودکار ساخته می‌شود.</span></div>
    </div>}
    <div className="stats-grid">
      <StatCard label="کل سرنخ‌ها" value={data.stats.totalLeads} detail={`+${faNumber(data.stats.todayLeads)} امروز`} icon={Users} tone="cyan" />
      <StatCard label="شماره یکتا" value={data.stats.uniquePhones} detail="پس از حذف تکراری‌ها" icon={Phone} tone="blue" />
      <StatCard label="پویش انبوه" value={campaigns.length} detail={`${faNumber(campaigns.filter((item) => item.status === 'running' || item.status === 'queued').length)} پویش در جریان`} icon={Target} tone="orange" />
      <StatCard label="میانگین کیفیت" value={data.stats.averageScore} suffix="/۱۰۰" detail="امتیاز هوشمند سرنخ" icon={Gauge} tone="purple" />
    </div>
    <div className="dashboard-grid">
      <section className="panel chart-panel">
        <PanelTitle title="روند کشف سرنخ" subtitle="هفت روز اخیر" icon={BarChart3} />
        <div className="bar-chart">
          {data.dailyCounts.map((item) => <div className="bar-column" key={item.day}><span>{item.count ? faNumber(item.count) : ''}</span><div style={{ height: `${Math.max(6, item.count / maxDay * 100)}%` }} /><small>{new Intl.DateTimeFormat('fa-IR', { weekday: 'short' }).format(new Date(`${item.day}T12:00:00`))}</small></div>)}
        </div>
      </section>
      <section className="panel source-panel">
        <PanelTitle title="ترکیب منابع" subtitle="توزیع بانک فعلی" icon={Globe2} />
        <div className="source-content"><div className="donut" style={{ background: gradient }}><div><b>{faNumber(data.stats.totalLeads)}</b><span>سرنخ</span></div></div><div className="legend">
          {data.sourceCounts.length ? data.sourceCounts.map((item, index) => <div key={item.source}><i style={{ background: colors[index % colors.length] }} /><span>{sourceLabel[item.source] ?? item.source}</span><b>{faNumber(item.count)}</b></div>) : <div className="muted">هنوز داده‌ای نیست</div>}
        </div></div>
      </section>
    </div>
    <section className="panel table-panel">
      <PanelTitle title="تازه‌ترین سرنخ‌ها" subtitle="آخرین نتایج ذخیره‌شده" icon={Database} action={<button className="text-button" onClick={() => onNavigate('leads')}>مشاهده همه <ArrowUpLeft size={16} /></button>} />
      <LeadsTable leads={data.recentLeads} compact />
    </section>
    <div className="dashboard-grid lower">
      <section className="panel"><PanelTitle title="اجرای اخیر" subtitle="وضعیت خزنده‌ها" icon={Activity} action={<button className="text-button" onClick={() => onNavigate('runs')}>جزئیات</button>} />
        <div className="run-list">{data.recentRuns.length ? data.recentRuns.map((run) => <RunRow key={run.id} run={run} />) : <EmptyMini text="هنوز اجرایی ثبت نشده است." />}</div>
      </section>
      <section className="panel safety-card"><div className="safety-mark"><ShieldCheck size={30} /></div><h3>خزش مسئولانه، داده تمیز</h3><p>صفحات ممنوع، ورود و کپچا کنار گذاشته می‌شوند. شماره‌ها استاندارد و تکراری‌ها پیش از ذخیره حذف می‌شوند.</p><div className="safety-tags"><span><Check size={14} /> robots.txt</span><span><Check size={14} /> Rate limit</span><span><Check size={14} /> Deduplication</span></div></section>
    </div>
  </>;
}

function TopicLauncher({ sources, onLaunch }: { sources: SourceCatalogItem[]; onLaunch: (topic: string) => Promise<void> }) {
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (topic.trim().length < 2) { setError('موضوع را کمی دقیق‌تر بنویس.'); return; }
    setBusy(true); setError('');
    try { await onLaunch(topic.trim()); setTopic(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'ساخت پویش ممکن نشد.'); }
    finally { setBusy(false); }
  };
  return <section className="topic-radar">
    <div className="radar-orbit"><Radar size={34} /><i /><i /></div>
    <div className="topic-copy"><span><Sparkles size={14} /> جست‌وجوی چندمنبعی خودکار</span><h2>دنبال چه مشتری‌ای هستی؟</h2><p>مثلاً «کابینت»، «دستگاه بسته‌بندی» یا «طراحی سایت»</p></div>
    <form className="topic-form" onSubmit={submit}>
      <div className="topic-entry"><Search size={21} /><input autoComplete="off" value={topic} onChange={(event) => { setTopic(event.target.value); setError(''); }} placeholder="موضوع کسب‌وکار را بنویس…" maxLength={80} autoFocus /><button type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={20} /> : <Zap size={20} />} روشن‌کردن رادار</button></div>
      {error && <span className="topic-error"><AlertTriangle size={14} /> {error}</span>}
    <div className="market-sources"><small>منابع:</small>{sources.map((source) => <span className={`market-source source-${source.id}`} key={source.id}><i />{source.label} {source.access === 'manual-only' ? '· دستی' : '· خودکار'}</span>)}<em><ShieldCheck size={13} /> فقط داده عمومی</em></div>
    </form>
  </section>;
}

function StatCard({ label, value, suffix, detail, icon: Icon, tone }: { label: string; value: number; suffix?: string; detail: string; icon: typeof Users; tone: string }) {
  return <div className={`stat-card ${tone}`}><div className="stat-top"><span>{label}</span><div><Icon size={21} /></div></div><strong>{faNumber(value)} <small>{suffix}</small></strong><p><BadgeCheck size={15} /> {detail}</p></div>;
}

function PanelTitle({ title, subtitle, icon: Icon, action }: { title: string; subtitle: string; icon: typeof Activity; action?: React.ReactNode }) {
  return <div className="panel-title"><div className="panel-title-icon"><Icon size={19} /></div><div><h3>{title}</h3><p>{subtitle}</p></div>{action && <div className="panel-action">{action}</div>}</div>;
}

function CampaignsView({ campaigns, projects, onNew, onAdvanced, onRetry, onResults }: { campaigns: Campaign[]; projects: Project[]; onNew: () => void; onAdvanced: () => void; onRetry: (campaign: Campaign) => void; onResults: (campaign: Campaign) => void }) {
  return <>
    <PageHead eyebrow="خروجی یکپارچه" title="پویش‌های انبوه" description="هر موضوع یک پویش واحد است؛ منابع در پشت‌صحنه بررسی و نتایج یکجا تحویل می‌شوند." actions={<><button className="ghost-button" onClick={onAdvanced}><Globe2 size={17} /> لینک اختصاصی</button><button className="primary-button" onClick={onNew}><Radar size={18} /> پویش انبوه جدید</button></>} />
    {campaigns.length ? <div className="campaign-grid">{campaigns.map((campaign) => {
      const active = campaign.status === 'running' || campaign.status === 'queued';
      const sourceProjects = projects.filter((project) => project.campaignId === campaign.id);
      return <article className="campaign-card" key={campaign.id}>
        <div className="campaign-card-head"><div className="campaign-topic-icon">{active ? <LoaderCircle className="spin" size={24} /> : <Radar size={24} />}</div><div><span>پویش #{faNumber(campaign.id)}</span><h3>{campaign.topic}</h3></div><em className={`campaign-status ${campaign.status}`}>{statusLabel[campaign.status]}</em></div>
        <div className="campaign-sources">{campaign.sources.map((source) => <span className={`source-${source}`} key={source}><i />{sourceLabel[source]}</span>)}</div>
        <div className="live-source-links"><b><Globe2 size={15} /> مشاهده سایت واقعی:</b>{sourceProjects.map((project) => <a href={project.targetUrl} target="_blank" rel="noreferrer" key={project.id}><span>{sourceLabel[project.source]}</span><small>{project.source === 'divar' || project.source === 'sheypoor' ? 'بررسی دستی در سایت اصلی' : 'داده عمومی · خزش مجاز'}</small><ExternalLink size={14} /></a>)}</div>
        <div className="campaign-metrics"><div><small>نتیجه تجمیعی</small><b>{faNumber(campaign.leadsFound)} <em>سرنخ</em></b></div><div><small>منابع ثبت‌شده</small><b>{faNumber(campaign.projectCount)} <em>سایت</em></b></div><div><small>محدوده</small><b>{campaign.city || 'کل ایران'}</b></div><div><small>زمان ساخت</small><b>{faDate(campaign.createdAt)}</b></div></div>
        <div className="campaign-progress"><div><span>{active ? 'در حال جمع‌آوری از همه منابع…' : 'پردازش منابع پایان یافت'}</span><b>{faNumber(campaign.progress)}٪</b></div><i><span style={{ width: `${campaign.progress}%` }} /></i></div>
        <div className="campaign-actions-row">{!active && <button className="ghost-button" onClick={() => onRetry(campaign)}><RefreshCw size={17} /> اجرای دوباره همه منابع</button>}<button className="ghost-button" onClick={() => onResults(campaign)}><Eye size={17} /> مشاهده همه نتایج</button><a className="primary-button" href={`/api/campaigns/${campaign.id}/export.csv`}><Download size={17} /> خروجی یکجای CSV</a></div>
      </article>;
    })}</div> : <EmptyState icon={Target} title="هنوز پویش انبوهی نداری" text="فقط موضوع را بده؛ منابع مناسب خودکار انتخاب می‌شوند و یک خروجی تجمیعی تحویل می‌گیری." action="ساخت اولین پویش" onAction={onNew} />}
  </>;
}

function LeadsView({ leads, campaigns, selectedCampaignId, onCampaignChange, onUpdate }: { leads: Lead[]; projects: Project[]; campaigns: Campaign[]; selectedCampaignId: number | null; onCampaignChange: (id: number | null) => void; onUpdate: (lead: Lead, status: Lead['status']) => void }) {
  const [status, setStatus] = useState('all');
  const visible = leads.filter((lead) => status === 'all' || lead.status === status);
  const exportHref = selectedCampaignId ? `/api/campaigns/${selectedCampaignId}/export.csv` : '/api/export.csv';
  return <>
    <PageHead eyebrow="خروجی تجمیعی" title="بانک سرنخ‌ها" description={`${faNumber(visible.length)} مخاطب عمومی پس از پاک‌سازی و حذف موارد تکراری`} actions={<a className="primary-button anchor-button" href={exportHref}><Download size={18} /> خروجی یکجا</a>} />
    <div className="filterbar"><div><Filter size={17} /><span>فیلترها</span></div><select value={selectedCampaignId ?? 'all'} onChange={(event) => onCampaignChange(event.target.value === 'all' ? null : Number(event.target.value))}><option value="all">همه پویش‌ها</option>{campaigns.map((campaign) => <option value={campaign.id} key={campaign.id}>{campaign.topic}</option>)}</select><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">همه وضعیت‌ها</option><option value="new">جدید</option><option value="qualified">باارزش</option><option value="contacted">پیگیری‌شده</option><option value="excluded">کنارگذاشته</option></select><button className="future-filter" disabled><MapPin size={14} /> منطقه — نسخه بعد</button><span className="filter-count">{faNumber(visible.length)} نتیجه</span></div>
    <section className="panel table-panel"><LeadsTable leads={visible} onUpdate={onUpdate} /></section>
  </>;
}

function LeadsTable({ leads, compact = false, onUpdate }: { leads: Lead[]; compact?: boolean; onUpdate?: (lead: Lead, status: Lead['status']) => void }) {
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const copyPhone = async (lead: Lead) => { await navigator.clipboard.writeText(lead.phone); setRevealed((current) => new Set(current).add(lead.id)); };
  if (!leads.length) return <EmptyMini text="هنوز سرنخی برای نمایش وجود ندارد." />;
  return <div className="table-scroll"><table><thead><tr><th>عنوان سرنخ</th><th>شماره تماس</th><th>موقعیت</th><th>منبع</th><th>کیفیت</th>{!compact && <th>وضعیت</th>}<th>صفحه واقعی</th></tr></thead><tbody>{leads.map((lead) => <tr key={lead.id}>
    <td><div className="lead-title"><div>{lead.title.slice(0, 1)}</div><span><b>{lead.title}</b><small>{lead.category || (lead.isBusiness ? 'کسب‌وکار' : 'آگهی عمومی')}</small></span></div></td>
    <td><div className="phone-cell"><span dir="ltr">{revealed.has(lead.id) ? lead.phone : lead.phoneMasked}</span><button onClick={() => setRevealed((current) => { const next = new Set(current); next.has(lead.id) ? next.delete(lead.id) : next.add(lead.id); return next; })} title="نمایش شماره"><Eye size={15} /></button><button onClick={() => void copyPhone(lead)} title="کپی"><Copy size={15} /></button></div></td>
    <td>{lead.city || '—'}</td><td><span className="source-badge">{sourceLabel[lead.source] ?? lead.source}</span></td>
    <td><div className="score"><span style={{ '--score': `${lead.score}%` } as React.CSSProperties}><i /></span><b>{faNumber(lead.score)}</b></div></td>
    {!compact && <td><select className={`status-select ${lead.status}`} value={lead.status} onChange={(event) => onUpdate?.(lead, event.target.value as Lead['status'])}><option value="new">جدید</option><option value="qualified">باارزش</option><option value="contacted">پیگیری‌شده</option><option value="excluded">کنارگذاشته</option></select></td>}
    <td><a className="source-view-link" href={lead.url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> مشاهده آگهی</a></td>
  </tr>)}</tbody></table></div>;
}

function RunsView({ runs, onRefresh }: { runs: Run[]; onRefresh: () => void }) {
  const [selectedId, setSelectedId] = useState('');
  const selected = runs.find(run => String(run.id) === selectedId);
  return <>
    <PageHead eyebrow="مانیتورینگ" title="تاریخچه اجرا" description="پیشرفت زنده، تعداد صفحات و نتیجه هر اجرای خزنده." actions={<button className="ghost-button" onClick={onRefresh}><RefreshCw size={17} /> به‌روزرسانی</button>} />
    <section className="panel history-panel"><label>انتخاب اجرا برای حذف<select aria-label="انتخاب اجرا برای حذف" value={selectedId} onChange={event => setSelectedId(event.target.value)}><option value="">یک اجرا را انتخاب کن</option>{runs.map(run => <option value={run.id} key={run.id}>{run.projectName} · #{faNumber(run.id)} · {statusLabel[run.status]}</option>)}</select></label><HistoryControls path="/api/runs" selectedId={selected?.id} selectedStatus={selected?.status} refreshKey={runs.map(run => `${run.id}:${run.status}`).join(',')} onChanged={() => { setSelectedId(''); onRefresh(); }} /></section>
    <section className="panel run-history">{runs.length ? runs.map((run) => <div className="run-history-row" key={run.id}>
      <div className={`run-state ${run.status}`}>{run.status === 'running' ? <LoaderCircle className="spin" /> : run.status === 'completed' ? <Check /> : run.status === 'failed' ? <AlertTriangle /> : <TimerReset />}</div>
      <div className="run-main"><div><b>{run.projectName}</b><span>اجرای #{faNumber(run.id)} • {faDate(run.startedAt)}</span></div><p>{run.message}</p><div className="progress"><i style={{ width: `${run.progress}%` }} /></div></div>
      <div className="run-numbers"><span><b>{faNumber(run.pagesScanned)}</b> صفحه</span><span><b>{faNumber(run.leadsFound)}</b> سرنخ</span><span><b>{faNumber(run.duplicatesSkipped)}</b> تکراری</span></div>
      <span className={`status-pill ${run.status}`}>{statusLabel[run.status]}</span>
    </div>) : <EmptyState icon={Activity} title="تاریخچه خالی است" text="بعد از اجرای یک پروژه، گزارش لحظه‌ای آن اینجا نمایش داده می‌شود." />}</section>
  </>;
}

function RunRow({ run }: { run: Run }) {
  return <div className="run-row"><div className={`run-icon ${run.status}`}>{run.status === 'running' ? <LoaderCircle className="spin" size={18} /> : run.status === 'completed' ? <Check size={18} /> : <Pause size={18} />}</div><div><b>{run.projectName}</b><span>{run.message}</span></div><div className="mini-progress"><i style={{ width: `${run.progress}%` }} /></div><strong>{faNumber(run.progress)}٪</strong></div>;
}

function ExportsView({ leads, projects }: { leads: Lead[]; projects: Project[] }) {
  return <>
    <PageHead eyebrow="تحویل داده" title="خروجی و گزارش" description="فایل تمیز و سازگار با Excel، CRM و ابزارهای تحلیل دریافت کنید." />
    <div className="export-grid"><section className="panel export-card"><div className="export-icon csv"><FileSpreadsheet size={28} /></div><h3>خروجی کامل CSV</h3><p>شامل عنوان، شماره کامل، شهر، منبع، امتیاز، وضعیت و لینک مرجع.</p><div className="export-facts"><span>{faNumber(leads.length)} ردیف</span><span>UTF-8 فارسی</span><span>حذف فرمول مخرب</span></div><a href="/api/export.csv" className="primary-button anchor-button"><Download size={18} /> دریافت فایل</a></section>
      <section className="panel export-summary"><PanelTitle title="آماده خروجی" subtitle="خلاصه بانک اطلاعاتی" icon={Database} /><div className="summary-list"><div><span>تعداد کل</span><b>{faNumber(leads.length)}</b></div><div><span>شماره‌های یکتا</span><b>{faNumber(new Set(leads.map((lead) => lead.phone)).size)}</b></div><div><span>سرنخ باارزش</span><b>{faNumber(leads.filter((lead) => lead.score >= 70).length)}</b></div><div><span>پروژه‌ها</span><b>{faNumber(projects.length)}</b></div></div></section></div>
  </>;
}

function SettingsView() {
  return <>
    <PageHead eyebrow="کنترل سیستم" title="تنظیمات و سیاست‌ها" description="مرزهای فنی نسخه محلی و اصول استفاده مسئولانه." />
    <div className="settings-grid"><section className="panel settings-section"><PanelTitle title="سیاست خزش" subtitle="به‌صورت پیش‌فرض فعال" icon={ShieldCheck} /><div className="setting-row"><div><b>رعایت robots.txt</b><span>اگر قوانین منبع در دسترس نباشد، خزش متوقف می‌شود.</span></div><button className="toggle on" aria-label="فعال"><i /></button></div><div className="setting-row"><div><b>محدودیت سرعت</b><span>فاصله درخواست‌ها دست‌کم ۲۰ ثانیه به‌علاوه وقفه تصادفی است؛ محدودیت دسترسی باعث توقف می‌شود.</span></div><button className="toggle on" aria-label="فعال"><i /></button></div><div className="setting-row"><div><b>حفاظت شبکه داخلی</b><span>آدرس‌های خصوصی و سرویس‌های محلی قابل دسترس نیستند.</span></div><button className="toggle on" aria-label="فعال"><i /></button></div></section>
      <section className="panel settings-section"><PanelTitle title="محدوده داده" subtitle="اطلاعات تماس عمومی" icon={Phone} /><div className="notice"><AlertTriangle size={20} /><p><b>شماره محافظت‌شده استخراج نمی‌شود.</b><br />دیوار و شیپور فقط برای بازکردن دستی سایت اصلی نمایش داده می‌شوند. کد تأیید فقط باید در سایت اصلی وارد شود؛ این برنامه آن را دریافت یا ذخیره نمی‌کند. ورود، کپچا و API خصوصی دور زده نمی‌شوند.</p></div><div className="info-line"><span>نسخه موتور</span><b>۰.۲.۰</b></div><div className="info-line"><span>پایگاه داده</span><b>SQLite / Blob خصوصی</b></div><div className="info-line"><span>حالت اجرا</span><b>تک‌کاربره</b></div></section></div>
  </>;
}

function TopicCampaignModal({ sources, onClose, onAdvanced, onLaunch }: { sources: SourceCatalogItem[]; onClose: () => void; onAdvanced: () => void; onLaunch: (topic: string) => Promise<void> }) {
  const [topic, setTopic] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    if (topic.trim().length < 2) { setError('موضوع را کمی دقیق‌تر بنویس.'); return; }
    setSaving(true);
    try { await onLaunch(topic.trim()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'ساخت پویش ممکن نشد.'); }
    finally { setSaving(false); }
  };
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="modal topic-modal" onSubmit={submit}>
    <div className="modal-head"><div><span><Radar size={22} /></span><div><h2>پویش انبوه بازار ایران</h2><p>فقط موضوع را بده؛ انتخاب سایت و جمع‌کردن خروجی با رادار.</p></div></div><button type="button" onClick={onClose}><X size={21} /></button></div>
    <div className="form-body">
      {error && <div className="form-error"><AlertTriangle size={17} />{error}</div>}
      <label className="topic-modal-input"><span>موضوع مشتری‌یابی <em>*</em></span><div><Search size={21} /><input required autoFocus minLength={2} maxLength={80} value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="مثلاً دستگاه بسته‌بندی" /></div><small>همین یک فیلد کافی است؛ بقیه گزینه‌ها آماده‌اند.</small></label>
      <div className="auto-discovery-card"><div><Globe2 size={22} /><span><b>منابع بازار ایران</b><small>شماره‌های عمومی خودکار بررسی می‌شوند؛ دیوار و شیپور لینک بررسی دستی دارند.</small></span></div><div className="auto-source-row">{sources.map((source) => <span className={`source-${source.id}`} key={source.id}><i />{source.label} · {source.access === 'manual-only' ? 'دستی' : 'خودکار'}</span>)}</div></div>
      <div className="future-filter-note"><MapPin size={18} /><div><b>فیلتر شهر و منطقه</b><span>زیرساخت آن آماده شد و در نسخه بعد به همین پویش انبوه اضافه می‌شود.</span></div><em>به‌زودی</em></div>
      <div className="campaign-policy"><ShieldCheck size={18} /><p>با شروع پویش، استفاده مسئولانه را می‌پذیری: فقط اطلاعات تماسِ عمومی ذخیره می‌شود و ورود، کپچا یا شماره محافظت‌شده دور زده نمی‌شود.</p></div>
    </div>
    <div className="modal-actions campaign-actions"><button type="button" className="text-button" onClick={onAdvanced}>لینک اختصاصی دارم</button><button type="submit" className="primary-button" disabled={saving}>{saving ? <><LoaderCircle className="spin" size={18} /> در حال ساخت…</> : <><Radar size={18} /> شروع استخراج انبوه</>}</button></div>
  </form></div>;
}

function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ name: '', targetUrl: '', source: 'auto' as SourceId, city: '', keywords: '', maxPages: 7, delayMs: 20_000, complianceAccepted: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const update = (key: keyof typeof form, value: string | number | boolean) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError('');
    try { await api('/api/projects', { method: 'POST', body: JSON.stringify(form) }); await onCreated(); }
    catch (err) { setError(err instanceof Error ? err.message : 'ساخت پروژه ممکن نشد.'); }
    finally { setSaving(false); }
  };
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="modal" onSubmit={submit}>
    <div className="modal-head"><div><span><Radar size={21} /></span><div><h2>پروژه اسکن جدید</h2><p>لینک هدف و محدوده جستجو را مشخص کن.</p></div></div><button type="button" onClick={onClose}><X size={21} /></button></div>
    <div className="form-body">
      {error && <div className="form-error"><AlertTriangle size={17} />{error}</div>}
      <label><span>نام پروژه <em>*</em></span><input required minLength={3} maxLength={100} value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="مثلاً: خدمات صنعتی تهران" /></label>
      <label><span>لینک هدف <em>*</em></span><div className="input-icon"><Globe2 size={17} /><input required dir="ltr" type="url" value={form.targetUrl} onChange={(e) => update('targetUrl', e.target.value)} placeholder="https://example.com/category/..." /></div><small>صفحه دسته‌بندی، جستجو یا آگهی عمومی را وارد کن.</small></label>
      <div className="form-row"><label><span>منبع</span><div className="select-wrap"><select value={form.source} onChange={(e) => update('source', e.target.value)}><option value="auto">تشخیص خودکار</option><option value="divar">دیوار</option><option value="sheypoor">شیپور</option><option value="iran-tejarat">ایران تجارت</option><option value="niyazban">نیازبان</option><option value="generic">سایت عمومی</option></select><ChevronDown size={16} /></div></label><label><span>شهر هدف</span><input value={form.city} onChange={(e) => update('city', e.target.value)} placeholder="مثلاً تهران" /></label></div>
      <label><span>کلیدواژه‌ها</span><input value={form.keywords} onChange={(e) => update('keywords', e.target.value)} placeholder="کابینت، بازسازی، تولید" /><small>با ویرگول جدا کن؛ برای امتیازدهی کیفیت استفاده می‌شود.</small></label>
      <div className="form-row"><label><span>حداکثر صفحات (آنلاین: ۷)</span><input type="number" min="1" max="7" value={form.maxPages} onChange={(e) => update('maxPages', Number(e.target.value))} /></label><label><span>حداقل فاصله درخواست (ms)</span><input type="number" min="20000" max="30000" step="1000" value={form.delayMs} onChange={(e) => update('delayMs', Number(e.target.value))} /><small>۱۰ ثانیه وقفه تصادفی برای کاهش فشار به منبع افزوده می‌شود.</small></label></div>
      <label className="check-label"><input type="checkbox" checked={form.complianceAccepted} onChange={(e) => update('complianceAccepted', e.target.checked)} /><span><Check size={14} /></span><p>تأیید می‌کنم فقط اطلاعات تماس عمومی و مجاز را برای ارتباط مسئولانه جمع‌آوری می‌کنم و قوانین منبع را رعایت خواهم کرد.</p></label>
    </div>
    <div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>انصراف</button><button type="submit" className="primary-button" disabled={saving}>{saving ? <><LoaderCircle className="spin" size={18} /> در حال ساخت…</> : <><Sparkles size={18} /> ساخت پروژه</>}</button></div>
  </form></div>;
}

function EmptyState({ icon: Icon, title, text, action, onAction }: { icon: typeof Target; title: string; text: string; action?: string; onAction?: () => void }) {
  return <div className="empty-state"><div><Icon size={30} /></div><h3>{title}</h3><p>{text}</p>{action && <button className="primary-button" onClick={onAction}><Plus size={17} />{action}</button>}</div>;
}
function EmptyMini({ text }: { text: string }) { return <div className="empty-mini"><Database size={22} /><span>{text}</span></div>; }
function LoadingState() { return <div className="loading-state"><div className="radar-loader"><i /><i /><Radar /></div><b>در حال آماده‌سازی رادار…</b></div>; }
