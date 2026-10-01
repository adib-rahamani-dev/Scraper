(() => {
  if (window !== window.top || window.__leadRadarOverlayLoaded) return;
  window.__leadRadarOverlayLoaded = true;
  const supported = () => /^(?:www\.)?(?:divar\.ir|sheypoor\.com)$/.test(location.hostname);
  function mount() {
    if (!supported() || !document.body || document.getElementById('lead-radar-floating-panel')) return;
    const host = document.createElement('div');
    host.id = 'lead-radar-floating-panel';
    host.style.cssText = 'position:fixed!important;left:18px!important;bottom:18px!important;z-index:2147483647!important;direction:rtl!important;';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `<style>
      *{box-sizing:border-box} .panel{width:255px;background:#101d2a;color:#f0f7fa;border:1px solid #3b6172;border-radius:16px;box-shadow:0 12px 40px #0007;padding:13px;font:13px Tahoma,Arial,sans-serif;direction:rtl}
      .head{display:flex;justify-content:space-between;align-items:center;font-weight:bold;color:#83e1c2;margin-bottom:9px}.mode{font-size:11px;color:#abc0cc;line-height:1.7;margin-bottom:10px}
      button{width:100%;border:0;border-radius:9px;background:#4bd2aa;color:#08211e;padding:9px;font:bold 12px Tahoma,Arial,sans-serif;cursor:pointer;margin-bottom:6px}button:hover{filter:brightness(1.1)}button.secondary{background:#29435a;color:#eef7f9}button:disabled{opacity:.55;cursor:wait}
      .contact{border-top:1px solid #385264;padding-top:9px;margin-top:5px}.contact p{font-size:11px;color:#acc6d0;line-height:1.7;margin:0 0 8px}.contact select{width:100%;padding:7px;background:#1c3446;color:white;border:1px solid #4a6374;border-radius:7px;margin-bottom:7px}.confirm{display:flex;align-items:start;gap:6px;font-size:10px;line-height:1.6;margin-bottom:8px}.confirm input{margin:2px 0}
      .status{font-size:11px;color:#c3d4dc;line-height:1.6;min-height:17px}.status.error{color:#ff9eaa}.min{border:0;background:none;color:#a2c6ce;padding:0;margin:0;width:auto;font-size:18px}
    </style><div class="panel"><div class="head"><span>◉ رادار لید</span><button class="min" title="جمع‌کردن">−</button></div><div class="content"><div class="mode"></div><button class="capture"></button><div class="contact" hidden><p>با تأیید و کلیک خودت، تماس همین آگهی باز می‌شود؛ کپچا یا ورود را در سایت انجام بده.</p><select class="basis"><option value="">مبنای مجاز ارتباط</option><option value="direct-consent">رضایت مستقیم</option><option value="public-business">شمارهٔ عمومی کسب‌وکار</option></select><label class="confirm"><input type="checkbox">مجاز بودن ثبت و ارتباط را تأیید می‌کنم.</label><button class="secondary capture-contact">نمایش و ثبت تماس همین آگهی</button></div><button class="secondary dashboard">بازکردن پنل رادار</button><div class="status">ورود با شماره و کد را در خود سایت انجام بده.</div></div></div>`;
    document.body.append(host);
    const mode = shadow.querySelector('.mode');
    const capture = shadow.querySelector('.capture');
    const contact = shadow.querySelector('.contact');
    const status = shadow.querySelector('.status');
    const content = shadow.querySelector('.content');
    shadow.querySelector('.min').addEventListener('click', event => {
      content.hidden = !content.hidden;
      event.currentTarget.textContent = content.hidden ? '+' : '−';
    });
    shadow.querySelector('.dashboard').addEventListener('click', () => window.open('http://127.0.0.1:4311/', '_blank', 'noopener'));
    function updateMode() {
      const path = location.pathname;
      const isDetail = path.startsWith('/v/');
      const isSearch = path.startsWith('/s/');
      capture.hidden = !isDetail && !isSearch;
      contact.hidden = !isDetail;
      capture.dataset.command = isDetail ? 'detail' : 'search';
      capture.textContent = isDetail ? 'ثبت جزئیات همین آگهی' : 'برداشت آگهی‌های همین صفحه';
      mode.textContent = isDetail ? 'صفحهٔ یک آگهی باز است.' : isSearch ? 'فقط کارت‌های بارگذاری‌شدهٔ این صفحه ثبت می‌شوند؛ صفحهٔ بعدی خودکار باز نمی‌شود.' : 'برای ثبت، به جست‌وجو یا یک آگهی برو.';
    }
    capture.addEventListener('click', async () => {
      const command = capture.dataset.command;
      if (command === 'search' && !confirm('آگهی‌های قابل‌مشاهدهٔ همین صفحه، بدون شماره تماس، در رادار ذخیره شوند؟')) return;
      capture.disabled = true; status.classList.remove('error'); status.textContent = 'در حال خواندن همین صفحه…';
      try {
        const result = await window.__leadRadarBridge(command);
        status.textContent = command === 'detail'
          ? result.duplicate ? 'این آگهی قبلاً ثبت شده؛ جزئیات تازه تکمیل شد.' : 'آگهی با جزئیات نمایان ذخیره شد.'
          : `${result.saved} آگهی تازه؛ ${result.duplicate} مورد تکراری.`;
      } catch (error) { status.classList.add('error'); status.textContent = error.message || 'ثبت ناموفق بود.'; }
      finally { capture.disabled = false; }
    });
    shadow.querySelector('.capture-contact').addEventListener('click', async event => {
      if(!event.isTrusted)return;
      const button = event.currentTarget;
      const basis = shadow.querySelector('.basis').value;
      const confirmed = shadow.querySelector('.confirm input').checked;
      if (!basis || !confirmed) { status.classList.add('error'); status.textContent = 'مبنای مجاز و تأیید ثبت را انتخاب کن.'; return; }
      button.disabled = true; status.classList.remove('error'); status.textContent = 'در حال بررسی بخش تماسِ نمایان…';
      try {
        const result = await window.__leadRadarBridge({ kind: 'reveal-contact', basis, confirmed: true });
        status.textContent = `شمارهٔ نمایان ${result.phone} برای همین آگهی ثبت شد.`;
      } catch (error) { status.classList.add('error'); status.textContent = error.message || 'شماره ثبت نشد.'; }
      finally { button.disabled = false; }
    });
    updateMode();
    let lastUrl = location.href;
    setInterval(() => {
      if (!host.isConnected) { window.__leadRadarOverlayLoaded = false; mount(); return; }
      if (location.href !== lastUrl) { lastUrl = location.href; updateMode(); }
    }, 1200);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
