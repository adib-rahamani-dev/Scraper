import { useEffect, useRef, useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';

export default function HistoryControls({ path, selectedId, selectedStatus, refreshKey, onChanged }: {
  path: '/api/runs' | '/api/capture-runs' | '/api/companion/capture-runs'; selectedId?: string | number;
  selectedStatus?: string; refreshKey: string; onChanged: () => void | Promise<void>;
}) {
  const [counts, setCounts] = useState({ archived: 0, removable: 0 });
  const [batch, setBatch] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (bulkOpen) dialog.current?.showModal(); else dialog.current?.close(); }, [bulkOpen]);
  useEffect(() => {
    let current = true;
    fetch(`${path}/history`).then(async response => {
      if (!response.ok) throw new Error('دریافت وضعیت تاریخچه ممکن نشد.');
      const data = await response.json(); if (current) { setCounts(data); setError(''); }
    }).catch(reason => { if (current) setError(reason.message); });
    return () => { current = false; };
  }, [path, refreshKey]);

  const change = async (restore: boolean, all: boolean) => {
    if (!restore && !all && !window.confirm('این اجرا از تاریخچه حذف شود؟ آگهی‌ها و شماره‌ها باقی می‌مانند؛ تاریخچه قابل بازیابی است.')) return;
    if (!restore && all && confirmText !== 'من تایید میکنم') return;
    if (restore && all && !window.confirm('تمام تاریخچهٔ حذف‌شده دوباره نمایش داده شود؟')) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`${path}/history/${restore ? 'restore' : 'delete'}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: true, ...(all ? { all: true, ...(!restore ? { confirmText } : {}) } : restore ? { batch } : { ids: [selectedId] }) }),
      });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'تغییر تاریخچه ممکن نشد.');
      setCounts(data); setBatch(restore ? '' : data.changed ? data.batch : '');
      setBulkOpen(false); setConfirmText('');
      setMessage(`${Number(data.changed).toLocaleString('fa-IR')} اجرا ${restore ? 'بازیابی شد.' : 'از تاریخچه حذف شد؛ بانک اطلاعاتی حفظ شد.'}`);
      await onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'خطا در ذخیرهٔ تاریخچه'); }
    finally { setBusy(false); }
  };
  const active = !selectedStatus || ['running', 'queued', 'paused'].includes(selectedStatus);
  return <div className="history-controls">
    <div className="history-actions">
      <button className="ghost-button danger-button" disabled={busy || !selectedId || active} onClick={() => void change(false, false)}><Trash2 size={16} /> حذف این اجرا</button>
      <button className="ghost-button danger-button" disabled={busy || !counts.removable} onClick={() => { setConfirmText(''); setBulkOpen(true); }}><Trash2 size={16} /> پاک‌سازی کلی تاریخچه</button>
      {counts.archived > 0 && <button className="ghost-button" disabled={busy} onClick={() => void change(true, true)}><RotateCcw size={16} /> بازیابی تاریخچه ({counts.archived.toLocaleString('fa-IR')})</button>}
    </div>
    <small>فقط تاریخچه خلوت می‌شود؛ آگهی‌ها، شماره‌ها و خروجی‌های قبلی محفوظ می‌مانند. اجراهای فعال کنار گذاشته نمی‌شوند.</small>
    {message && <div className="history-feedback" role="status">{message}{batch && <button className="text-button" disabled={busy} onClick={() => void change(true, false)}><RotateCcw size={14} /> واگرد</button>}</div>}
    {error && <p className="login-error" role="alert">{error}</p>}
    <dialog className="history-confirm-dialog" ref={dialog} onCancel={() => setBulkOpen(false)} aria-labelledby="history-confirm-title">
      <form onSubmit={event => { event.preventDefault(); void change(false, true); }}>
        <h2 id="history-confirm-title">پاک‌سازی کلی تاریخچه</h2>
        <p>{counts.removable.toLocaleString('fa-IR')} اجرای غیرفعال از تاریخچه کنار گذاشته می‌شود. آگهی‌ها و شماره‌ها باقی می‌مانند و تاریخچه قابل بازیابی است.</p>
        <label>برای تأیید بنویس: <strong>من تایید میکنم</strong><input autoFocus autoComplete="off" aria-label="عبارت تأیید پاک‌سازی کلی" value={confirmText} onChange={event => setConfirmText(event.target.value)} placeholder="من تایید میکنم" /></label>
        {error && <p className="login-error" role="alert">{error}</p>}
        <div className="history-actions"><button type="button" className="ghost-button" disabled={busy} onClick={() => setBulkOpen(false)}>انصراف</button><button type="submit" className="ghost-button danger-button" disabled={busy || confirmText !== 'من تایید میکنم'}>تأیید پاک‌سازی کلی</button></div>
      </form>
    </dialog>
  </div>;
}
