import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Chip, MenuItem, TextField } from '@mui/material';
import { ArrowDownLeft, ArrowLeftRight, ArrowRight, ArrowUpRight, Building2, CircleDollarSign, FileCheck2, Globe2, IdCard, Landmark, LayoutDashboard, List, LogOut, RefreshCw, Send, SlidersHorizontal, UserRound, UsersRound, Wallet } from 'lucide-react';
import { toPaise } from './amount';
import { configuredEndpoint, liveApi, parseEndpoint, readStorage, saveStorage } from './live-api';
import Extras from './Extras';
import { applicationFields, pages as addonPages, saveRecord } from './addons';
import CustomerServices from './CustomerServices';
import { servicesEnabled, startServices } from './services-api';
import './live.css';

const money = minor => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(minor / 100);
const time = value => value ? new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata',
}).format(new Date(value)) : '—';

const statusNames = {
  PENDING: 'Pending', PROCESSING: 'Processing', COMPLETED: 'Completed', REJECTED: 'Rejected', MANUAL_REVIEW: 'Manual review',
};
const rejectionNames = {
  INSUFFICIENT_FUNDS: 'Insufficient available balance',
  LIMIT_EXCEEDED: 'Transfer limit exceeded',
  DESTINATION_ACCOUNT_UNAVAILABLE: 'The destination is unavailable',
};
const byId = (directory, id) => directory.find(bank => bank.bankId === id)?.bankName || id;

function TransferForm({ bank, accounts, directory, send }) {
  const [type, setType] = useState('interbank');
  const [from, setFrom] = useState('');
  const [destination, setDestination] = useState('');
  const [number, setNumber] = useState('');
  const [amount, setAmount] = useState('200');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const sources = accounts.filter(account => account.status === 'ACTIVE');
  const fromId = sources.some(item => item.accountId === from) ? from : (sources[0]?.accountId || '');
  const routes = directory.filter(item => item.bankId !== bank.id && item.status === 'ACTIVE');
  const route = destination ? (routes.find(item => item.ifsc === destination)?.ifsc || '') : (routes[0]?.ifsc || '');
  const target = type === 'internal' ? bank.ifsc : route;

  async function submit(event) {
    event.preventDefault();
    setError('');
    const amountMinor = toPaise(amount);
    if (!fromId || !target || !number.trim() || amountMinor === null) {
      setError('Choose a source, destination and positive amount with at most two decimal places.');
      return;
    }
    setBusy(true);
    try {
      await send({ fromAccountId: fromId, destinationIfsc: target,
        destinationAccountNumber: number.trim(), amountMinor, currency: 'INR' });
      setNumber('');
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  return <section className="panel live-transfer"><header className="panel-head"><div>
    <h2>Send money</h2><p>Transfer within Zentro or to a bank on the test network.</p>
  </div><Send size={19} /></header>
    <form className="transfer-form" onSubmit={submit}>
      <div className="type-switch">
        {[['interbank', 'Interbank'], ['internal', 'Same bank']].map(([value, label]) => <Button key={value}
          type="button" aria-pressed={type === value} variant={type === value ? 'contained' : 'outlined'}
          disabled={busy} onClick={() => setType(value)}>{label}</Button>)}
      </div>
      <TextField select label="From account" required value={fromId} onChange={e => setFrom(e.target.value)} disabled={busy || !sources.length}>
        {sources.map(account => <MenuItem key={account.accountId} value={account.accountId}>
          {account.accountNumber} · {money(account.availableMinor)} available
        </MenuItem>)}
      </TextField>
      {type === 'interbank' && <TextField select label="Destination bank" required value={route}
        onChange={e => setDestination(e.target.value)} disabled={busy || !routes.length}>
        {routes.map(item => <MenuItem key={item.ifsc} value={item.ifsc}>{item.bankName} · {item.ifsc}</MenuItem>)}
      </TextField>}
      <TextField label="Destination account number" required value={number} onChange={e => setNumber(e.target.value)} disabled={busy} />
      <TextField label="Amount in INR" required value={amount} onChange={e => setAmount(e.target.value)} disabled={busy}
        slotProps={{ htmlInput: { inputMode: 'decimal' } }} />
      {error && <Alert severity="error">{error}</Alert>}
      <div><Button type="submit" variant="contained" disabled={busy || !fromId || !target} startIcon={<Send size={16} />}>
        {busy ? 'Submitting…' : 'Submit transfer'}
      </Button></div>
    </form>
  </section>;
}

function Activity({ rows, directory, limit = 50 }) {
  return <section className="panel"><header className="panel-head"><div><h2>Transfer activity</h2><p>Up to {limit} recent transfers</p></div><List size={19} /></header>
    {rows.length ? <div className="table-scroll"><table>
      <thead><tr><th>Transfer</th><th>Route</th><th>Amount</th><th>Status</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.transferId}>
        <td><div className="transaction"><span className="transaction-icon">
          {row.direction === 'CREDIT' ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
        </span><div><strong>{row.transferId}</strong><small>{time(row.createdAt)}</small></div></div></td>
        <td><strong>{byId(directory, row.sourceBankId)} → {byId(directory, row.destinationBankId)}</strong><small>
          {row.type === 'INTERNAL' ? 'Same bank' : row.direction === 'CREDIT' ? 'Incoming' : 'Outgoing'}
        </small></td>
        <td className={row.direction === 'CREDIT' ? 'incoming amount' : 'amount'}>{money(row.amountMinor)}</td>
        <td><Chip size="small" label={statusNames[row.status] || row.status}
          className={row.status === 'COMPLETED' ? 'completed' : 'live-' + row.status?.toLowerCase()} />
          {row.code && <small>{rejectionNames[row.code] || row.code.toLowerCase().replaceAll('_', ' ')}</small>}</td>
      </tr>)}</tbody>
    </table></div> : <div className="empty"><ArrowLeftRight size={23} /><strong>No transfers yet</strong><p>Your submitted and incoming transfers will appear here.</p></div>}
  </section>;
}

