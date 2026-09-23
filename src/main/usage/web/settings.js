/* Credentials stay in password fields until submitted to the loopback service. */
const $ = id => document.getElementById(id);
const fragment = new URLSearchParams(location.hash.slice(1));
let language = fragment.get('lang') || 'zh-CN', csrf = '', defaults = [], connections = [], selected, flow, polling = false, locked = false;
const code = fragment.get('code');
const returnedFlow = fragment.get('oauth');
let testBusy = false, metricChoices = [], testVersion = 0, modelSaving = false;
history.replaceState(null, '', location.pathname);
const english = { periodHelp: 'Add Today, This week and This month together. Each can have its own Credit budget; leave it empty to track usage only.', periodProtocol: 'Multiple reporting periods apply to Gateway Usage v1. Other protocols use the quota periods provided by their APIs.', addPeriod: 'Add reporting period', featured: 'Quota or model shown on Pet', featuredHelp: 'Query usage first, then choose a model. For saved accounts the choice takes effect immediately, without changing account status. Expand a card to see all dimensions.', minimumHint: 'Pet shows the lowest remaining percentage by default. Incomparable units are not ranked; expand to see all dimensions.', add: 'Add account', addSame: 'Add another account', multiAccount: 'Each login identity has separate credentials and usage. A different identity adds an account; signing in to the same identity updates it. To switch accounts, use the official account chooser or open the sign-in link in a private browser window.', catalog: 'Separate model catalog Base URL (optional)', catalogKey: 'Separate catalog API key (optional)', accounts: 'AI accounts', local: 'Stored on this device · Refreshes after this page closes', settings: 'ACCOUNT SETTINGS', device: 'Local connection', connection: 'Connection', provider: 'Platform', gateway: 'Personal gateway', name: 'Display name', templateHint: 'Default: Volcengine API Gateway + VeFaaS + VMP. Deploy a compatible usage service first. An inference endpoint alone cannot report usage.', deployment: 'Deployment provider', volc: 'Volcengine (default)', other: 'Custom / Other', protocol: 'Usage protocol', url: 'Usage service Base URL', auth: 'Authentication', none: 'No authentication', key: 'API key (fill to replace)', period: 'Reporting period', month: 'This month', week: 'This week', today: 'Today', budget: 'Personal Credit budget (optional)', advancedGateway: 'Endpoints / Field mapping / Private services', migration: 'Same protocol: change URL and credentials. Different protocol: choose a template or mapping. Without a usage API, deploy a server adapter first. Paths append to the Base URL, including its /v1 prefix.', private: 'Allow this connection to access local / private services (including HTTP)', headerName: 'Authentication header name', paths: 'Endpoint paths (JSON)', mapping: 'Custom JSON request and mapping', mappingHelp: 'Use JSON Pointer, e.g. /data/balance. timeFormat: iso / unix-seconds / unix-ms. resetsAt means replenishment; expiresAt means expiry. Do not put secrets in request bodies.', oauthHint: 'Browser sign-in takes this tab to the official website and returns to a success screen when the account is saved. No client setup required.', clientSecret: 'Client secret (if required by registration)', accountId: 'Account / workspace ID (optional)', project: 'Google project ID (optional)', loginMode: 'Login method', builtinLogin: 'Built-in browser sign-in (recommended)', customLogin: 'Custom OAuth client', oauthAdvanced: 'Advanced login settings (usually unnecessary)', oauthConfig: 'Only change these fields for your own client registration. Switch back to built-in sign-in at any time.', callbackHost: 'Callback host', callbackPort: 'Callback port (0 = dynamic)', callbackPath: 'Callback path', authorize: 'Browser sign-in', continue: 'Browser did not open? Continue sign-in', cancelAuth: 'Cancel sign-in', confirmAuth: 'Confirm identity and save', displayRefresh: 'Display and refresh', interval: 'Refresh interval', order: 'Display order', manual: 'Manual only', enabled: 'Enable account', pin: 'Prioritize metric IDs (comma separated; copy from results below)', delete: 'Delete account', test: 'Test query', save: 'Save connection', preview: 'Usage and connection status', refresh: 'Refresh', noData: 'Connect an account to preview the quota shown on your Pet.' };
const chinese = new Map([...document.querySelectorAll('[data-i18n]')].map(e => [e.dataset.i18n, e.textContent]));
const tr = (zh, en) => language === 'en-US' ? en : zh;
function translate() { document.documentElement.lang = language; document.querySelectorAll('[data-i18n]').forEach(e => e.textContent = language === 'en-US' ? english[e.dataset.i18n] || chinese.get(e.dataset.i18n) : chinese.get(e.dataset.i18n)); $('language').textContent = tr('English', '中文'); $('heading').textContent = selected?.id ? selected.displayName : tr('添加 AI 账号', 'Add an AI account'); identityView(); nav(); if (selected) { periodRows(readPeriods()); models(metricChoices); } }
async function api(path, method = 'GET', data) { const response = await fetch('/api/usage/' + path, { method, headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: data === undefined ? undefined : JSON.stringify(data) }); const result = await response.json(); if (!response.ok || !result.ok)
    throw new Error(result.error?.message || tr('操作失败', 'Request failed')); return result.data; }
