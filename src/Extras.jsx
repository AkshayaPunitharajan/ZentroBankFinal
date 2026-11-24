import { useEffect, useRef, useState } from 'react';
import { Alert, Button, MenuItem, TextField } from '@mui/material';
import { toPaise } from './amount';
import { listServiceRecords } from './services-api';
import { applicationFields, deleteBeneficiary, pages, records, removeRecord, reviewRecord, saveRecord } from './addons';

const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value);
const decisionLabels = { APPROVED: 'Approve', HOLD: 'Hold', REJECTED: 'Reject' };

function loanEstimate(principal, months, rateBps) {
  if (!(principal > 0 && months > 0 && Number.isInteger(months))) return null;
  const rate = rateBps / 120000;
  return rate ? principal * rate / -Math.expm1(-months * Math.log1p(rate)) : principal / months;
}

export default function Extras({ api, page, admin, connectionError, initialApplication }) {
  const { title, fields, request, editable, single } = pages[page];
  const [form, setForm] = useState(() => page === 'applications' ? { ...initialApplication } : {});
  const [rows, setRows] = useState([]);
  const [products, setProducts] = useState([]);
  const [previousLoans, setPreviousLoans] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [ready, setReady] = useState(false);
  const draftId = useRef(null);
  const adminManaged = ['products', 'directoryNotes', 'limitNotes'].includes(page);
  const edit = admin ? adminManaged : !adminManaged;
  const product = products.find(item => item.id === form.product);
  const estimate = product ? loanEstimate(Number(form.amount), Number(form.months), product.rateBps) : null;

  useEffect(() => {
    if (!api) return;
    let active = true;
    const customerLoans = page === 'loans' && !admin;
    Promise.all([
      records(api, page, admin), customerLoans ? records(api, 'products', false) : [],
      customerLoans ? listServiceRecords(api, 'loanApplications') : [],
    ]).then(([items, catalog, previous]) => {
        if (!active) return;
        setRows(items);
        setProducts(catalog);
        setPreviousLoans(previous);
        if (single && items[0] && !admin) setForm(items[0]);
        setReady(true);
      }).catch(failure => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [api, page, admin, single]);

  async function run(write, success) {
    setBusy(true); setError(''); setNotice('');
    try {
      await write();
      setNotice(success);
      setRows(await records(api, page, admin));
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  function values() {
    const data = Object.fromEntries(Object.keys(fields).map(field => [field, String(form[field] ?? '').trim()]));
    if (Object.values(data).some(value => !value)) throw new Error('Complete all fields.');
    if (page === 'kyc' && !/^DEMO-[A-Za-z0-9-]{1,75}$/.test(data.reference)) {
      throw new Error('Enter a fictional KYC reference such as DEMO-ID-001.');
    }
    if (page === 'beneficiaries') {
      data.ifsc = data.ifsc.toUpperCase();
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(data.ifsc) || !/^[A-Za-z0-9-]{4,40}$/.test(data.accountNumber)) {
        throw new Error('Enter a valid IFSC and account number.');
      }
    }
    if (page === 'profiles' && !/^[+0-9 ()-]{6,25}$/.test(data.phone)) throw new Error('Enter a valid phone number.');
    if (page === 'applications') return { ...applicationFields(data), uid: api.uid, status: 'PENDING' };
    if (page === 'directoryNotes') {
      const ifsc = data.ifsc.toUpperCase();
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw new Error('Enter a valid IFSC.');
      return { ...data, ifsc };
    }
    if (page === 'closure' || page === 'limitNotes') {
      if (!/^[A-Za-z0-9-]{4,40}$/.test(data.accountNumber)) throw new Error('Enter a valid account number.');
      if (page === 'limitNotes') {
        const perTransferMinor = toPaise(data.perTransfer);
        const dailyMinor = toPaise(data.daily);
        if (!perTransferMinor || !dailyMinor || dailyMinor < perTransferMinor) {
          throw new Error('Enter positive limits with the daily limit at least as high as the per-transfer limit.');
        }
        return { accountNumber: data.accountNumber, perTransferMinor, dailyMinor };
      }
    }
    if (page === 'products') {
      const bps = toPaise(data.rate) ?? (Number(data.rate) === 0 ? 0 : null);
      const maxMonths = Number(data.maxMonths);
      if (bps === null || bps > 10000 || !Number.isInteger(maxMonths) || maxMonths < 1 || maxMonths > 360) {
        throw new Error('Use a rate from 0% to 100% and a term from 1 to 360 months.');
      }
      return { name: data.name, rateBps: bps, maxMonths };
    }
    if (page === 'loans') {
      const amountMinor = toPaise(data.amount);
      const months = Number(data.months);
      if (!product || !amountMinor || amountMinor > 100000000 || !Number.isInteger(months) || months < 1 || months > product.maxMonths) {
        throw new Error('Select a product and enter a valid amount and term.');
      }
      return { uid: api.uid, status: 'PENDING', productId: product.id, productName: product.name,
        rateBps: product.rateBps, amountMinor, months };
    }
    return { ...data, uid: api.uid, ...(request && { status: 'PENDING' }) };
  }

  function submit(event) {
    event.preventDefault();
    run(async () => {
      const data = values();
      const signature = JSON.stringify(data);
      if (draftId.current?.signature !== signature) draftId.current = { signature, id: crypto.randomUUID() };
      const id = single ? api.uid : page === 'directoryNotes' ? (form.id || data.ifsc) :
        page === 'limitNotes' ? data.accountNumber : form.id || draftId.current.id;
      await saveRecord(api, page, id, data);
      draftId.current = null;
      if (!single) setForm({});
    }, request ? 'Application submitted.' : 'Saved.');
  }

  function details(row) {
    if (page === 'loans') {
      const payment = loanEstimate(row.amountMinor / 100, row.months, row.rateBps);
      return [row.productName, money(row.amountMinor / 100), row.months + ' months', (row.rateBps / 100) + '%',
        'Estimated monthly payment ' + money(payment)];
    }
    if (page === 'applications') return [row.name, row.phone, row.address, row.reference,
      row.openingMinor ? 'Requested deposit ' + money(row.openingMinor / 100) : null].filter(Boolean);
    if (page === 'limitNotes') return [row.accountNumber, 'Per transfer ' + money(row.perTransferMinor / 100),
      'Daily ' + money(row.dailyMinor / 100)];
    if (page === 'products') return [row.name, (row.rateBps / 100) + '% annual', row.maxMonths + ' months maximum'];
    return Object.keys(fields).map(key => row[key]);
  }

  const visibleRows = statusFilter === 'ALL' ? rows : rows.filter(row => row.status === statusFilter);
  return <section className="panel feature-panel">
    <header className="panel-head"><h2>{title}</h2>
      {admin && request && <TextField select size="small" label="Status" value={statusFilter}
        onChange={event => setStatusFilter(event.target.value)} sx={{ minWidth: 140 }}>
        {['ALL', 'PENDING', 'HOLD', 'APPROVED', 'REJECTED'].map(status => <MenuItem key={status} value={status}>
          {status === 'ALL' ? 'All statuses' : status}
        </MenuItem>)}
      </TextField>}
    </header>
    <div className="transfer-form">
      {!api && <Alert severity={connectionError ? 'error' : 'info'}>{connectionError || 'Connecting to Firebase…'}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
      {notice && <Alert severity="success">{notice}</Alert>}
      {page === 'closure' && <Alert severity="info">A decision records the review. Closing an X42 account requires the SharedBank operator.</Alert>}
      {page === 'directoryNotes' && <Alert severity="info">Zentro’s directory records are separate from SharedBank transfer routing.</Alert>}
      {page === 'limitNotes' && <Alert severity="info">Proposals are saved for review. SharedBank still enforces its existing limits.</Alert>}
      {ready && edit && <>
        {page === 'kyc' && <Alert severity="info">Use a fictional reference such as DEMO-ID-001.</Alert>}
        {page === 'applications' && <Alert severity="info">This submits a request for review. It does not open a SharedBank account.</Alert>}
        {page === 'loans' && !products.length && <Alert severity="info">Loan applications open once an admin adds a loan product.</Alert>}
        <form className="extras-form" onSubmit={submit}>
          {Object.entries(fields).map(([key, label]) => <TextField key={key} label={label} required size="small"
            select={key === 'product'} disabled={busy || (key === 'product' && !products.length) || (Boolean(form.id) && ['directoryNotes', 'limitNotes'].includes(page) && ['ifsc', 'accountNumber'].includes(key))}
            value={form[key] ?? ''} onChange={event => setForm({ ...form, [key]: event.target.value })}
            slotProps={{ htmlInput: { maxLength: key === 'address' ? 240 : 100 } }}>
            {key === 'product' && products.map(item => <MenuItem key={item.id} value={item.id}>{item.name} · {item.rateBps / 100}%</MenuItem>)}
          </TextField>)}
          {estimate !== null && <p>Estimated monthly payment: {money(estimate)}</p>}
          <div><Button variant="contained" type="submit" disabled={busy || (page === 'loans' && !products.length)}>
            {request ? 'Submit application' : 'Save'}
          </Button>{editable && form.id && !single && <Button type="button" onClick={() => setForm({})}>Cancel edit</Button>}</div>
        </form>
      </>}
      {ready && !visibleRows.length && <p>No records yet.</p>}
    </div>
    {visibleRows.length > 0 && <div className="table-scroll"><table>
      <thead><tr><th>Details</th>{request && <th>Status</th>}<th>Actions</th></tr></thead>
      <tbody>{visibleRows.map(row => <tr key={row.id}>
        <td>{details(row).map((value, index) => <p key={index}>{value}</p>)}</td>
        {request && <td><span className={'request-status ' + row.status?.toLowerCase()}>{row.status}</span></td>}
        <td>
          {admin && request && ['PENDING', 'HOLD'].includes(row.status) && Object.entries(decisionLabels).map(([status, label]) =>
            <Button key={status} disabled={busy || status === row.status} onClick={() => run(
              () => reviewRecord(api, page, row, status), 'Decision saved.',
            )}>{label}</Button>)}
          {edit && editable && !single && <Button disabled={busy} onClick={() => setForm(page === 'products'
            ? { ...row, rate: row.rateBps / 100 } : page === 'limitNotes'
              ? { ...row, perTransfer: row.perTransferMinor / 100, daily: row.dailyMinor / 100 } : row)}>Edit</Button>}
          {admin && ['directoryNotes', 'limitNotes'].includes(page) && <Button color="error" disabled={busy}
            onClick={() => run(() => removeRecord(api, page, row.id), 'Record removed.')}>Remove</Button>}
          {!admin && page === 'beneficiaries' && <Button color="error" disabled={busy} onClick={() => run(
            () => deleteBeneficiary(api, row.id), 'Beneficiary removed.',
          )}>Remove</Button>}
        </td>
      </tr>)}</tbody>
    </table></div>}
    {previousLoans.length > 0 && <div className="transfer-form">
      <h3>Earlier loan requests</h3>
      {previousLoans.map(row => <p key={row.id}>{row.purpose} · {money(row.amountMinor / 100)} · {row.status}</p>)}
    </div>}
  </section>;
}
