'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { Empty, ErrorBox, PageHead, Skeleton, useToast } from '@/components/crm/ui';
import { Editor } from '@/components/crm/website/Editor';
import { AiDraftForm, ContentTab, DeveloperTab, GapsCard, List, MediaTab, NewForm, Progress, PublishTab, SetupTab } from '@/components/crm/website/Tabs';
import { errText, type Data, type Doc, type Kind } from '@/components/crm/website/shared';

type Tab = 'content' | 'review' | 'publish' | 'media' | 'site' | 'developer' | 'setup';

export default function WebsitePage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('content');
  const [kind, setKind] = useState<Kind | 'all'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ type: Kind; data?: Doc; ai?: boolean } | null>(null);
  const [aiForm, setAiForm] = useState(false);
  const [toast, say] = useToast();

  const load = useCallback(async () => {
    try { setData(await crm.get<Data>('/api/v1/website')); setError(null); } catch (e) { setError(errText(e)); }
  }, []);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id');
    const t = setTimeout(() => { if (id) setOpen(id); }, 0);
    return () => clearTimeout(t);
  }, []);
  // While a publish is running, keep its progress fresh.
  const running = data?.publishes.some((p) => p.running) ?? false;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
  }, [running, load]);

  if (error && !data) return <main className="crm-page"><PageHead title="Website" /><ErrorBox message={error} onRetry={() => void load()} /></main>;
  if (!data) return <main className="crm-page"><PageHead title="Website" /><Skeleton h={480} /></main>;

  const { me, setup } = data;
  const active = data.items.filter((i) => !i.archived);
  const waiting = active.filter((i) => i.status === 'review');
  const ready = active.filter((i) => i.status === 'approved');
  const site = data.items.find((i) => i.type === 'site');

  if (open) {
    return (
      <main className="crm-page">
        <Editor key={open} id={open} data={data} onBack={() => { setOpen(null); void load(); }} say={say} onChanged={() => void load()} />
        {toast}
      </main>
    );
  }

  const tabBtn = (t: Tab, label: React.ReactNode) => <button type="button" role="tab" className="crm-tab" aria-selected={tab === t} onClick={() => setTab(t)}>{label}</button>;

  return (
    <main className="crm-page">
      <PageHead title="Website" sub={<>Write and publish what is on {setup.siteUrl ? <a href={setup.siteUrl} target="_blank" rel="noreferrer">{setup.siteUrl.replace('https://', '')}</a> : 'the website'}: articles, questions, doctors, health camps, notices, patient stories, service pages and the hospital&apos;s details. A change goes live only after the website&apos;s own checks pass. Nothing is ever deleted.</>}>
        {me.write && data.aiOn && <button type="button" className="crm-btn is-secondary" onClick={() => setAiForm(true)}><Sparkles size={16} aria-hidden /> Draft with AI</button>}
        {me.write && <button type="button" className="crm-btn is-secondary" onClick={() => setDraft({ type: 'faq' })}><Plus size={16} aria-hidden /> New question</button>}
        {me.write && <button type="button" className="crm-btn" onClick={() => setDraft({ type: 'article' })}><Plus size={16} aria-hidden /> New article</button>}
      </PageHead>

      {!setup.connected && <div className="ws-banner">The website isn&apos;t connected yet, so nothing can be published. You can still write drafts. {me.develop ? <button type="button" className="ws-link" onClick={() => setTab('setup')}>Connect it in Setup</button> : 'A developer connects it once in Setup.'}</div>}
      {setup.connected && !setup.imported && <div className="ws-banner">Connected, but what is on the website now hasn&apos;t been brought in yet. {me.develop ? <button type="button" className="ws-link" onClick={() => setTab('setup')}>Do that in Setup</button> : 'A developer does that in Setup.'}</div>}
      {data.publishes.filter((p) => p.running).map((p) => <Progress key={p.id} job={p} />)}

      <div className="crm-tabs" role="tablist" aria-label="Website views">
        {tabBtn('content', 'Content')}
        {tabBtn('review', <>Waiting for review{waiting.length ? <span className="an-count">{waiting.length}</span> : null}</>)}
        {tabBtn('publish', <>Publish{ready.length ? <span className="an-count">{ready.length}</span> : null}</>)}
        {tabBtn('media', 'Media')}
        {tabBtn('site', 'Hospital details')}
        {me.develop && tabBtn('developer', 'Developer')}
        {me.develop && tabBtn('setup', 'Setup')}
      </div>

      {tab === 'content' && <ContentTab data={data} kind={kind} setKind={setKind} onOpen={setOpen} onNew={(k) => setDraft({ type: k })} onChanged={() => void load()} say={say} />}
      {tab === 'review' && (waiting.length === 0
        ? <Empty title="Nothing is waiting for review">When a writer sends something for review (articles, service pages, patient stories), it shows here for the reviewer to read and approve.</Empty>
        : <List rows={waiting} onOpen={setOpen} extra={(r) => <span className="crm-sub">Sent by {r.submittedByName}</span>} />)}
      {tab === 'publish' && <PublishTab data={data} onOpen={setOpen} onChanged={() => void load()} say={say} />}
      {tab === 'media' && <MediaTab data={data} onChanged={() => void load()} say={say} />}
      {tab === 'site' && <>
        {site
          ? <Editor key={site.id} id={site.id} data={data} embedded onBack={() => void load()} say={say} onChanged={() => void load()} />
          : <Empty title="The hospital's details aren't here yet">They come in when the website is connected and its content is brought in (Setup).</Empty>}
        <GapsCard onOpen={setOpen} />
      </>}
      {tab === 'developer' && me.develop && <DeveloperTab data={data} onChanged={() => void load()} say={say} />}
      {tab === 'setup' && me.develop && <SetupTab setup={setup} onChanged={() => void load()} say={say} />}

      {draft && <NewForm type={draft.type} start={draft.data} ai={draft.ai} data={data} onClose={() => setDraft(null)} onMade={(id) => { setDraft(null); setOpen(id); }} />}
      {aiForm && <AiDraftForm data={data} onClose={() => setAiForm(false)} onDraft={(d) => { setAiForm(false); setDraft({ type: 'article', data: d, ai: true }); }} />}
      {toast}
    </main>
  );
}
