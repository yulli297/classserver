const express = require('express');
const crypto = require('crypto');
const path = require('path');
const admin = require('firebase-admin');

// ---------- 설정 (Render 환경변수) ----------
const SECRET = process.env.TOKEN_SECRET || 'change-me';
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || 'teacher1234';
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');

const INCOME_TAX_RATE = 0.1; // 월급에서 원천징수하는 소득세율
const JOBS = { shop: '상점관리', tax: '국세청장' };

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- 도우미 ----------
class UserError extends Error {}

const hashPin = (pin) =>
  crypto.createHash('sha256').update(SECRET + String(pin)).digest('hex');

function makeToken(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 1000 * 60 * 60 * 12 })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function readToken(token) {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const data = JSON.parse(Buffer.from(body, 'base64url').toString());
  return data.exp > Date.now() ? data : null;
}

// 로그인만 확인
function auth(role) {
  return (req, res, next) => {
    const user = readToken((req.headers.authorization || '').replace('Bearer ', ''));
    if (!user || (role && user.role !== role)) return res.status(401).json({ error: '다시 로그인해 주세요' });
    req.user = user;
    next();
  };
}

// 권한 확인: 선생님은 모두 통과, 학생은 해당 직업(shop/tax)이 있어야 통과.
// guard('teacher')는 선생님만, guard('shop')은 선생님 + 상점관리 학생.
function guard(...perms) {
  return async (req, res, next) => {
    const user = readToken((req.headers.authorization || '').replace('Bearer ', ''));
    if (!user) return res.status(401).json({ error: '다시 로그인해 주세요' });
    req.user = user;
    if (user.role === 'teacher') return next();
    const jobPerms = perms.filter((p) => p !== 'teacher');
    if (!jobPerms.length) return res.status(403).json({ error: '선생님만 할 수 있어요' });
    try {
      const d = await db.collection('students').doc(user.id).get();
      const jobs = d.exists ? d.data().jobs || [] : [];
      if (jobPerms.some((p) => jobs.includes(p))) return next();
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: '서버에 문제가 생겼어요' });
    }
    res.status(403).json({ error: '권한이 없어요' });
  };
}

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e instanceof UserError) return res.status(400).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: '서버에 문제가 생겼어요' });
  }
};

const sortByNumber = (a, b) => Number(a.id) - Number(b.id);
const toIds = (ids) => [...new Set((Array.isArray(ids) ? ids : []).map(String))];
const toAmount = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new UserError('금액은 1 이상의 정수로 적어 주세요');
  return n;
};

async function studentView(id) {
  const ref = db.collection('students').doc(String(id));
  const [doc, logs] = await Promise.all([ref.get(), ref.collection('logs').orderBy('at', 'desc').limit(10).get()]);
  if (!doc.exists) throw new UserError('없는 학생이에요');
  const s = doc.data();
  return {
    id: doc.id,
    name: s.name,
    balance: s.balance,
    jobs: s.jobs || [],
    logs: logs.docs.map((l) => ({ ...l.data(), at: l.data().at ? l.data().at.toMillis() : Date.now() })),
  };
}

// ---------- 로그인 ----------
app.post('/api/login', wrap(async (req, res) => {
  const { role, id, pin } = req.body;
  if (role === 'teacher') {
    if (pin !== TEACHER_PASSWORD) throw new UserError('비밀번호가 달라요');
    return res.json({ token: makeToken({ role: 'teacher' }), role: 'teacher' });
  }
  const doc = await db.collection('students').doc(String(id)).get();
  if (!doc.exists || doc.data().pinHash !== hashPin(pin)) throw new UserError('번호 또는 비밀번호가 달라요');
  res.json({ token: makeToken({ role: 'student', id: doc.id }), role: 'student' });
}));

// ---------- 학생 화면 ----------
app.get('/api/me', auth('student'), wrap(async (req, res) => {
  res.json(await studentView(req.user.id));
}));

// 선생님이 학생 화면을 그대로 미리 보기
app.get('/api/teacher/view/:id', guard('teacher'), wrap(async (req, res) => {
  res.json(await studentView(req.params.id));
}));