function message(text, error = false) { $('message').hidden = !text; $('message').textContent = text; $('message').classList.toggle('error', error); }
async function action(fn) { try {
    await fn();
}
catch (e) {
    message(e.message, true);
} }
function nav() { $('accounts').replaceChildren(); for (const c of connections) {
    const b = document.createElement('button');
    b.type = 'button';
    line(b, 'strong', c.displayName);
    line(b, 'small', accountLabel(c));
    if (c.account?.workspaceId) line(b, 'small', tr('工作区 · ', 'Workspace · ') + c.account.workspaceId);
    b.className = c.id === selected?.id ? 'selected' : '';
    b.disabled = locked;
    b.onclick = () => fill(c);
    $('accounts').append(b);
} }
function accountLabel(c) {
    const platform = c.providerId === 'codex' ? 'Codex' : c.providerId === 'antigravity' ? 'Antigravity' : tr('个人网关', 'Personal gateway');
    const identity = c.account?.email || c.account?.name || (c.account?.subject ? '…' + c.account.subject.slice(-8) : c.id ? tr('连接 · ', 'Connection · ') + c.id.slice(-8) : '');
    return [platform, identity].filter(Boolean).join(' · ');
}
function identityView() {
    $('account-identity').textContent = selected?.id ? accountLabel(selected) + (selected.account?.workspaceId ? tr(' · 工作区 ', ' · Workspace ') + selected.account.workspaceId : '') : '';
    $('authorize').textContent = selected?.hasCredential ? tr('重新登录此账号', 'Sign in again') : tr('浏览器登录', 'Browser sign-in');
    $('add-same').hidden = !selected?.id;
}
function periodRows(periods) {
    $('periods').replaceChildren();
    for (const p of periods) addPeriodRow(p);
    $('add-period').disabled = periods.length >= 3;
}
function addPeriodRow(p) {
    const row = document.createElement('div'); row.className = 'period-row';
    const periodLabel = line(row, 'label', tr('周期', 'Period')), select = document.createElement('select'); select.className = 'period-kind';
    for (const [value, zh, en] of [['today','今日','Today'],['week','本周','This week'],['month','本月','This month']]) { const option = line(select, 'option', tr(zh,en)); option.value = value; }
    select.value = p.period; periodLabel.append(select);
    const budgetLabel = line(row, 'label', tr('Credit 预算（可选）','Credit budget (optional)')), input = document.createElement('input');
    input.type = 'number'; input.min = '0.000001'; input.step = 'any'; input.className = 'period-budget'; input.value = p.budget ?? ''; budgetLabel.append(input);
    const remove = line(row, 'button', tr('移除','Remove')); remove.type = 'button'; remove.onclick = () => { row.remove(); $('add-period').disabled = false; };
    $('periods').append(row);
}
function readPeriods() { return [...$('periods').children].map(row => ({ period: row.querySelector('select').value, ...(row.querySelector('input').value ? { budget: Number(row.querySelector('input').value) } : {}) })); }
function models(metrics) {
    metricChoices = metrics || [];
    const value = $('featured-metric').value || selected?.featuredMetricId || '';
    $('featured-metric').replaceChildren(); const auto = line($('featured-metric'), 'option', tr('默认：首个模型额度', 'Default: first model quota')); auto.value = '';
    for (const m of metricChoices) { const option = line($('featured-metric'), 'option', m.label); option.value = m.id; }
    if (value && !metricChoices.some(m => m.id === value)) { const missing = line($('featured-metric'), 'option', tr('当前选择（暂未返回）：', 'Selected (unavailable): ') + value); missing.value = value; }
    $('featured-metric').value = value;
}
function loginResult(state, text) {
    $('settings-shell').hidden = true; $('login-result').hidden = false;
    $('login-symbol').textContent = state === 'success' ? '✓' : state === 'error' ? '!' : '…';
    $('login-title').textContent = state === 'success' ? tr('账号连接成功', 'Account connected') : state === 'error' ? tr('未能完成登录', 'Sign-in incomplete') : tr('正在完成登录', 'Completing sign-in');
    $('login-description').textContent = text || tr('正在接收授权并保存账号，请稍候。', 'Receiving authorization and saving your account.');
    $('login-back').textContent = state === 'success' ? tr('查看账号与用量', 'View account and usage') : tr('返回账号设置', 'Back to account settings');
}
function visible() { $('period-settings').hidden = $('protocol').value !== 'gateway-usage-v1'; $('model-settings').hidden = $('provider').value !== 'antigravity'; $('minimum-hint').hidden = $('provider').value === 'antigravity'; $('custom-oauth').hidden = $('oauth-mode').value !== 'custom'; const gateway = $('provider').value === 'personal-gateway'; $('gateway-fields').hidden = !gateway; $('oauth-fields').hidden = gateway; $('project-id').disabled = $('provider').value !== 'antigravity'; }
function fill(c) { $('model-feedback').textContent = ''; testVersion++; $('test-feedback').hidden = true; selected = structuredClone(c); $('provider').value = c.providerId; $('name').value = c.displayName; $('deployment').value = c.gateway.deploymentProvider; $('protocol').value = c.gateway.protocol; $('base-url').value = c.gateway.baseUrl; $('auth').value = c.gateway.auth; $('catalog-url').value = c.gateway.modelsBaseUrl || ''; $('catalog-key').value = ''; $('key').value = ''; periodRows(c.gateway.periods || [{ period: c.gateway.period, budget: c.gateway.budget }]); $('featured-metric').value = ''; models([]); $('private').checked = c.gateway.allowPrivate; $('header-name').value = c.gateway.headerName || ''; $('paths').value = JSON.stringify(c.gateway.paths, null, 2); $('mapping').value = JSON.stringify(c.gateway.custom, null, 2); $('oauth-mode').value = c.oauth.useBuiltin === false ? 'custom' : 'builtin'; $('client-id').value = c.oauth.clientId; $('client-secret').value = ''; $('account-id').value = c.accountId || ''; $('project-id').value = c.projectId || ''; $('callback-host').value = c.oauth.callbackHost; $('callback-port').value = c.oauth.callbackPort; $('callback-path').value = c.oauth.callbackPath; $('scopes').value = c.oauth.scopes; $('interval').value = c.intervalMinutes; $('order').value = c.order; $('enabled').checked = c.enabled; $('pinned').value = c.pinnedMetricIds.join(', '); $('delete').hidden = !c.id; $('oauth-status').textContent = c.hasCredential ? tr('已保存凭据，可查询或重新授权。', 'Credentials saved. Query usage or sign in again.') : ''; visible(); nav(); translate(); message(''); void loadSnapshots(); }
function read() { const c = structuredClone(selected); c.providerId = $('provider').value; c.featuredMetricId = $('featured-metric').value || undefined; c.displayName = $('name').value.trim(); c.enabled = $('enabled').checked; c.order = Number($('order').value); c.intervalMinutes = Number($('interval').value); c.pinnedMetricIds = $('pinned').value.split(',').map(x => x.trim()).filter(Boolean); c.accountId = $('account-id').value.trim() || undefined; c.projectId = $('project-id').value.trim() || undefined; c.oauth = { useBuiltin: $('oauth-mode').value === 'builtin', clientId: $('client-id').value.trim(), scopes: $('scopes').value.trim(), callbackHost: $('callback-host').value, callbackPort: Number($('callback-port').value), callbackPath: $('callback-path').value }; c.gateway = { ...c.gateway, deploymentProvider: $('deployment').value, protocol: $('protocol').value, baseUrl: $('base-url').value.trim(), modelsBaseUrl: $('catalog-url').value.trim() || undefined, auth: $('auth').value, headerName: $('header-name').value || undefined, period: c.gateway.period, budget: c.gateway.budget, periods: readPeriods(), allowPrivate: $('private').checked, paths: JSON.parse($('paths').value), custom: JSON.parse($('mapping').value) }; return c; }
function credential() { const result = {}; if ($('key').value && $('provider').value === 'personal-gateway')
    result.apiKey = $('key').value; if ($('catalog-key').value && $('provider').value === 'personal-gateway')
    result.modelsApiKey = $('catalog-key').value; return result; }
