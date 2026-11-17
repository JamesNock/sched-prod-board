import { fetchIncidents, ack } from './api.js';

const REFRESH_MS = 2000; // R4

const loader = document.querySelector('[data-testid="loader"]');
const empty = document.querySelector('[data-testid="empty"]');
const list = document.querySelector('[data-testid="incident-list"]');
const status = document.querySelector('.status');

/** id -> { incident, row } — rows are kept, not re-rendered, so an Ack in flight survives a refresh. */
const rows = new Map();

// R5: viewer's locale and zone; the locale decides day/month order (en-GB, de-DE → dd/mm; en-US → mm/dd).
const timeFmt = new Intl.DateTimeFormat(undefined, {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
});

function el(tag, attrs = {}, text) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
}

function buildRow(i) {
  const row = el('li', { 'data-testid': 'incident-row', 'data-id': i.id, class: `row ${i.severity}` });
  row.append(
    el('span', { class: 'id' }, i.id),
    el('span', { class: 'sev' }, i.severity),
    el('span', { class: 'what' }, `${i.service} · ${i.region} · ${i.summary}`),
    el('time', { datetime: i.openedAt, title: i.openedAt }, timeFmt.format(new Date(i.openedAt))),
  );
  const btn = el('button', { type: 'button', 'data-testid': 'ack', class: 'ack' }, 'Ack');
  btn.addEventListener('click', () => askToAck(i.id)); // R2: Ack asks first; the confirm names the id

  row.append(btn);
  return row;
}

// R2 (product, after step 1): the confirm names the incident the click landed on, so a row that moved under
// the pointer is caught before the ack is sent. It holds the id from the click, not a position.
const backdrop = document.querySelector('.confirm-backdrop');
const confirmBox = document.querySelector('[data-testid="confirm"]');
const confirmAck = document.querySelector('[data-testid="confirm-ack"]');
const confirmCancel = document.querySelector('[data-testid="confirm-cancel"]');
let pending = null; // { id, opener }

function askToAck(id) {
  const r = rows.get(id);
  if (!r) return;
  pending = { id, opener: document.activeElement };
  confirmBox.querySelectorAll('.confirm-id').forEach((n) => (n.textContent = id));
  confirmBox.querySelector('.confirm-what').textContent = `${r.incident.severity} · ${r.incident.service} · ${r.incident.region} · ${r.incident.summary}`;
  confirmBox.dataset.id = id;
  backdrop.hidden = false;
  confirmAck.focus();
}

function closeConfirm() {
  const opener = pending?.opener;
  pending = null;
  backdrop.hidden = true;
  delete confirmBox.dataset.id;
  if (opener?.isConnected) opener.focus();
}

confirmAck.addEventListener('click', () => {
  if (!pending) return;
  const { id } = pending;
  closeConfirm();
  const btn = rows.get(id)?.row.querySelector('[data-testid="ack"]');
  if (btn) onAck(id, btn);
});
confirmCancel.addEventListener('click', closeConfirm);
backdrop.addEventListener('click', (e) => e.target === backdrop && closeConfirm());
document.addEventListener('keydown', (e) => e.key === 'Escape' && pending && closeConfirm());

async function onAck(id, btn) {
  btn.disabled = true;
  btn.textContent = 'Acking…';
  try {
    const reply = await ack(id); // R2
    const mark = el('span', { 'data-testid': 'acked', class: 'acked', title: `acked ${reply.ackedAt}` }, '✓ Acked');
    btn.replaceWith(mark);
    rows.get(id)?.row.classList.add('is-acked');
  } catch (err) {
    console.error(err);
    btn.disabled = false;
    btn.textContent = 'Retry ack';
  }
}

// R1: merge by id, newest first. Existing rows stay as they are; new ones go in at their place (the top).
function render(incidents) {
  for (const i of incidents) {
    const known = rows.get(i.id);
    if (known) known.incident = i;
    else rows.set(i.id, { incident: i, row: buildRow(i), fresh: true });
  }
  const ordered = [...rows.values()].sort(
    (a, b) => Date.parse(b.incident.openedAt) - Date.parse(a.incident.openedAt),
  );
  ordered.forEach(({ row }, idx) => {
    if (list.children[idx] !== row) list.insertBefore(row, list.children[idx] ?? null);
  });
  for (const r of ordered) {
    if (r.fresh && list.dataset.ready) r.row.classList.add('is-new');
    r.fresh = false;
  }
  list.dataset.ready = '1';
  list.hidden = rows.size === 0;
  empty.hidden = rows.size !== 0;
}

async function tick() {
  try {
    const page = await fetchIncidents();
    render(page.incidents);
    loader?.remove(); // R3
    status.textContent = `updated ${new Date(page.updatedAt ?? Date.now()).toLocaleTimeString()}`;
  } catch (err) {
    console.error(err);
    status.textContent = 'update failed, retrying…';
  } finally {
    setTimeout(tick, REFRESH_MS); // R4: chained, so a slow answer never overlaps the next
  }
}

tick();
