import { useEffect, useRef, useState } from 'react';
import { Alert, Button, MenuItem, TextField } from '@mui/material';
import { toPaise } from './amount';
import { listServiceRecords } from './services-api';

const string = stringValue => ({ stringValue });
const integer = value => ({ integerValue: String(value) });
const money = minor => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(minor / 100);

export default function CustomerServices({ page, accounts, api, connectionError }) {
  const portfolio = page === 'portfolio';
  const collection = portfolio ? 'portfolio' : 'loanApplications';
  const [records, setRecords] = useState([]);
  const [account, setAccount] = useState('');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const pendingLoan = useRef(null);

  useEffect(() => {
    if (!api) return;
    let active = true;
    listServiceRecords(api, collection).then(items => {
      if (active) { setRecords(items); setLoaded(true); }
    }).catch(failure => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [api, collection]);

  async function submit(event) {
    event.preventDefault();
    if (busy || !loaded) return;
    setError('');
    setNotice('');
    const value = label.trim();
    const minor = toPaise(amount);
    if (!value || (portfolio ? !accounts.some(item => item.accountId === account) : minor === null || minor > 100000000)) {
      setError(portfolio ? 'Choose an account and enter a label.' : 'Enter a purpose and an amount from ₹0.01 to ₹10,00,000.');
      return;
    }
    setBusy(true);
    try {
      if (portfolio) {
        await api(collection, { id: account, fields: { label: string(value) } });
        setRecords(items => [...items.filter(item => item.id !== account), { id: account, label: value }]);
        setNotice('Portfolio label saved.');
      } else {
        const draft = pendingLoan.current;
        const id = draft?.purpose === value && draft.amountMinor === minor ? draft.id : crypto.randomUUID();
        pendingLoan.current = { id, purpose: value, amountMinor: minor };
        try {
          await api(collection, { id, create: true, fields: {
            purpose: string(value), amountMinor: integer(minor), status: string('PENDING'),
          } });
          setRecords(items => [...items, { id, purpose: value, amountMinor: minor, status: 'PENDING' }]);
        } catch (failure) {
          if (failure.status !== 409) throw failure;
          const updated = await listServiceRecords(api, collection);
          if (!updated.some(item => item.id === id)) throw failure;
          setRecords(updated);
        }
        pendingLoan.current = null;
        setNotice('Loan application submitted for review.');
        setAmount('');
        setLabel('');
      }
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel">
    <header className="panel-head"><div>
      <h2>{portfolio ? 'Account portfolio' : 'Loan applications'}</h2>
      <p>{portfolio ? 'Give your SharedBank accounts labels you recognise.' : 'Submit a test loan request and check its review status.'}</p>
    </div></header>
    {!api ? <div className="transfer-form"><Alert severity={connectionError ? 'error' : 'info'}>
      {connectionError || 'Connecting to Zentro services…'}</Alert></div> :
      <form className="transfer-form" onSubmit={submit}>
        {portfolio && <TextField select required label="Account" value={account} disabled={busy || !accounts.length}
          onChange={event => {
            const id = event.target.value;
            setAccount(id);
            setLabel(records.find(item => item.id === id)?.label || '');
          }}>
          {accounts.map(item => <MenuItem key={item.accountId} value={item.accountId}>{item.accountNumber}</MenuItem>)}
        </TextField>}
        <TextField required label={portfolio ? 'Portfolio label' : 'Loan purpose'} value={label}
          disabled={busy} onChange={event => setLabel(event.target.value)}
          slotProps={{ htmlInput: { maxLength: portfolio ? 60 : 240 } }} />
        {!portfolio && <TextField required label="Amount in INR" value={amount} disabled={busy}
          onChange={event => setAmount(event.target.value)} slotProps={{ htmlInput: { inputMode: 'decimal' } }} />}
        {error && <Alert severity="error">{error}</Alert>}
        {notice && <Alert severity="success">{notice}</Alert>}
        <div><Button type="submit" variant="contained" disabled={!loaded || busy || (portfolio && !accounts.length)}>
          {portfolio ? 'Save label' : 'Submit application'}
        </Button></div>
      </form>}
    {loaded && <div className="table-scroll"><table><thead><tr>
      <th>{portfolio ? 'Account' : 'Purpose'}</th><th>{portfolio ? 'Label' : 'Requested amount'}</th>
      {!portfolio && <th>Status</th>}
    </tr></thead><tbody>{portfolio ? accounts.map(item => <tr key={item.accountId}>
      <td>{item.accountNumber}</td><td>{records.find(record => record.id === item.accountId)?.label || '—'}</td>
    </tr>) : records.map(item => <tr key={item.id}>
      <td>{item.purpose}</td><td>{money(item.amountMinor)}</td><td>{item.status}</td>
    </tr>)}</tbody></table></div>}
  </section>;
}