function line(parent, tag, text, className) { const e = document.createElement(tag); e.textContent = text; if (className)
    e.className = className; parent.append(e); return e; }
function renderResult(snapshot, root = $('results')) { root.replaceChildren(); if (!snapshot) {
    line(root, 'p', tr('连接账号后，在这里预览 Pet 将展示的额度。', 'Connect an account to preview usage.'), 'empty');
    return;
} if (snapshot.state)
    line(root, 'p', `${snapshot.state}${snapshot.refreshing ? tr(' · 刷新中', ' · Refreshing') : ''}${snapshot.mock ? ' · DEMO' : ''}`); if (snapshot.error || snapshot.partialError)
    line(root, 'p', snapshot.error || snapshot.partialError, 'error'); for (const m of snapshot.metrics || []) {
    const box = document.createElement('article');
    box.className = 'metric';
    line(box, 'strong', m.label);
    const value = m.unlimited ? tr('不限量', 'Unlimited') : m.remaining !== null ? tr('剩余 ', 'Remaining ') + m.remaining : m.used !== null ? tr('已用 ', 'Used ') + m.used : tr('未知', 'Unknown');
    line(box, 'p', `${value} ${m.currency || m.unit}${m.remainingPercent === null ? '' : ` · ${m.remainingPercent.toFixed(1)}% ${tr('剩余', 'remaining')}`}`);
    for (const [key, label] of [['resetsAt', tr('恢复', 'Resets')], ['expiresAt', tr('到期', 'Expires')]])
        if (m[key])
            line(box, 'small', `${label}: ${new Date(m[key]).toLocaleString(language)}`);
    line(box, 'small', `${m.id} · ${m.freshness} · ${m.authority} · ${m.completeness}`);
    if (m.note)
        line(box, 'small', m.note);
    root.append(box);
} if (snapshot.lastSuccessAt)
    line(root, 'small', tr('最近成功：', 'Last success: ') + new Date(snapshot.lastSuccessAt).toLocaleString(language)); if (snapshot.nextRefreshAt)
    line(root, 'small', tr('下次查询：', 'Next query: ') + new Date(snapshot.nextRefreshAt).toLocaleString(language)); }
