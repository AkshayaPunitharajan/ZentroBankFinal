import { toPaise } from './amount';

export const pages = {
  kyc: { title: 'KYC', fields: { name: 'Full name', reference: 'Sample document reference' }, request: true },
  applications: { title: 'Account applications', fields: { name: 'Full name', phone: 'Phone', address: 'Sample address', opening: 'Requested opening deposit (INR)', reference: 'Sample KYC reference' }, request: true },
  beneficiaries: { title: 'Beneficiaries', fields: { name: 'Name', ifsc: 'IFSC', accountNumber: 'Account number' }, editable: true },
  profiles: { title: 'Profile', fields: { name: 'Full name', address: 'Address', phone: 'Phone' }, editable: true, single: true },
  loans: { title: 'Loans', fields: { product: 'Loan product', amount: 'Amount in INR', months: 'Term in months' }, request: true },
  closure: { title: 'Closure requests', fields: { accountNumber: 'Account number', reason: 'Reason for requesting closure' }, request: true },
  directoryNotes: { title: 'Zentro bank directory', fields: { name: 'Bank name', ifsc: 'IFSC', address: 'Bank address' }, editable: true },
  limitNotes: { title: 'Limit proposals', fields: { accountNumber: 'Account number', perTransfer: 'Per-transfer limit (INR)', daily: 'Daily limit (INR)' }, editable: true },
  products: { title: 'Loan products', fields: { name: 'Product name', rate: 'Annual rate in %', maxMonths: 'Maximum term in months' }, editable: true },
};

function decode(doc) {
  return {
    id: doc.name.split('/').at(-1),
    ...Object.fromEntries(Object.entries(doc.fields || {}).map(([key, value]) =>
      [key, value.integerValue === undefined ? value.stringValue : Number(value.integerValue)])),
  };
}

export function applicationFields(form) {
  const name = String(form.name ?? '').trim();
  const address = String(form.address ?? '').trim();
  const phone = String(form.phone ?? '').trim();
  const reference = String(form.reference ?? '').trim();
  const openingMinor = toPaise(String(form.opening ?? ''));
  if (!name || name.length > 100 || !address || address.length > 240) throw new Error('Enter a name and sample address.');
  if (!/^[+0-9 ()-]{6,25}$/.test(phone)) throw new Error('Enter a valid phone number.');
  if (!/^DEMO-[A-Za-z0-9-]{1,75}$/.test(reference)) throw new Error('Use a fictional reference such as DEMO-ID-001.');
  if (!openingMinor || openingMinor < 100000 || openingMinor > 100000000) {
    throw new Error('Enter a requested test deposit between ₹1,000 and ₹10,00,000.');
  }
  return { name, address, phone, openingMinor, reference };
}

const root = 'portal/';
const encode = values => Object.fromEntries(Object.entries(values).map(([key, value]) =>
  [key, typeof value === 'number' ? { integerValue: String(value) } : { stringValue: value }]));

export async function records(api, page, admin) {
  if (['products', 'directoryNotes'].includes(page) || admin) {
    const rows = [];
    let pageToken;
    do {
      const result = await api.addon(root + page, { query: pageToken ? new URLSearchParams({ pageToken }) : undefined });
      rows.push(...(result.documents || []).map(decode));
      pageToken = result.nextPageToken;
    } while (pageToken);
    return rows;
  }
  const result = await api.addon('portal:runQuery', {
    method: 'POST', body: { structuredQuery: {
      from: [{ collectionId: page }],
      where: { fieldFilter: { field: { fieldPath: 'uid' }, op: 'EQUAL', value: { stringValue: api.uid } } },
    } },
  });
  return result.filter(row => row.document).map(row => decode(row.document));
}

export function saveRecord(api, page, id, values) {
  return api.addon(root + page + '/' + encodeURIComponent(id), {
    method: 'PATCH', body: { fields: encode(values) },
  });
}

export function reviewRecord(api, page, row, status) {
  return api.addon(root + page + '/' + encodeURIComponent(row.id), {
    method: 'PATCH', query: new URLSearchParams({ 'updateMask.fieldPaths': 'status' }),
    body: { fields: encode({ status }) },
  });
}

export function deleteBeneficiary(api, id) {
  return removeRecord(api, 'beneficiaries', id);
}

export function removeRecord(api, page, id) {
  return api.addon(root + page + '/' + encodeURIComponent(id), { method: 'DELETE' });
}