function Directory({ banks }) {
  const [search, setSearch] = useState('');
  const term = search.trim().toLowerCase();
  const results = banks.filter(bank => [bank.bankName, bank.ifsc, bank.address]
    .some(value => typeof value === 'string' && value.toLowerCase().includes(term)));

  return <section className="panel">
    <header className="panel-head"><div><h2>SharedBank directory</h2><p>Find a bank by name, IFSC, or address.</p></div><Building2 size={19} /></header>
    <div className="directory-filter"><TextField size="small" fullWidth label="Search banks" value={search}
      onChange={event => setSearch(event.target.value)} /></div>
    {results.length ? <div className="table-scroll"><table><thead><tr>
      <th scope="col">Bank</th><th scope="col">IFSC</th><th scope="col">Address</th><th scope="col">Status</th>
    </tr></thead><tbody>{results.map(bank => <tr key={bank.bankId}>
      <td><strong>{bank.bankName}</strong></td><td className="mono">{bank.ifsc}</td>
      <td>{typeof bank.address === 'string' && bank.address ? bank.address : '—'}</td><td>{bank.status}</td>
    </tr>)}</tbody></table></div> : <div className="empty"><p>{banks.length ? 'No matching banks.' : 'No bank records available.'}</p></div>}
  </section>;
}