app.post('/api/pin', auth('student'), wrap(async (req, res) => {
  const { oldPin, newPin } = req.body;
  if (!newPin || String(newPin).length < 4) throw new UserError('새 비밀번호는 4자리 이상이에요');
  const ref = db.collection('students').doc(req.user.id);
  const doc = await ref.get();
  if (doc.data().pinHash !== hashPin(oldPin)) throw new UserError('현재 비밀번호가 달라요');
  await ref.update({ pinHash: hashPin(newPin) });
  res.json({ ok: true });
}));

app.get('/api/shop', auth(), wrap(async (req, res) => {
  const snap = await db.collection('items').get();
  res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
}));

app.post('/api/buy', auth('student'), wrap(async (req, res) => {
  const { itemId } = req.body;
  const result = await db.runTransaction(async (t) => {
    const sRef = db.collection('students').doc(req.user.id);
    const iRef = db.collection('items').doc(String(itemId));
    const [s, i] = await Promise.all([t.get(sRef), t.get(iRef)]);
    if (!i.exists) throw new UserError('없는 상품이에요');
    const item = i.data();
    const stu = s.data();
    if (item.stock <= 0) throw new UserError('품절이에요');
    if (stu.balance < item.price) throw new UserError('행복이 부족해요');
    const balance = stu.balance - item.price;
    t.update(sRef, { balance });
    t.update(iRef, { stock: item.stock - 1, sold: (item.sold || 0) + 1 });
    t.set(sRef.collection('logs').doc(), {
      type: 'buy', amount: -item.price, memo: item.name, balanceAfter: balance, at: FieldValue.serverTimestamp(),
    });
    return { balance, stock: item.stock - 1 };
  });
  res.json(result);
}));

// ---------- 상점 교사 모드 (선생님 + 상점관리 학생) ----------
// 상품 추가/수정. 재고를 새로 넣으면 팔린 수도 0으로 초기화
app.post('/api/shop/item', guard('shop'), wrap(async (req, res) => {
  const { id, name, price, stock } = req.body;
  if (!name || !Number.isFinite(Number(price)) || !Number.isFinite(Number(stock))) throw new UserError('상품 정보를 확인해 주세요');
  const data = { name: String(name), price: Number(price), stock: Number(stock), sold: 0 };
  if (id) await db.collection('items').doc(String(id)).set(data, { merge: true });
  else await db.collection('items').add(data);
  res.json({ ok: true });
}));

app.delete('/api/shop/item/:id', guard('shop'), wrap(async (req, res) => {
  await db.collection('items').doc(req.params.id).delete();
  res.json({ ok: true });
}));

// ---------- 학생 명단 (선생님 + 국세청장) ----------
app.get('/api/roster', guard('tax'), wrap(async (req, res) => {
  const snap = await db.collection('students').get();
  res.json(
    snap.docs
      .map((d) => ({ id: d.id, name: d.data().name, balance: d.data().balance, jobs: d.data().jobs || [] }))
      .sort(sortByNumber)
  );
}));

// ---------- 정산 ----------
// kind 'salary': 월급 지급(소득세 원천징수 → 국고, 빚은 월급에서 자동 상환)
// kind 'charge': 월세·세금·벌금 징수(잔액이 부족해도 빚으로 처리, 전액 국고)
async function applySettlement({ ids, kind, amount, memo }) {
  return db.runTransaction(async (t) => {
    const tRef = db.collection('meta').doc('treasury');
    const refs = ids.map((id) => db.collection('students').doc(id));
    const [tDoc, ...docs] = await Promise.all([t.get(tRef), ...refs.map((r) => t.get(r))]);
    let treasury = tDoc.exists ? tDoc.data().balance : 0;
    const results = [];
    docs.forEach((d, k) => {
      if (!d.exists) return;
      const before = d.data().balance;
      let delta, toTreasury, note;
      if (kind === 'salary') {
        const tax = Math.floor(amount * INCOME_TAX_RATE);
        delta = amount - tax;
        toTreasury = tax;
        note = `${memo || '월급'} ${amount} (소득세 ${tax} 원천징수${before < 0 ? ', 빚 자동 상환' : ''})`;
      } else {
        delta = -amount;
        toTreasury = amount;
        note = memo || '세금';
      }
      const after = before + delta;
      treasury += toTreasury;
      t.update(refs[k], { balance: after });
      t.set(refs[k].collection('logs').doc(), {
        type: kind, amount: delta, memo: note, balanceAfter: after, at: FieldValue.serverTimestamp(),
      });
      results.push({ id: d.id, name: d.data().name, before, delta, after });
    });
    t.set(tRef, { balance: treasury });
    return { results, treasury };
  });
}