async function loadSnapshots() { if (polling || flow)
    return; const id = selected?.id; polling = true; try {
    const data = await api('snapshots');
    if (selected?.id !== id) return;
    const snapshot = data.find(s => s.connectionId === id);
    if (snapshot?.account) {
        selected.account = snapshot.account;
        const saved = connections.find(c => c.id === selected.id);
        if (saved) saved.account = snapshot.account;
        identityView(); nav();
    }
    if (snapshot) models(snapshot.metrics); renderResult(snapshot);
    $('refresh').textContent = selected?.enabled === false ? tr('恢复并刷新', 'Resume and refresh') : tr('刷新', 'Refresh');
}
catch (e) {
    message(e.message, true);
}
finally {
    polling = false;
} }
async function reload(saved) { connections = await api('connections'); fill(connections.find(c => c.id === saved?.id) || defaults.find(c => c.providerId === 'personal-gateway')); }
function lock(value) { locked = value; document.querySelectorAll('#form input,#form select,#form textarea,#save,#test,#delete,#authorize,#add,#add-same').forEach(e => e.disabled = value); $('cancel-auth').hidden = !value; nav(); if (!value)
    visible(); }
function endFlow() { sessionStorage.removeItem('pet-usage-flow'); flow = undefined; lock(false); $('auth-link').hidden = true; $('complete-auth').hidden = true; }
async function pollAuth() { if (!flow)
    return; const id = flow.id; try {
    const next = await api('oauth/' + id);
    if (flow?.id !== id)
        return;
    flow = next;
    $('oauth-status').textContent = next.error || `${next.status}${next.identityLabel ? ' · ' + next.identityLabel : ''}${next.accountId ? ' · ' + next.accountId : ''}`;
    if (next.status === 'ready-to-save') {
        $('auth-link').hidden = true;
        await completeAuth();
        return;
    }
    if (next.status === 'authorizing' && next.authUrl) { $('login-continue').href = next.authUrl; $('login-continue').hidden = false; }
    if (next.status === 'failed') { loginResult('error', next.error);
        await api('oauth/' + id + '/cancel', 'POST', {});
        endFlow();
        return;
    }
    setTimeout(pollAuth, 1500);
}
catch (e) {
    message(e.message, true); loginResult('error', e.message);
    endFlow();
} }
$('form').onsubmit = e => { e.preventDefault(); if (modelSaving) return; void action(async () => { const saved = await api('connections', 'POST', { connection: read(), credential: credential() }); await reload(saved); message(tr('已保存。查询结果将在 Pet 面板更新。', 'Saved. Usage will update on your Pet.')); }); };
$('test').onclick = async () => {
    if (testBusy) return;
    const version = testVersion; testBusy = true; $('test').disabled = true;
    $('test-feedback').hidden = false; $('test-results').replaceChildren(); $('test-message').className = '';
    $('test-message').textContent = tr('正在查询…如有后台任务，将等待其完成。', 'Querying… waiting for background work if necessary.');
    try {
        const result = await api('test', 'POST', { connection: read(), credential: credential() });
        if (version !== testVersion) return;
        renderResult(result, $('test-results')); models(result.metrics);
        $('test-message').textContent = tr('查询完成；重复点击会复用 10 秒内的结果。尚未保存配置。', 'Query complete. Repeated clicks reuse results for 10 seconds. Configuration not saved.');
    } catch (e) { if (version === testVersion) { $('test-message').textContent = e.message; $('test-message').className = 'error'; } }
    finally { testBusy = false; $('test').disabled = false; }
};
$('add-period').onclick = () => {
    const current = readPeriods(); const next = ['today','week','month'].find(period => !current.some(p => p.period === period));
    if (next) periodRows([...current, { period: next }]);
};
$('featured-metric').onchange = () => action(async () => {
    const draft = selected, metricId = $('featured-metric').value;
    if (!draft.id) { draft.featuredMetricId = metricId || undefined; return; }
    modelSaving = true; $('featured-metric').disabled = true; $('save').disabled = true;
    try {
        const saved = await api('connections/' + draft.id + '/featured', 'POST', { metricId });
        connections = connections.map(c => c.id === saved.id ? saved : c);
        if (selected !== draft) return;
        selected.revision = saved.revision; selected.featuredMetricId = saved.featuredMetricId;
        $('model-feedback').textContent = tr('已更新 Pet 展示模型，账号启停和刷新计划保持不变。', 'Pet model updated. Account status and refresh schedule are unchanged.');
    } catch (e) {
        if (selected === draft) { $('featured-metric').value = draft.featuredMetricId || ''; $('model-feedback').textContent = e.message; }
    } finally { modelSaving = false; if (!locked) { $('featured-metric').disabled = false; $('save').disabled = false; } }
});
$('login-back').onclick = () => action(async () => {
    if (flow) await api('oauth/' + flow.id + '/cancel', 'POST', {});
    endFlow(); $('login-result').hidden = true; $('settings-shell').hidden = false;
});
$('delete').onclick = () => action(async () => { if (!selected.id || !confirm(tr('删除此账号及本机凭据？', 'Delete this account and its local credentials?')))
    return; await api('connections/' + selected.id, 'DELETE', {}); await reload(); });