export default function LiveBank({ bank, switchUrl, openDemo }) {
  const urlKey = 'x42-cloudflare-worker-url';
  const [base, setBase] = useState(() => configuredEndpoint || readStorage(localStorage, urlKey, ''));
  const [services, setServices] = useState(null);
  const [servicesError, setServicesError] = useState('');
  const [registrationDraft, setRegistrationDraft] = useState(null);
  const [mode, setMode] = useState('bank');
  const [session, setSession] = useState(null);
  const prefix = '/banks/' + bank.id;
  const [url, setUrl] = useState(base);
  const [editUrl, setEditUrl] = useState(!base);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [data, setData] = useState({ accounts: [], transfers: [] });
  const [directory, setDirectory] = useState([]);
  const [page, setPage] = useState('overview');
  const [loaded, setLoaded] = useState(false);
  const activeToken = useRef(null);
  activeToken.current = session?.token;
  const pending = useRef(new Map());
  const refresh = useCallback(async signal => {
    if (!session?.token) return;
    try {
      const value = await liveApi(base, prefix + '/dashboard', { token: session.token, signal });
      if (signal?.aborted || activeToken.current !== session.token) return;
      setData(value);
      setLoaded(true);
      setError('');
    } catch (failure) {
      if (signal?.aborted || activeToken.current !== session.token) return;
      if (failure.status === 401) {
        activeToken.current = null;
        setServices(null);
        setSession(null);
        setData({ accounts: [], transfers: [] });
        setLoaded(false);
      }
      setError(failure.message);
    }
  }, [base, prefix, session]);

  useEffect(() => {
    if (!session?.token) return undefined;
    const controller = new AbortController();
    const update = () => { if (document.visibilityState === 'visible') refresh(controller.signal); };
    refresh(controller.signal);
    const timer = setInterval(update, 12_000);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearInterval(timer);
      controller.abort();
      document.removeEventListener('visibilitychange', update);
    };
  }, [session, refresh]);

  useEffect(() => {
    if (!session?.token) return undefined;
    const controller = new AbortController();
    liveApi(base, '/directory/banks', { signal: controller.signal })
      .then(value => setDirectory(value.banks || []))
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [base, session]);

  function logout() {
    activeToken.current = null;
    setSession(null);
    setServices(null);
    setServicesError('');
    setLoaded(false);
    setData({ accounts: [], transfers: [] });
    setNote('');
    setError('');
    setMode('bank');
    setRegistrationDraft(null);
  }

  async function signIn(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const loginEmail = email.trim();
      if (mode !== 'bank') {
        const registering = mode === 'register';
        const draft = registering ? Object.fromEntries(new FormData(event.currentTarget)) : null;
        const application = draft ? applicationFields(draft) : null;
        const api = await startServices(loginEmail, password, undefined, registering);
        if (mode === 'admin') {
          try { await api.addon('config/admins/' + encodeURIComponent(api.uid)); }
          catch (failure) {
            if (failure.status === 404) throw new Error('This Firebase UID has no Zentro administrator document.');
            throw failure;
          }
        }
        setServices(() => api);
        setPage('applications');
        if (application) {
          try {
            await saveRecord(api, 'applications', crypto.randomUUID(), { ...application, uid: api.uid, status: 'PENDING' });
            setNote('Registration complete. Your account application is pending review.');
          } catch (failure) {
            setRegistrationDraft(draft);
            setError('Your login was created, but the application did not save. Submit it below. ' + failure.message);
          }
        }
        setSession({ uid: api.uid, email: loginEmail, admin: mode === 'admin' });
        return;
      }
      const value = await liveApi(base, prefix + '/sign-in', { data: { email: email.trim(), password } });
      activeToken.current = value.token;
      setPage('overview');
      if (servicesEnabled && base === configuredEndpoint) {
        setServices(null);
        setServicesError('');
        startServices(email.trim(), password, value.uid).then(api => {
          if (activeToken.current === value.token) setServices(() => api);
        }).catch(failure => {
          if (activeToken.current === value.token) setServicesError(failure.message);
        });
      }
      setSession(value);
    } catch (failure) { setError(failure.message); }
    finally { setPassword(''); setBusy(false); }
  }

  function connect(event) {
    event.preventDefault();
    setError('');
    try {
      const endpoint = parseEndpoint(url);
      if (endpoint !== base) { logout(); setDirectory([]); }
      saveStorage(localStorage, urlKey, endpoint);
      setBase(endpoint);
      setEditUrl(false);
    } catch (failure) { setError(failure.message); }
  }

  async function send(transfer) {
    const raw = JSON.stringify([bank.id, base, session.uid, transfer]);
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)));
    const hash = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    const keyName = 'x42-pending-' + hash;
    const key = pending.current.get(keyName) || readStorage(sessionStorage, keyName, null) || crypto.randomUUID();
    pending.current.set(keyName, key);
    saveStorage(sessionStorage, keyName, key);
    const row = await liveApi(base, prefix + '/transfers', { token: session.token, data: transfer, key });
    pending.current.delete(keyName);
    saveStorage(sessionStorage, keyName, null);
    const verb = row.status === 'COMPLETED' ? 'Completed' : row.status === 'REJECTED' ? 'Rejected' :
      row.status === 'MANUAL_REVIEW' ? 'Manual review' : 'Accepted';
    setNote(verb + ' · ' + row.transferId);
    await refresh();
  }

  const addonEnabled = servicesEnabled && base === configuredEndpoint;
  const addonIcons = {
    applications: FileCheck2, kyc: IdCard, loans: CircleDollarSign, products: Wallet,
    profiles: UserRound, beneficiaries: UsersRound, closure: FileCheck2, directoryNotes: Building2, limitNotes: SlidersHorizontal,
  };
  const addonItems = (session?.admin
    ? ['applications', 'kyc', 'closure', 'loans', 'products', 'profiles', 'directoryNotes', 'limitNotes']
    : ['applications', 'kyc', 'beneficiaries', 'loans', 'profiles', 'closure', 'directoryNotes'])
    .map(key => [key, addonPages[key].title, addonIcons[key]]);
  const pages = [
    ...(session?.token ? [
      ['overview', 'Overview', LayoutDashboard],
      ['transfers', 'Move money', ArrowLeftRight],
      ['activity', 'Activity', List],
      ['directory', 'Bank directory', Building2],
      ...(addonEnabled ? [['portfolio', 'Portfolio', Wallet]] : []),
    ] : []),
    ...(addonEnabled ? addonItems : []),
  ];
  const coreCount = pages.length - (addonEnabled ? addonItems.length : 0);
  const title = pages.find(([id]) => id === page)?.[1];
  const balance = data.accounts.reduce((sum, account) => sum + account.availableMinor, 0);

  return <div className={session ? 'layout live-bank-layout' : 'guest-layout live-bank-layout'}>
    <aside className="sidebar">
      <div className="brand"><span className="brand-icon"><Landmark size={21} /></span>
        <span><strong>{bank.name}</strong><small>Digital banking</small></span>
      </div>
      <nav aria-label="Bank actions">
        {session && pages.map(([id, label, Icon], index) => <div className="nav-item" key={id}>
          {index === 0 && coreCount > 0 && <div className="nav-heading">Banking</div>}
          {index === coreCount && <div className="nav-heading">{session.admin ? 'Administration' : 'Account services'}</div>}
          <button type="button" className={id === page ? 'active' : ''}
            aria-current={id === page ? 'page' : undefined} onClick={() => setPage(id)}>
            <Icon size={18} /> {label}
          </button>
        </div>)}
        {!configuredEndpoint && <button onClick={() => { setUrl(base); setEditUrl(!editUrl); }}><Globe2 size={18} /> Worker connection</button>}
        {openDemo && <button onClick={openDemo}><ArrowLeftRight size={18} /> Browser demo</button>}
      </nav>
      {!session && <div className="guest-identity" aria-label="Zentro network details">
        <span>SharedBank test network</span>
        <dl><div><dt>Bank ID</dt><dd>{bank.id}</dd></div><div><dt>IFSC</dt><dd>{bank.ifsc}</dd></div></dl>
      </div>}
      <div className="sidebar-bottom">
        <a className="switch-link" href={switchUrl}><Globe2 size={17} /> SharedBank switch <ArrowUpRight size={14} /></a>
        {session && <button className="sign-out" onClick={logout}><LogOut size={17} /> Sign out</button>}
      </div>
    </aside>
    <div className="main">
      <header className="topbar">
        <Chip label={session?.admin ? "Admin workspace" : "Test network"} size="small" className="demo" />
        {session && <div className="signed-in"><span>{session.email}</span>{session.token && <Button onClick={() => refresh()}
          aria-label="Refresh balances" title="Refresh balances" className="refresh"><RefreshCw size={17} /></Button>}</div>}
      </header>
      <main className="content live-bank-content">
        {session && <div className="page-head"><h1>{title}</h1></div>}
        {error && <Alert severity="error">{error}</Alert>}
        {note && <Alert severity="info" onClose={() => setNote('')}>{note}</Alert>}
        {editUrl && <section className="panel"><header className="panel-head"><div><h2>Worker connection</h2>
          <p>Use the same Cloudflare Worker URL across the bank pages.</p></div></header>
          <form className="transfer-form" onSubmit={connect}><TextField label="Cloudflare Worker URL" fullWidth required value={url} onChange={e => setUrl(e.target.value)} />
            <div><Button type="submit" variant="contained">Save connection</Button></div></form>
        </section>}
        {!session && base && !editUrl && <section className={mode === 'register' ? 'panel live-sign-in registration' : 'panel live-sign-in'}><header className="panel-head"><div>
          <h1>{{ bank: 'Welcome back', admin: 'Admin sign-in', services: 'Application sign-in', register: 'Customer registration' }[mode]}</h1>
          <p>{mode === 'register' ? 'Create a test login and submit your account application in one step.' : 'Sign in with your Zentro test account.'}</p></div></header>
          <form className="transfer-form" onSubmit={signIn}>
            {mode !== 'bank' && !addonEnabled && <Alert severity="warning">
              Add your Zentro Firebase web settings to .env.local and restart Vite to continue.
            </Alert>}
            {mode === 'register' && <div className="registration-fields">
              <TextField label="Full name" name="name" autoComplete="name" required slotProps={{ htmlInput: { maxLength: 100 } }} />
              <TextField label="Phone" name="phone" type="tel" required slotProps={{ htmlInput: { maxLength: 25 } }} />
              <TextField className="full-field" label="Sample address" name="address" required slotProps={{ htmlInput: { maxLength: 240 } }} />
              <TextField label="Requested deposit (INR)" name="opening" type="number" required defaultValue="1000"
                slotProps={{ htmlInput: { min: 1000, max: 1000000, step: '0.01' } }} />
              <TextField label="Sample KYC reference" name="reference" placeholder="DEMO-ID-001" required
                slotProps={{ htmlInput: { maxLength: 80 } }} />
            </div>}
            <TextField label="Email" type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} />
            <TextField label="Password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              required value={password} onChange={event => setPassword(event.target.value)}
              slotProps={{ htmlInput: { minLength: mode === 'register' ? 6 : undefined } }} />
            <div><Button type="submit" variant="contained" disabled={busy || (mode !== 'bank' && !addonEnabled)}
              fullWidth endIcon={<ArrowRight size={17} />}>
              {busy ? 'Please wait…' : mode === 'register' ? 'Register and submit' : 'Sign in'}
            </Button></div>
            {mode === 'bank' ? <>
              <Button type="button" variant="outlined" disabled={busy}
                onClick={() => { setMode('register'); setError(''); setPassword(''); }}>Register as a customer</Button>
              {addonEnabled && <div className="type-switch">{[['services', 'Application sign-in'], ['admin', 'Admin portal']].map(([next, label]) =>
                <Button type="button" key={next} disabled={busy}
                  onClick={() => { setMode(next); setError(''); setPassword(''); }}>{label}</Button>)}</div>}
            </> : <Button type="button" disabled={busy}
              onClick={() => { setMode('bank'); setError(''); setPassword(''); }}>Back to bank sign-in</Button>}
          </form></section>}
        {session && <>
          {session.token && loaded && !data.accounts.length && <Alert severity="info">This Firebase user has no synthetic account in this bank. Attach an account to this Firebase UID.</Alert>}
          {session.token && !loaded && <Alert severity="info">Loading your accounts and activity…</Alert>}
          {loaded && page === 'overview' && <>
            {data.accounts.length > 0 && <section className="balance-summary">
              <div className="summary-copy"><span><Wallet size={17} /> Total available balance</span>
                <strong>{money(balance)}</strong>
                <Button variant="contained" onClick={() => setPage('transfers')} endIcon={<ArrowUpRight size={17} />}>Move money</Button>
              </div>
            </section>}
            {data.accounts.length > 0 && <h2>Your accounts</h2>}
            <div className="accounts">{data.accounts.map((account, i) =>
            <section key={account.accountId} className={'account-card ' + (i === 0 ? 'primary-account' : 'light-account')}>
              <div className="account-head"><span>{account.accountNumber}</span><Landmark size={19} /></div>
              <div className="account-value">{money(account.availableMinor)}</div>
              <div className="account-foot"><span>Held {money(account.heldMinor)}</span><span>{account.status}</span></div>
            </section>)}</div>
            <Activity rows={data.transfers.slice(0, 5)} directory={directory} limit={5} />
          </>}
          {loaded && data.accounts.length > 0 && <div hidden={page !== 'transfers'}>
            <TransferForm key={session.uid} bank={bank} accounts={data.accounts} directory={directory} send={send} />
          </div>}
          {loaded && page === 'activity' && <Activity rows={data.transfers} directory={directory} />}
          {page === 'directory' && <Directory banks={directory} />}
          {page === 'portfolio' && <CustomerServices key={page} page={page} accounts={data.accounts}
            api={services} connectionError={servicesError} />}
          {Object.hasOwn(addonPages, page) && <Extras key={page + session.uid} api={services} page={page}
            admin={session.admin} connectionError={servicesError} initialApplication={registrationDraft} />}
        </>}
      </main>
    </div>
  </div>;
}