app.get('/api/treasury', guard('tax'), wrap(async (req, res) => {
  const d = await db.collection('meta').doc('treasury').get();
  res.json({ balance: d.exists ? d.data().balance : 0 });
}));

// 월급: 선생님만
app.post('/api/settle/salary', guard('teacher'), wrap(async (req, res) => {
  const ids = toIds(req.body.ids);
  if (!ids.length) throw new UserError('학생을 선택해 주세요');
  res.json(await applySettlement({ ids, kind: 'salary', amount: toAmount(req.body.amount), memo: req.body.memo }));
}));

// 월세·세금·벌금: 선생님 + 국세청장
app.post('/api/settle/charge', guard('tax'), wrap(async (req, res) => {
  const ids = toIds(req.body.ids);
  if (!ids.length) throw new UserError('학생을 선택해 주세요');
  res.json(await applySettlement({ ids, kind: 'charge', amount: toAmount(req.body.amount), memo: req.body.memo }));
}));

// ---------- 선생님 전용 ----------
// 이름 목록으로 학생 일괄 생성 (이미 있는 번호는 건드리지 않음, 초기 비밀번호 0000)
app.post('/api/teacher/seed', guard('teacher'), wrap(async (req, res) => {
  const names = (req.body.names || []).map((n) => String(n).trim()).filter(Boolean);
  if (!names.length) throw new UserError('이름을 한 줄에 한 명씩 적어 주세요');
  const batch = db.batch();
  let created = 0;
  for (let n = 0; n < names.length; n++) {
    const ref = db.collection('students').doc(String(n + 1));
    if ((await ref.get()).exists) continue;
    batch.set(ref, { name: names[n], balance: 0, jobs: [], pinHash: hashPin('0000') });
    created++;
  }
  await batch.commit();
  res.json({ created });
}));

// 행복 지급/차감 (여러 명 동시 가능, 잔액이 마이너스가 되어도 허용)
app.post('/api/teacher/adjust', guard('teacher'), wrap(async (req, res) => {
  const { amount, memo } = req.body;
  const ids = toIds(req.body.ids);
  const amt = Number(amount);
  if (!ids.length) throw new UserError('학생을 선택해 주세요');
  if (!Number.isFinite(amt) || amt === 0) throw new UserError('금액을 확인해 주세요');
  await db.runTransaction(async (t) => {
    const refs = ids.map((id) => db.collection('students').doc(id));
    const docs = await Promise.all(refs.map((r) => t.get(r)));
    docs.forEach((d, k) => {
      if (!d.exists) return;
      const balance = d.data().balance + amt;
      t.update(refs[k], { balance });
      t.set(refs[k].collection('logs').doc(), {
        type: amt > 0 ? 'give' : 'take', amount: amt, memo: memo || '', balanceAfter: balance, at: FieldValue.serverTimestamp(),
      });
    });
  });
  res.json({ ok: true });
}));

// 직업 지정 (예: ['shop'], ['tax'], [])
app.post('/api/teacher/jobs', guard('teacher'), wrap(async (req, res) => {
  const jobs = (Array.isArray(req.body.jobs) ? req.body.jobs : []).filter((j) => JOBS[j]);
  await db.collection('students').doc(String(req.body.id)).update({ jobs });
  res.json({ ok: true });
}));

app.post('/api/teacher/reset-pin', guard('teacher'), wrap(async (req, res) => {
  await db.collection('students').doc(String(req.body.id)).update({ pinHash: hashPin('0000') });
  res.json({ ok: true });
}));

// 서버 깨우기용
app.get('/ping', (req, res) => res.send('ok'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`돼지공주나라 서버 시작: ${PORT}`));