$('refresh').onclick = () => action(async () => {
    const draft = selected; if (!draft?.id) return;
    $('refresh').disabled = true;
    try {
        if (!draft.enabled) {
            const saved = await api('connections/' + draft.id + '/enable', 'POST', {});
            connections = connections.map(c => c.id === saved.id ? saved : c);
            if (selected === draft) { selected.enabled = true; selected.revision = saved.revision; $('enabled').checked = true; }
        } else await api('refresh', 'POST', { id: draft.id });
        await loadSnapshots();
    } finally { $('refresh').disabled = false; }
});
function addAccount(provider) { fill(defaults.find(c => c.providerId === provider)); }
$('add').onclick = () => addAccount(selected?.providerId || 'personal-gateway');
$('add-same').onclick = () => addAccount(selected.providerId);
$('provider').onchange = () => {
    addAccount($('provider').value);
    message(tr('正在添加新账号；已有账号保留在左侧列表。', 'Adding a new account. Existing accounts remain in the list.'));
};
$('protocol').onchange = () => { const paths = structuredClone(defaults[0].gateway.paths); if ($('protocol').value === 'sub2api')
    paths.usage = '/v1/usage'; $('paths').value = JSON.stringify(paths, null, 2); visible(); };
$('language').onclick = () => { language = language === 'en-US' ? 'zh-CN' : 'en-US'; translate(); void loadSnapshots(); };
$('oauth-mode').onchange = () => {
    if ($('oauth-mode').value === 'builtin') {
        const profile = defaults.find(c => c.providerId === $('provider').value).oauth;
        $('client-id').value = profile.clientId; $('scopes').value = profile.scopes;
        $('callback-host').value = profile.callbackHost; $('callback-port').value = profile.callbackPort; $('callback-path').value = profile.callbackPath;
        $('client-secret').value = '';
    }
    visible();
};
$('authorize').onclick = () => action(async () => {
    const c = read(); lock(true);
    try {
        flow = await api('oauth/start', 'POST', { connection: c, navigation: 'same-tab', language, credential: c.oauth.useBuiltin ? {} : $('client-secret').value ? { clientSecret: $('client-secret').value } : {} });
        $('client-secret').value = ''; $('auth-link').href = flow.authUrl; $('auth-link').hidden = false;
        $('oauth-status').textContent = tr('正在前往官方登录页，完成后会自动返回。', 'Opening official sign-in. You will return here when it is complete.');
        sessionStorage.setItem('pet-usage-flow', flow.id); location.assign(flow.authUrl);
    } catch(e) { endFlow(); throw e; }
});
$('cancel-auth').onclick = () => action(async () => { if (flow)
    await api('oauth/' + flow.id + '/cancel', 'POST', {}); endFlow(); $('oauth-status').textContent = tr('已取消授权', 'Sign-in cancelled'); });
async function completeAuth() {
    if (!flow) return;
    const saved = await api('oauth/' + flow.id + '/complete', 'POST', {});
    endFlow(); await reload(saved); $('login-continue').hidden = true; loginResult('success', accountLabel(saved) + tr(' · 已安全保存，Pet 正在查询用量。', ' · Saved. Pet is fetching usage.')); message(tr('登录成功，账号已保存，正在查询额度。', 'Signed in. Account saved; fetching usage.'));
}
$('complete-auth').onclick = () => action(completeAuth);
void action(async () => { translate(); const session = code ? await api('session/exchange', 'POST', { code }) : await api('session'); csrf = session.csrf; defaults = await api('providers'); connections = await api('connections'); fill(connections[0] || defaults.find(c => c.providerId === 'personal-gateway')); const resume = returnedFlow || sessionStorage.getItem('pet-usage-flow'); if (resume) { flow = {id: resume}; lock(true); loginResult('pending'); void pollAuth(); } setInterval(() => { if (!document.hidden)
    void loadSnapshots(); }, 10000); });
