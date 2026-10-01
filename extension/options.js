const field = document.getElementById('token');
const message = document.getElementById('message');
const endpoint = document.getElementById('endpoint');
const panel = document.getElementById('panel');
chrome.storage.local.get(['leadRadarToken', 'leadRadarEndpoint']).then(({ leadRadarToken, leadRadarEndpoint }) => {
  if (leadRadarEndpoint === 'http://127.0.0.1:4300') endpoint.value = leadRadarEndpoint;
  if (leadRadarToken) field.value = leadRadarToken;
  panel.href = endpoint.value === 'http://127.0.0.1:4300' ? 'http://127.0.0.1:5173/' : endpoint.value;
});
endpoint.addEventListener('change', () => { field.value = ''; message.textContent = 'برای این پنل، کلید اتصال جداگانه بساز.'; panel.href = endpoint.value === 'http://127.0.0.1:4300' ? 'http://127.0.0.1:5173/' : endpoint.value; });
document.getElementById('save').addEventListener('click', async () => {
  const token = field.value.trim();
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) { message.textContent = 'فرمت کلید معتبر نیست.'; return; }
  message.textContent = 'در حال بررسی…';
  try {
    const response = await fetch(endpoint.value + '/api/extension/ping', { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error('کلید پذیرفته نشد یا منقضی شده است.');
    await chrome.storage.local.set({ leadRadarToken: token, leadRadarEndpoint: endpoint.value });
    message.textContent = 'اتصال برقرار و کلید در همین مرورگر ذخیره شد.';
  } catch (error) { message.textContent = error.message || 'اتصال برقرار نشد.'; }
});
document.getElementById('remove').addEventListener('click', async () => {
  await chrome.storage.local.remove('leadRadarToken'); field.value = ''; message.textContent = 'کلید محلی حذف شد. برای لغو کامل، آن را از پنل آنلاین هم باطل کن.';
});
