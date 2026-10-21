// 돼지공주나라 서버 v3 — 기존 Apps Script 앱의 규칙을 Firebase(Firestore)로 옮긴 버전
// 1단계: 기본정보 · 상점(세금/간식/쿠폰/공동구매) · 신용 · 월급 · 국고
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const admin = require('firebase-admin');

// ---------- 환경설정 (Render 환경변수) ----------
const SECRET = process.env.TOKEN_SECRET || 'change-me';
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || 'teacher1234';
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ======================================================================
//  기본 설정값 (기존 '설정' 시트와 같은 이름·같은 기본값)
// ======================================================================
const DEFAULTS = {
  나라이름: '돼지공주나라',
  화폐단위: '행복',
  소득세율: 10,
  월세: 30,
  빚허용: 'Y', // Y면 세금은 잔액이 모자라도 빚으로 납부
  빚이면구매금지: 'Y', // Y면 빚이 있는 학생은 간식·쿠폰 구매 불가
  세금초기화일: 16, // 매달 이 날 새 세금 주기가 시작
  신용시작점수: 15,
  신용등급컷: '24,18,12,6',
  수학등급컷: '90,80,70,60',
  제출점수: 1,
  미제출점수: 0,
  수학최대점수: 100,
  공동구매최소금액: 300,
  예금최소금액: 100,
  예금최대일수: 60,
};
const EDITABLE_SETTINGS = Object.keys(DEFAULTS);

// 직업 (기존 '직업데이터'와 같음). perms: 자리관리 / 국고관리 / 제출승인 / 신용관리 / 벌금 / 은행관리 / 상점관리
const SEED_JOBS = [
  ['J01', '국무총리', 400, 5, 5, '학급을 대표합니다. 선출직이라 등급 제한이 없어요', '', 1, '국고'],
  ['J02', '교육부 장관', 390, 2, 3, '매일 달력을 바꾸고 다했어요 보드판을 최신화합니다', '', 1, '국고'],
  ['J03', '외교부 장관', 390, 2, 3, '가정통신문을 챙겨오고 배부를 관리합니다', '', 1, '국고'],
  ['J04', '환경부 장관', 390, 2, 3, '교실 청소를 감독하고 공기청정기와 환기를 관리합니다', '', 1, '국고'],
  ['J05', '국토교통부 장관', 390, 2, 3, '교실 자리를 관리하고 자리 구매 신청을 승인합니다', '자리관리', 1, '국고'],
  ['J06', '국세청장', 380, 2, 2, '나라 세금이 어디서 생기고 어디로 나가는지 관리합니다', '국고관리', 1, '국고'],
  ['J07', '통계청 공무원', 380, 3, 4, '숙제와 가정통신문 제출을 확인합니다. 두 명이 함께 일해요', '제출승인', 2, '국고'],
  ['J08', '외교부 공무원', 370, 4, 4, '가정통신문을 다른 반에 신속 정확하게 배달합니다', '', 3, '국고'],
  ['J09', '환경부 공무원', 370, 4, 5, '분단별 청소를 감독하고 분리수거를 합니다', '', 3, '국고'],
  ['J10', '신용등급 평가원', 370, 3, 3, '전체 학생의 신용점수를 살피고 등급 기준을 관리합니다', '신용관리', 1, '민간'],
  ['J11', '경찰', 360, 3, 4, '규칙을 어긴 친구에게 벌금을 매깁니다', '벌금', 2, '국고'],
  ['J12', '성실 은행장', 370, 3, 3, '친구들의 예금을 관리하고 만기가 되면 이자를 줍니다', '은행관리', 1, '민간'],
  ['J13', '친절병원', 360, 4, 5, '학급 치료 물품을 관리합니다', '', 1, '민간'],
  ['J14', '나눔 슈퍼', 370, 3, 4, '상점 물품과 재고를 관리합니다', '상점관리', 1, '민간'],
  ['J15', '우리 전자', 360, 2, 4, '학급 패드 충전함을 관리합니다. 비밀번호는 비밀이에요', '', 1, '민간'],
  ['J16', '아르바이트생', 0, 5, 5, '정해진 월급이 없어요. 스스로 일을 찾아 벌어야 합니다', '', 3, '민간'],
];

// 상점 (기존 '상점데이터'와 같음). [id, 카테고리, 이름, 가격, 설명, 재고, 하루 1인 한도]
const SEED_ITEMS = [
  ['I01', '세금', '월세', 30, '자리를 사지 않은 사람이 매달 내는 자리 사용료입니다', null, 1],
  ['I02', '세금', '전기세', 50, '교실 전기 사용료입니다', null, 1],
  ['I03', '세금', '건강보험료', 50, '보건실을 이용하기 위한 보험료입니다', null, 1],
  ['I11', '간식', '사탕 1개', 150, '쉬는 시간에 먹을 수 있어요', 40, 2],
  ['I12', '간식', '초콜릿', 300, '달콤한 에너지 충전', 20, 1],
  ['I13', '간식', '젤리 한 봉지', 250, '쫀득쫀득한 간식', 25, 2],
  ['I21', '쿠폰', '자리 바꾸기권', 1200, '하루 동안 원하는 자리로 이동', 5, 1],
  ['I22', '쿠폰', '숙제 면제권', 2500, '숙제 하나를 면제받아요', 3, 1],
  ['I23', '쿠폰', '음악 신청권', 800, '쉬는 시간에 노래를 신청해요', 10, 2],
  ['I24', '쿠폰', '선생님과 점심', 1500, '선생님 옆자리에서 점심을 먹어요', 4, 1],
];
// 이자율표 [일수, 이름, 1~5등급 이자율(%)]
const SEED_RATES = [
  [14, '2주', [4, 3, 2, 1, 1]],
  [30, '1개월', [8, 7, 5, 3, 2]],
  [60, '2개월', [14, 12, 9, 6, 3]],
];
const CATEGORIES = ['세금', '간식', '쿠폰'];
const TREASURY_IN = ['소득세', '월세', '전기세', '건강보험료', '벌금', '자리판매', '상점수입', '공동구매', '기타수입'];
const TREASURY_OUT = ['공무원월급', '은행이자', '보너스', '부동산개발', '기타지출'];

async function ensureSeed() {
  const rates = await db.collection('rates').limit(1).get();
  if (rates.empty) {
    const b = db.batch();
    SEED_RATES.forEach((r) => b.set(db.collection('rates').doc(String(r[0])), { days: r[0], name: r[1], rates: r[2] }));
    await b.commit();
  }
  const jobs = await db.collection('jobs').limit(1).get();
  if (jobs.empty) {
    const b = db.batch();
    SEED_JOBS.forEach((j, i) =>
      b.set(db.collection('jobs').doc(j[0]), {
        name: j[1], salary: j[2], minCredit: j[3], minMath: j[4], desc: j[5],
        perms: j[6] ? j[6].split(',') : [], capacity: j[7], source: j[8], order: i,
      })
    );
    await b.commit();
  }
  const items = await db.collection('shopItems').limit(1).get();
  if (items.empty) {
    const b = db.batch();
    SEED_ITEMS.forEach((x, i) =>
      b.set(db.collection('shopItems').doc(x[0]), {
        category: x[1], name: x[2], price: x[3], desc: x[4], active: true,
        stock: x[5], limit: x[6], baseline: 0, sold: 0, order: i,
      })
    );
    await b.commit();
  }
}

// ======================================================================
//  도우미
// ======================================================================
class UserError extends Error {}

const hashPin = (pin) => crypto.createHash('sha256').update(SECRET + String(pin)).digest('hex');
const DEFAULT_PIN = '1111';

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

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e instanceof UserError) return res.status(400).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: '서버에 문제가 생겼어요' });
  }
};

// 설정 (10초 캐시)
let settingsCache = { at: 0, value: null };
async function getSettings() {
  if (settingsCache.value && Date.now() - settingsCache.at < 10000) return settingsCache.value;
  const d = await db.collection('meta').doc('settings').get();
  const value = { ...DEFAULTS, ...(d.exists ? d.data() : {}) };
  settingsCache = { at: Date.now(), value };
  return value;
}

// 직업 목록 (10초 캐시)
let jobsCache = { at: 0, value: null };
async function getJobs() {
  if (jobsCache.value && Date.now() - jobsCache.at < 10000) return jobsCache.value;
  const snap = await db.collection('jobs').get();
  const value = {};
  snap.docs.forEach((d) => (value[d.id] = { id: d.id, ...d.data() }));
  jobsCache = { at: Date.now(), value };
  return value;
}
const clearCaches = () => { settingsCache = { at: 0, value: null }; jobsCache = { at: 0, value: null }; };

// 한국 시간(KST) 기준 날짜
const kst = (d) => new Date(d.getTime() + 9 * 3600 * 1000);
const dayStr = (d) => kst(d).toISOString().slice(0, 10);
const timeStr = (d) => { const k = kst(d).toISOString(); return `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))} ${k.slice(11, 16)}`; };
const startDayOf = (S) => { const n = Math.round(Number(S.세금초기화일)); return n >= 2 && n <= 28 ? n : 16; };
// 세금 주기 이름: 주기가 시작된 달 (예: 10/16 ~ 11/15 → '2026-10')
function cycleOf(d, startDay) {
  const s = dayStr(d);
  let y = Number(s.slice(0, 4)), m = Number(s.slice(5, 7));
  if (Number(s.slice(8, 10)) < startDay) { m--; if (m === 0) { m = 12; y--; } }
  return `${y}-${String(m).padStart(2, '0')}`;
}
function cycleRange(startDay) {
  const [y, m] = cycleOf(new Date(), startDay).split('-').map(Number);
  const endM = m === 12 ? 1 : m + 1;
  return { start: `${m}월 ${startDay}일`, end: `${endM}월 ${startDay - 1}일` };
}

function gradeOf(value, cuts) {
  const c = String(cuts).split(',').map(Number).filter((n) => !isNaN(n));
  if (!c.length) return 5;
  for (let i = 0; i < c.length; i++) if (value >= c[i]) return i + 1;
  return c.length + 1;
}
const mathGrade = (score, S) => (score === null || score === undefined || isNaN(Number(score)) ? null : gradeOf(Number(score), S.수학등급컷));

const toInt = (v, msg) => {
  const n = Math.round(Number(v));
  if (v === '' || v === null || v === undefined || !Number.isFinite(n)) throw new UserError(msg || '숫자를 확인해 주세요');
  return n;
};
const uniqIds = (ids) => [...new Set((Array.isArray(ids) ? ids : []).map(String))];
const newId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ----------------------------------------------------------------------
//  로그인 · 권한
// ----------------------------------------------------------------------
function auth(req, res, next) {
  const user = readToken((req.headers.authorization || '').replace('Bearer ', ''));
  if (!user) return res.status(401).json({ error: '다시 로그인해 주세요' });
  req.user = user;
  next();
}
function studentOnly(req, res, next) {
  if (req.user.role !== 'student') return res.status(403).json({ error: '학생 화면에서만 할 수 있어요 (미리보기 중이에요)' });
  next();
}
// 선생님은 모두 통과, 학생은 직업의 권한(perms)에 해당 항목이 있어야 통과
function guard(...perms) {
  return [auth, async (req, res, next) => {
    if (req.user.role === 'teacher') return next();
    const need = perms.filter((p) => p !== 'teacher');
    if (!need.length) return res.status(403).json({ error: '선생님만 할 수 있어요' });
    try {
      const d = await db.collection('students').doc(req.user.id).get();
      const jobs = await getJobs();
      const job = d.exists ? jobs[d.data().jobId] : null;
      if (job && need.some((p) => (job.perms || []).includes(p))) return next();
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: '서버에 문제가 생겼어요' });
    }
    res.status(403).json({ error: '권한이 없어요' });
  }];
}
// 화면에 보여 줄 학생: 학생은 본인, 선생님은 ?as=번호 (미리보기)
function targetId(req) {
  if (req.user.role === 'student') return req.user.id;
  const id = String(req.query.as || req.body?.as || '');
  if (!id) throw new UserError('미리 볼 학생을 골라 주세요');
  return id;
}

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

app.post('/api/pin', auth, studentOnly, wrap(async (req, res) => {
  const { oldPin, newPin } = req.body;
  if (!/^[0-9]{4}$/.test(String(newPin))) throw new UserError('새 비밀번호는 숫자 4자리여야 해요');
  const ref = db.collection('students').doc(req.user.id);
  const doc = await ref.get();
  if (doc.data().pinHash !== hashPin(oldPin)) throw new UserError('지금 쓰는 비밀번호가 달라요');
  await ref.update({ pinHash: hashPin(newPin) });
  res.json({ ok: true });
}));

// ======================================================================
//  원장(거래) 처리 — 돈이 움직이는 모든 일은 여기를 지납니다
//   · 거래원장(ledger)은 쌓기만 하는 기록, students.balance는 빠른 요약
//   · 거래번호(txId)가 같으면 두 번 처리되지 않아요 (더블클릭·재전송 방지)
//   · 한 묶음은 하나의 트랜잭션: 모두 되거나, 모두 안 되거나
// ======================================================================
async function loadStudents(t, ids) {
  const map = new Map();
  const docs = await Promise.all(ids.map((id) => t.get(db.collection('students').doc(id))));
  docs.forEach((d) => { if (d.exists) map.set(d.id, { ref: d.ref, name: d.data().name, balance: d.data().balance || 0, data: d.data() }); });
  return map;
}
function stageEntry(t, students, e, at) {
  const s = students.get(e.studentId);
  if (!s) throw new UserError('학생을 찾을 수 없어요');
  const after = s.balance + e.amount;
  if (after < 0 && !e.allowNegative) throw new UserError(e.failMsg || '행복이 부족해요');
  s.balance = after;
  t.set(db.collection('ledger').doc(e.txId), {
    studentId: e.studentId, kind: e.kind, amount: e.amount, reason: e.reason || '', memo: e.memo || '',
    by: e.by || '', balanceAfter: after, at,
  });
  t.update(s.ref, { balance: after });
  return after;
}
function stageTreasury(t, id, row, at) {
  t.set(db.collection('treasury').doc(id), {
    kind: row.kind, amount: Math.round(row.amount), reason: row.reason || '',
    studentId: row.studentId || '', by: row.by || '', at,
  });
}
// 여러 학생에게 한꺼번에 (월급·조정 등). batchId가 같으면 한 번만 처리됩니다.
async function runBatch(batchId, entries, treasuryRows = []) {
  if (!entries.length) throw new UserError('처리할 학생이 없어요');
  const at = Timestamp.now();
  const withIds = entries.map((e) => ({ ...e, txId: `${batchId}:${e.studentId}:${e.kind}` }));
  return db.runTransaction(async (t) => {
    const first = await t.get(db.collection('ledger').doc(withIds[0].txId));
    const students = await loadStudents(t, [...new Set(withIds.map((e) => e.studentId))]);
    if (first.exists) return { duplicate: true };
    withIds.forEach((e) => stageEntry(t, students, e, at));
    treasuryRows.forEach((r, i) => stageTreasury(t, `${batchId}:T${i}`, r, at));
    return { duplicate: false };
  });
}

// ======================================================================
//  신용 · 학생 정보
// ======================================================================
function creditSummary(rows, S) {
  let earned = 0, adjust = 0, submitted = 0, missed = 0;
  rows.forEach((r) => {
    earned += r.points;
    if (r.status === '조정') adjust += r.points;
    else if (r.status === '제출') submitted++;
    else if (r.status === '미제출') missed++;
  });
  const start = Number(S.신용시작점수);
  const total = start + earned;
  return { start, earned, adjust, total, grade: gradeOf(total, S.신용등급컷), submitted, missed };
}
async function creditRows(studentId) {
  const snap = await db.collection('credits').where('studentId', '==', studentId).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
const netPay = (salary, S) => Math.round((salary * (100 - Number(S.소득세율))) / 100);

async function buildInfo(id) {
  const [S, jobs, doc] = await Promise.all([getSettings(), getJobs(), db.collection('students').doc(id).get()]);
  if (!doc.exists) throw new UserError('학생을 찾을 수 없어요');
  const s = doc.data();
  const credit = creditSummary(await creditRows(id), S);
  const job = jobs[s.jobId] || null;
  const balance = s.balance || 0;
  const seat = s.seat ? { label: s.seat, paid: !!s.seatPaid } : null;
  return {
    id: doc.id, name: s.name, balance, debt: balance < 0, currency: S.화폐단위, country: S.나라이름,
    credit: { grade: credit.grade, total: credit.total, start: credit.start, adjust: credit.adjust, submitted: credit.submitted, missed: credit.missed },
    math: s.math === undefined ? null : s.math, mathGrade: mathGrade(s.math, S),
    job: job ? { id: job.id, name: job.name, desc: job.desc, salary: job.salary, net: netPay(job.salary, S), perms: job.perms || [] } : null,
    taxRate: Number(S.소득세율), rent: Number(S.월세), seat,
    rentExempt: !!(seat && seat.paid),
  };
}

app.get('/api/info', auth, wrap(async (req, res) => {
  res.json(await buildInfo(targetId(req)));
}));

// 내 권한 (교사 모드 버튼을 보여 줄지 결정)
app.get('/api/whoami', auth, wrap(async (req, res) => {
  if (req.user.role === 'teacher') return res.json({ role: 'teacher', perms: ['teacher', '상점관리', '국고관리', '신용관리', '은행관리', '자리관리', '제출승인', '벌금'] });
  const d = await db.collection('students').doc(req.user.id).get();
  const jobs = await getJobs();
  const job = d.exists ? jobs[d.data().jobId] : null;
  res.json({ role: 'student', id: req.user.id, name: d.exists ? d.data().name : '', perms: job ? job.perms || [] : [] });
}));

app.get('/api/history', auth, wrap(async (req, res) => {
  const id = targetId(req);
  const limit = Math.min(Number(req.query.limit) || 30, 200);
  const snap = await db.collection('ledger').where('studentId', '==', id).get();
  const rows = snap.docs.map((d) => d.data()).sort((a, b) => b.at.toMillis() - a.at.toMillis()).slice(0, limit);
  res.json(rows.map((r) => ({ at: timeStr(r.at.toDate()), kind: r.kind, amount: r.amount, reason: r.reason || r.kind })));
}));

app.get('/api/credit', auth, wrap(async (req, res) => {
  const id = targetId(req);
  const S = await getSettings();
  const rows = await creditRows(id);
  const sum = creditSummary(rows, S);
  const list = rows.sort((a, b) => b.at.toMillis() - a.at.toMillis()).slice(0, 40)
    .map((r) => ({ date: timeStr(r.at.toDate()).split(' ')[0], item: r.item, status: r.status, points: r.points, by: r.by }));
  res.json({ info: { start: sum.start, earned: sum.earned - sum.adjust, adjust: sum.adjust, total: sum.total, grade: sum.grade }, list });
}));

app.post('/api/math', auth, studentOnly, wrap(async (req, res) => {
  const S = await getSettings();
  const max = Number(S.수학최대점수);
  const v = Number(req.body.score);
  if (req.body.score === '' || req.body.score === null || !Number.isFinite(v)) throw new UserError('숫자를 입력해주세요');
  if (v < 0 || v > max) throw new UserError(`0~${max} 사이 점수를 넣어주세요`);
  const ref = db.collection('students').doc(req.user.id);
  const old = (await ref.get()).data().math;
  await ref.update({ math: v });
  await db.collection('mathLog').add({ studentId: req.user.id, before: old === undefined ? null : old, after: v, at: Timestamp.now() });
  res.json({ ok: true, grade: mathGrade(v, S) });
}));

// ======================================================================
//  상점
// ======================================================================
const isRentItem = (it) => it.category === '세금' && String(it.name).includes('월세');
const taxKind = (it) => (isRentItem(it) ? '월세' : String(it.name).includes('전기') ? '전기세' : /건강|보험/.test(it.name) ? '건강보험료' : '기타수입');
const remainingOf = (it) => (it.stock === null || it.stock === undefined ? null : Math.max(0, it.stock - Math.max(0, (it.sold || 0) - (it.baseline || 0))));

async function shopView(studentId) {
  const S = await getSettings();
  const now = new Date();
  const cycle = cycleOf(now, startDayOf(S));
  const today = dayStr(now);
  const [itemsSnap, cycleSnap, todaySnap, studentsSnap] = await Promise.all([
    db.collection('shopItems').get(),
    db.collection('sales').where('cycle', '==', cycle).get(),
    db.collection('sales').where('day', '==', today).where('studentId', '==', studentId).get(),
    db.collection('students').get(),
  ]);
  const me = studentsSnap.docs.find((d) => d.id === studentId);
  if (!me) throw new UserError('학생을 찾을 수 없어요');
  const balance = me.data().balance || 0;
  const rentExempt = !!(me.data().seat && me.data().seatPaid);
  const paidBy = {}; // 상품별로 이번 주기에 낸 학생들
  cycleSnap.docs.forEach((d) => { const x = d.data(); (paidBy[x.itemId] = paidBy[x.itemId] || new Set()).add(x.studentId); });
  const myToday = {};
  todaySnap.docs.forEach((d) => { const x = d.data(); myToday[x.itemId] = (myToday[x.itemId] || 0) + 1; });

  const items = itemsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((it) => it.active !== false)
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((it) => {
      const rent = isRentItem(it);
      const price = rent ? Number(S.월세) : it.price;
      const remaining = remainingOf(it);
      const paid = !!(paidBy[it.id] && paidBy[it.id].has(studentId));
      let blocked = '';
      if (it.category === '세금') { if (paid) blocked = '납부 완료'; }
      else if (remaining === 0) blocked = '품절';
      else if (it.limit !== null && it.limit !== undefined && (myToday[it.id] || 0) >= it.limit) blocked = '한도 도달';
      else if (S.빚이면구매금지 === 'Y' && balance < 0) blocked = '빚 먼저';
      else if (balance < price) blocked = '행복 부족';
      return {
        id: it.id, category: it.category, name: it.name, desc: it.desc || '', price, isRent: rent,
        remaining, limit: it.limit ?? null, myToday: myToday[it.id] || 0, paid,
        paidCount: paidBy[it.id] ? paidBy[it.id].size : 0, studentCount: studentsSnap.size, blocked,
        exempt: rent && rentExempt,
      };
    })
    .filter((it) => !it.exempt); // 자리를 산 학생에게는 월세가 보이지 않아요
  const range = cycleRange(startDayOf(S));
  return { items, balance, currency: S.화폐단위, cycleRange: `${range.start} ~ ${range.end}`, rentExempt, debtBlocks: S.빚이면구매금지 === 'Y' };
}

app.get('/api/shop', auth, wrap(async (req, res) => {
  res.json(await shopView(targetId(req)));
}));

app.post('/api/buy', auth, studentOnly, wrap(async (req, res) => {
  const { itemId } = req.body;
  const txId = String(req.body.txId || newId('B'));
  const sid = req.user.id;
  const S = await getSettings();
  const now = new Date();
  const cycle = cycleOf(now, startDayOf(S));
  const today = dayStr(now);

  const result = await db.runTransaction(async (t) => {
    const iRef = db.collection('shopItems').doc(String(itemId));
    const [iDoc, dup, todayQ, cycleQ] = await Promise.all([
      t.get(iRef),
      t.get(db.collection('ledger').doc(txId)),
      t.get(db.collection('sales').where('studentId', '==', sid).where('itemId', '==', String(itemId)).where('day', '==', today)),
      t.get(db.collection('sales').where('studentId', '==', sid).where('itemId', '==', String(itemId)).where('cycle', '==', cycle)),
    ]);
    const students = await loadStudents(t, [sid]);
    if (dup.exists) return { duplicate: true, balance: students.get(sid).balance };
    if (!iDoc.exists || iDoc.data().active === false) throw new UserError('지금은 살 수 없는 항목이에요');
    const it = { id: iDoc.id, ...iDoc.data() };
    const me = students.get(sid);
    const isTax = it.category === '세금';
    const rent = isRentItem(it);
    const price = rent ? Number(S.월세) : it.price;
    if (rent && me.data.seat && me.data.seatPaid) throw new UserError('자리를 사서 월세가 면제예요');
    if (price <= 0) throw new UserError('금액이 정해지지 않았어요');
    if (isTax) {
      if (!cycleQ.empty) throw new UserError('이번 달은 이미 납부했어요');
    } else {
      if (remainingOf(it) === 0) throw new UserError('이미 품절됐어요');
      if (it.limit !== null && it.limit !== undefined && todayQ.size >= it.limit)
        throw new UserError(`이 물건은 하루에 ${it.limit}개까지만 살 수 있어요. 내일 0시가 지나면 또 살 수 있어요`);
      if (S.빚이면구매금지 === 'Y' && me.balance < 0) throw new UserError('빚이 있어요. 먼저 갚아야 물건을 살 수 있어요');
    }
    const at = Timestamp.fromDate(now);
    const after = stageEntry(t, students, {
      txId, studentId: sid, kind: isTax ? '세금' : '구매', amount: -price, reason: it.name, memo: it.id, by: sid,
      allowNegative: isTax && S.빚허용 === 'Y', failMsg: '행복이 부족해요',
    }, at);
    // 상점에서 나간 돈은 전액 국고로
    stageTreasury(t, `${txId}:T`, { kind: isTax ? taxKind(it) : '상점수입', amount: price, reason: it.name, studentId: sid, by: sid }, at);
    t.set(db.collection('sales').doc(txId), { itemId: it.id, studentId: sid, price, day: today, cycle, at });
    t.update(iRef, { sold: (it.sold || 0) + 1 });
    return { balance: after, debt: after < 0, name: it.name };
  });
  if (result.duplicate) return res.json({ ok: true, duplicate: true, message: '이미 처리된 거래예요', balance: result.balance });
  res.json({
    ok: true, balance: result.balance,
    message: result.debt ? `납부했어요. 지금은 빚 ${Math.abs(result.balance).toLocaleString()} 상태예요` : `완료! 남은 행복 ${result.balance.toLocaleString()}`,
  });
}));

// ----------------------------------------------------------------------
//  상점 관리 (선생님 + 상점관리 직업)
// ----------------------------------------------------------------------
function itemFields(b) {
  if (!CATEGORIES.includes(b.category)) throw new UserError('카테고리를 골라주세요');
  const name = String(b.name || '').trim();
  if (!name) throw new UserError('상품 이름을 적어주세요');
  const price = Number(b.price);
  if (b.price === '' || !Number.isFinite(price) || price < 0) throw new UserError('가격을 올바르게 넣어주세요');
  let stock = null, limit = null;
  if (b.stock !== '' && b.stock !== null && b.stock !== undefined) {
    stock = Number(b.stock);
    if (!Number.isFinite(stock) || stock < 0 || stock > 999) throw new UserError('재고는 0~999 사이여야 해요 (비우면 무제한)');
  }
  if (b.limit !== '' && b.limit !== null && b.limit !== undefined) {
    limit = Number(b.limit);
    if (!Number.isFinite(limit) || limit < 1 || limit > 99) throw new UserError('하루 1인 한도는 1~99 사이여야 해요 (비우면 무제한)');
  }
  return { category: b.category, name, price: Math.round(price), desc: String(b.desc || '').trim(), stock: stock === null ? null : Math.round(stock), limit: limit === null ? null : Math.round(limit) };
}

app.get('/api/admin/shop', guard('상점관리'), wrap(async (req, res) => {
  const S = await getSettings();
  const cycle = cycleOf(new Date(), startDayOf(S));
  const [itemsSnap, cycleSnap, studentsSnap] = await Promise.all([
    db.collection('shopItems').get(), db.collection('sales').where('cycle', '==', cycle).get(), db.collection('students').get(),
  ]);
  const exempt = new Set(studentsSnap.docs.filter((d) => d.data().seat && d.data().seatPaid).map((d) => d.id));
  const allIds = studentsSnap.docs.map((d) => d.id);
  const paidBy = {};
  cycleSnap.docs.forEach((d) => { const x = d.data(); (paidBy[x.itemId] = paidBy[x.itemId] || new Set()).add(x.studentId); });
  const list = itemsSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 0) - (b.order || 0)).map((it) => {
    const rent = isRentItem(it);
    let tax = null;
    if (it.category === '세금') {
      const target = rent ? allIds.filter((id) => !exempt.has(id)) : allIds;
      const paid = paidBy[it.id] || new Set();
      tax = { paid: target.filter((id) => paid.has(id)).length, target: target.length, exempt: allIds.length - target.length };
    }
    return {
      id: it.id, category: it.category, name: it.name, price: rent ? Number(S.월세) : it.price, desc: it.desc || '', active: it.active !== false,
      stock: it.stock ?? null, limit: it.limit ?? null, sold: Math.max(0, (it.sold || 0) - (it.baseline || 0)), totalSold: it.sold || 0,
      remaining: remainingOf(it), isRent: rent, tax,
    };
  });
  const range = cycleRange(startDayOf(S));
  res.json({ items: list, currency: S.화폐단위, categories: CATEGORIES, cycleRange: `${range.start} ~ ${range.end}` });
}));

app.post('/api/admin/shop/item', guard('상점관리'), wrap(async (req, res) => {
  const f = itemFields(req.body);
  await db.collection('shopItems').add({ ...f, active: true, baseline: 0, sold: 0, order: Date.now() });
  res.json({ ok: true, message: `"${f.name}" 상품을 추가했어요` });
}));
app.put('/api/admin/shop/item/:id', guard('상점관리'), wrap(async (req, res) => {
  const f = itemFields(req.body);
  const ref = db.collection('shopItems').doc(req.params.id);
  if (!(await ref.get()).exists) throw new UserError('그런 상품이 없어요');
  await ref.update(f);
  res.json({ ok: true, message: `"${f.name}" 상품을 고쳤어요` });
}));
app.post('/api/admin/shop/item/:id/active', guard('상점관리'), wrap(async (req, res) => {
  const ref = db.collection('shopItems').doc(req.params.id);
  if (!(await ref.get()).exists) throw new UserError('그런 상품이 없어요');
  await ref.update({ active: !!req.body.active });
  res.json({ ok: true, message: req.body.active ? '다시 보이게 했어요' : '학생 화면에서 숨겼어요' });
}));
app.delete('/api/admin/shop/item/:id', guard('상점관리'), wrap(async (req, res) => {
  await db.collection('shopItems').doc(req.params.id).delete(); // 지난 거래 내역은 그대로 남아요
  res.json({ ok: true, message: '상품을 지웠어요' });
}));
// 재고 새로 채우기: 남은 수량을 n개로 맞추고, 지금까지 판 수는 기준선으로 (지난 판매 기록은 그대로)
app.post('/api/admin/shop/item/:id/restock', guard('상점관리'), wrap(async (req, res) => {
  const n = toInt(req.body.stock, '재고를 숫자로 적어 주세요');
  if (n < 0 || n > 999) throw new UserError('재고는 0~999 사이여야 해요');
  const ref = db.collection('shopItems').doc(req.params.id);
  await db.runTransaction(async (t) => {
    const d = await t.get(ref);
    if (!d.exists) throw new UserError('그런 상품이 없어요');
    t.update(ref, { stock: n, baseline: d.data().sold || 0 });
  });
  res.json({ ok: true, message: `재고를 ${n}개로 새로 채웠어요` });
}));
// 재고 수정: 총 재고 숫자만 바꿈 (비우면 무제한)
app.post('/api/admin/shop/item/:id/stock', guard('상점관리'), wrap(async (req, res) => {
  let n = null;
  if (req.body.stock !== '' && req.body.stock !== null && req.body.stock !== undefined) {
    n = toInt(req.body.stock);
    if (n < 0 || n > 999) throw new UserError('재고는 0~999 사이여야 해요');
  }
  await db.collection('shopItems').doc(req.params.id).update({ stock: n });
  res.json({ ok: true, message: '재고를 저장했어요' });
}));

// ======================================================================
//  공동구매 (저금통)
// ======================================================================
async function minJoin(goal, S) {
  return goal.min === null || goal.min === undefined ? Number(S.공동구매최소금액) : goal.min;
}

app.get('/api/groups', auth, wrap(async (req, res) => {
  const id = targetId(req);
  const S = await getSettings();
  const [goalsSnap, joinsSnap, me] = await Promise.all([
    db.collection('groupGoals').get(), db.collection('groupJoins').get(), db.collection('students').doc(id).get(),
  ]);
  const order = { 진행중: 0, 완료: 1, 취소됨: 2 };
  const goals = goalsSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => order[a.status] - order[b.status] || (b.createdMs || 0) - (a.createdMs || 0));
  res.json({
    currency: S.화폐단위, balance: me.exists ? me.data().balance || 0 : 0,
    goals: goals.map((g) => {
      const joins = joinsSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((j) => j.goalId === g.id && !j.cancelled);
      const mine = joins.filter((j) => j.studentId === id);
      return {
        id: g.id, title: g.title, desc: g.desc || '', target: g.target, raised: g.raised || 0, status: g.status,
        min: g.min ?? Number(S.공동구매최소금액), people: new Set(joins.map((j) => j.studentId)).size,
        mine: mine.map((j) => ({ id: j.id, amount: j.amount, at: timeStr(j.at.toDate()) })),
        mineSum: mine.reduce((s, j) => s + j.amount, 0),
      };
    }),
  });
}));

app.post('/api/groups/join', auth, studentOnly, wrap(async (req, res) => {
  const S = await getSettings();
  const txId = String(req.body.txId || newId('GJ'));
  const amount = toInt(req.body.amount, '금액을 넣어주세요');
  const sid = req.user.id;
  await db.runTransaction(async (t) => {
    const gRef = db.collection('groupGoals').doc(String(req.body.goalId));
    const [g, dup] = await Promise.all([t.get(gRef), t.get(db.collection('ledger').doc(txId))]);
    const students = await loadStudents(t, [sid]);
    if (dup.exists) return;
    if (!g.exists) throw new UserError('그런 목표가 없어요');
    if (g.data().status !== '진행중') throw new UserError('지금은 참여할 수 없는 목표예요');
    const min = await minJoin(g.data(), S);
    if (amount < min) throw new UserError(`한 번에 최소 ${min.toLocaleString()} 이상 넣을 수 있어요`);
    const at = Timestamp.now();
    stageEntry(t, students, { txId, studentId: sid, kind: '공동구매참여', amount: -amount, reason: g.data().title, memo: g.id, by: sid }, at);
    t.set(db.collection('groupJoins').doc(txId), { goalId: g.id, studentId: sid, amount, at, cancelled: false });
    t.update(gRef, { raised: (g.data().raised || 0) + amount });
  });
  res.json({ ok: true, message: `${amount.toLocaleString()}을 함께 모았어요!` });
}));

app.post('/api/groups/cancel', auth, studentOnly, wrap(async (req, res) => {
  const sid = req.user.id;
  await db.runTransaction(async (t) => {
    const jRef = db.collection('groupJoins').doc(String(req.body.joinId));
    const j = await t.get(jRef);
    if (!j.exists) throw new UserError('참여 기록을 찾을 수 없어요');
    if (j.data().studentId !== sid) throw new UserError('내 참여가 아니에요');
    if (j.data().cancelled) throw new UserError('이미 취소된 참여예요');
    const gRef = db.collection('groupGoals').doc(j.data().goalId);
    const g = await t.get(gRef);
    if (!g.exists || g.data().status !== '진행중') throw new UserError('이미 끝난 목표라 취소할 수 없어요');
    const students = await loadStudents(t, [sid]);
    const amt = j.data().amount;
    stageEntry(t, students, { txId: `GC-${j.id}`, studentId: sid, kind: '공동구매환불', amount: amt, reason: `${g.data().title} 취소`, by: sid }, Timestamp.now());
    t.update(jRef, { cancelled: true });
    t.update(gRef, { raised: Math.max(0, (g.data().raised || 0) - amt) });
  });
  res.json({ ok: true, message: '취소했어요. 낸 돈을 돌려받았어요' });
}));

// 공동구매 관리 (선생님)
app.get('/api/admin/groups', guard('teacher'), wrap(async (req, res) => {
  const S = await getSettings();
  const [goalsSnap, joinsSnap, studentsSnap] = await Promise.all([
    db.collection('groupGoals').get(), db.collection('groupJoins').get(), db.collection('students').get(),
  ]);
  const names = {};
  studentsSnap.docs.forEach((d) => (names[d.id] = d.data().name));
  const goals = goalsSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdMs || 0) - (a.createdMs || 0));
  res.json({
    currency: S.화폐단위, defaultMin: Number(S.공동구매최소금액),
    goals: goals.map((g) => {
      const by = {};
      joinsSnap.docs.map((d) => d.data()).filter((j) => j.goalId === g.id && !j.cancelled).forEach((j) => (by[j.studentId] = (by[j.studentId] || 0) + j.amount));
      return {
        id: g.id, title: g.title, desc: g.desc || '', target: g.target, raised: g.raised || 0, status: g.status,
        min: g.min ?? Number(S.공동구매최소금액),
        people: Object.keys(by).map((id) => ({ name: names[id] || id, amount: by[id] })).sort((a, b) => b.amount - a.amount),
      };
    }),
  });
}));
app.post('/api/admin/groups', guard('teacher'), wrap(async (req, res) => {
  const S = await getSettings();
  const title = String(req.body.title || '').trim();
  if (!title) throw new UserError('제목을 적어주세요');
  const target = toInt(req.body.target, '목표 금액을 올바르게 넣어주세요');
  if (target <= 0) throw new UserError('목표 금액을 올바르게 넣어주세요');
  const min = req.body.min === '' || req.body.min == null ? Number(S.공동구매최소금액) : toInt(req.body.min);
  if (min <= 0) throw new UserError('최소 금액을 올바르게 넣어주세요');
  if (min > target) throw new UserError('최소 금액이 목표 금액보다 클 수 없어요');
  await db.collection('groupGoals').add({ title, desc: String(req.body.desc || '').trim(), target, raised: 0, status: '진행중', min, createdMs: Date.now() });
  res.json({ ok: true, message: `"${title}" 목표를 만들었어요 (최소 ${min.toLocaleString()})` });
}));
app.put('/api/admin/groups/:id', guard('teacher'), wrap(async (req, res) => {
  const ref = db.collection('groupGoals').doc(req.params.id);
  const g = await ref.get();
  if (!g.exists) throw new UserError('그런 목표가 없어요');
  if (g.data().status !== '진행중') throw new UserError('이미 끝난 목표는 고칠 수 없어요');
  const title = String(req.body.title || '').trim();
  if (!title) throw new UserError('제목을 적어주세요');
  const min = toInt(req.body.min, '최소 금액을 올바르게 넣어주세요');
  if (min <= 0) throw new UserError('최소 금액을 올바르게 넣어주세요');
  if (min > g.data().target) throw new UserError('최소 금액이 목표 금액보다 클 수 없어요');
  await ref.update({ title, desc: String(req.body.desc || '').trim(), min });
  res.json({ ok: true, message: `"${title}" 목표를 고쳤어요` });
}));
// 완료: 목표를 다 채웠을 때만. 모인 돈은 전액 국고(공동구매 수입). 국고 기록 번호가 목표마다 하나라 두 번 들어가지 않아요.
app.post('/api/admin/groups/:id/complete', guard('teacher'), wrap(async (req, res) => {
  const out = await db.runTransaction(async (t) => {
    const gRef = db.collection('groupGoals').doc(req.params.id);
    const [g, joins, tr] = await Promise.all([
      t.get(gRef), t.get(db.collection('groupJoins').where('goalId', '==', req.params.id)), t.get(db.collection('treasury').doc(`GOAL-${req.params.id}`)),
    ]);
    if (!g.exists) throw new UserError('그런 목표가 없어요');
    if (g.data().status !== '진행중') throw new UserError('이미 끝난 목표예요');
    const sum = joins.docs.map((d) => d.data()).filter((j) => !j.cancelled).reduce((s, j) => s + j.amount, 0);
    if (sum < g.data().target) throw new UserError(`아직 목표 금액을 다 모으지 못했어요 (${sum.toLocaleString()} / ${g.data().target.toLocaleString()})`);
    const at = Timestamp.now();
    if (sum > 0 && !tr.exists) stageTreasury(t, `GOAL-${req.params.id}`, { kind: '공동구매', amount: sum, reason: `공동구매 완료: ${g.data().title}`, by: '관리자' }, at);
    t.update(gRef, { status: '완료', raised: sum, doneMs: Date.now() });
    return sum;
  });
  res.json({ ok: true, message: `모금을 완료했어요! 모인 ${out.toLocaleString()}이 국고로 들어갔어요` });
}));
// 목표 취소: 낸 사람 전원에게 돌려줘요
app.post('/api/admin/groups/:id/cancel', guard('teacher'), wrap(async (req, res) => {
  const count = await db.runTransaction(async (t) => {
    const gRef = db.collection('groupGoals').doc(req.params.id);
    const [g, joins] = await Promise.all([t.get(gRef), t.get(db.collection('groupJoins').where('goalId', '==', req.params.id))]);
    if (!g.exists) throw new UserError('그런 목표가 없어요');
    if (g.data().status !== '진행중') throw new UserError('이미 끝난 목표예요');
    const live = joins.docs.filter((d) => !d.data().cancelled);
    const students = await loadStudents(t, [...new Set(live.map((d) => d.data().studentId))]);
    const at = Timestamp.now();
    live.forEach((d) => {
      stageEntry(t, students, { txId: `GX-${d.id}`, studentId: d.data().studentId, kind: '공동구매환불', amount: d.data().amount, reason: `${g.data().title} 취소(목표 취소)`, by: '관리자' }, at);
      t.update(d.ref, { cancelled: true });
    });
    t.update(gRef, { status: '취소됨', raised: 0 });
    return live.length;
  });
  res.json({ ok: true, message: count ? `목표를 취소하고 ${count}건을 환불했어요` : '목표를 취소했어요 (참여한 학생이 없었어요)' });
}));


// ======================================================================
//  은행 (예금)
//   · 가입 때 신용등급에 맞는 이자율이 정해지고, 만기일에 은행장/선생님이 지급해요
//   · 만기 전 해지는 이자 없이 원금만. 이자는 국고에서 나가요.
// ======================================================================
const DAY_MS = 864e5;
const fmtMD = (d) => { const k = kst(d).toISOString(); return `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}`; };
async function getRates() {
  const snap = await db.collection('rates').get();
  const out = {};
  snap.docs.forEach((d) => (out[d.data().days] = d.data()));
  return out;
}
function depositView(d, now) {
  const x = d.data ? { id: d.id, ...d.data() } : d;
  const maturity = x.maturity.toDate();
  const left = Math.ceil((maturity - now) / DAY_MS);
  const ended = x.status === '지급완료' || x.status === '중도해지';
  return {
    id: x.id, studentId: x.studentId, principal: x.principal, days: x.days, name: x.name, rate: x.rate,
    start: fmtMD(x.createdAt.toDate()), end: fmtMD(maturity), status: x.status, interest: x.interest || 0,
    left, matured: !ended && left <= 0, ended, expected: Math.round((x.principal * x.rate) / 100),
  };
}

app.get('/api/bank', auth, wrap(async (req, res) => {
  const id = targetId(req);
  const [S, rates, info, depSnap] = await Promise.all([
    getSettings(), getRates(), buildInfo(id), db.collection('deposits').where('studentId', '==', id).get(),
  ]);
  const max = Number(S.예금최대일수);
  const now = new Date();
  res.json({
    balance: info.balance, debt: info.debt, currency: S.화폐단위, grade: info.credit.grade, min: Number(S.예금최소금액),
    products: Object.values(rates).filter((r) => r.days <= max).sort((a, b) => a.days - b.days)
      .map((r) => ({ days: r.days, name: r.name, rate: r.rates[info.credit.grade - 1] || 0, all: r.rates })),
    deposits: depSnap.docs.map((d) => depositView(d, now)).sort((a, b) => b.start.localeCompare(a.start) || b.id.localeCompare(a.id)),
  });
}));

app.post('/api/bank/deposit', auth, studentOnly, wrap(async (req, res) => {
  const S = await getSettings();
  const principal = toInt(req.body.amount, '금액을 넣어주세요');
  const days = Number(req.body.days);
  const min = Number(S.예금최소금액);
  if (principal < min) throw new UserError(`최소 ${min.toLocaleString()} 이상 맡길 수 있어요`);
  const rates = await getRates();
  const product = rates[days];
  if (!product || days > Number(S.예금최대일수)) throw new UserError('없는 예금 기간이에요');
  const sid = req.user.id;
  const grade = creditSummary(await creditRows(sid), S).grade;
  const rate = product.rates[grade - 1] || 0;
  const txId = String(req.body.txId || newId('D'));
  const now = new Date();
  const out = await db.runTransaction(async (t) => {
    const dup = await t.get(db.collection('ledger').doc(txId));
    const students = await loadStudents(t, [sid]);
    if (dup.exists) return { duplicate: true };
    stageEntry(t, students, { txId, studentId: sid, kind: '예금', amount: -principal, reason: `${product.name} 예금 (이자율 ${rate}%)`, by: sid }, Timestamp.fromDate(now));
    t.set(db.collection('deposits').doc('D-' + txId), {
      studentId: sid, principal, days, name: product.name, rate, createdAt: Timestamp.fromDate(now),
      maturity: Timestamp.fromDate(new Date(now.getTime() + days * DAY_MS)), status: '예치중', interest: 0,
    });
    return { duplicate: false };
  });
  if (out.duplicate) return res.json({ ok: true, message: '이미 처리된 거래예요' });
  res.json({ ok: true, message: `${principal.toLocaleString()}을 ${product.name} 맡겼어요. 이자율 ${rate}%` });
}));

// 중도 해지: 이자 없이 원금만
async function cancelDeposit(depositId, who, onlyStudentId) {
  await db.runTransaction(async (t) => {
    const ref = db.collection('deposits').doc(String(depositId));
    const d = await t.get(ref);
    if (!d.exists) throw new UserError('예금을 찾을 수 없어요');
    const x = d.data();
    if (x.status === '지급완료') throw new UserError('이미 지급된 예금이에요');
    if (x.status === '중도해지') throw new UserError('이미 해지된 예금이에요');
    if (onlyStudentId && x.studentId !== onlyStudentId) throw new UserError('내 예금만 해지할 수 있어요');
    const students = await loadStudents(t, [x.studentId]);
    const at = Timestamp.now();
    stageEntry(t, students, { txId: `DC-${d.id}`, studentId: x.studentId, kind: '예금해지', amount: x.principal, reason: `${x.name} 예금 중도해지 (이자 없음)`, by: who }, at);
    t.update(ref, { status: '중도해지', interest: 0, doneAt: at, doneBy: who });
    return x.principal;
  });
}
app.post('/api/bank/cancel', auth, studentOnly, wrap(async (req, res) => {
  await cancelDeposit(req.body.depositId, req.user.id, req.user.id);
  res.json({ ok: true, message: '중도해지했어요. 원금만 돌려받았어요 (이자 없음)' });
}));

app.get('/api/admin/bank', guard('은행관리'), wrap(async (req, res) => {
  const [S, rates, depSnap, sSnap, tSnap] = await Promise.all([
    getSettings(), getRates(), db.collection('deposits').get(), db.collection('students').get(), db.collection('treasury').get(),
  ]);
  const names = {};
  sSnap.docs.forEach((d) => (names[d.id] = d.data().name));
  const now = new Date();
  const all = depSnap.docs.map((d) => ({ ...depositView(d, now), name2: names[d.data().studentId] || d.data().studentId }));
  const view = (x) => ({ ...x, who: x.name2 });
  const active = all.filter((x) => !x.ended);
  res.json({
    currency: S.화폐단위,
    matured: active.filter((x) => x.matured).map(view),
    holding: active.filter((x) => !x.matured).sort((a, b) => a.left - b.left).map(view),
    past: all.filter((x) => x.ended).slice(-15).reverse().map(view),
    total: active.reduce((s, x) => s + x.principal, 0),
    treasury: tSnap.docs.reduce((s, d) => s + (d.data().amount || 0), 0),
    rates: Object.values(rates).sort((a, b) => a.days - b.days),
  });
}));
app.post('/api/admin/bank/payout', guard('은행관리'), wrap(async (req, res) => {
  const who = req.user.role === 'teacher' ? '관리자' : req.user.id;
  const msg = await db.runTransaction(async (t) => {
    const ref = db.collection('deposits').doc(String(req.body.depositId));
    const d = await t.get(ref);
    if (!d.exists) throw new UserError('예금을 찾을 수 없어요');
    const x = d.data();
    if (x.status === '지급완료') throw new UserError('이미 지급된 예금이에요');
    if (x.status === '중도해지') throw new UserError('이미 해지된 예금이에요');
    if (x.maturity.toDate() > new Date()) throw new UserError('아직 만기가 안 됐어요');
    const interest = Math.round((x.principal * x.rate) / 100);
    const students = await loadStudents(t, [x.studentId]);
    const at = Timestamp.now();
    stageEntry(t, students, { txId: `DP-${d.id}`, studentId: x.studentId, kind: '예금만기', amount: x.principal + interest, reason: `${x.name} 예금 원금+이자`, by: who }, at);
    if (interest) stageTreasury(t, `DP-${d.id}:T`, { kind: '은행이자', amount: -interest, reason: `예금 이자 (${students.get(x.studentId).name})`, studentId: x.studentId, by: who }, at);
    t.update(ref, { status: '지급완료', interest, doneAt: at, doneBy: who });
    return `원금 ${x.principal.toLocaleString()} + 이자 ${interest.toLocaleString()} 지급 완료`;
  });
  res.json({ ok: true, message: msg });
}));
app.post('/api/admin/bank/cancel', guard('은행관리'), wrap(async (req, res) => {
  await cancelDeposit(req.body.depositId, req.user.role === 'teacher' ? '관리자' : req.user.id, null);
  res.json({ ok: true, message: '중도해지했어요. 원금만 돌려줬어요 (이자 없음)' });
}));
app.post('/api/admin/bank/rates', guard('은행관리'), wrap(async (req, res) => {
  const nums = (req.body.rates || []).map(Number);
  if (nums.length !== 5 || nums.some((n) => !Number.isFinite(n) || n < 0 || n > 50)) throw new UserError('0~50 사이 숫자 5개를 넣어주세요');
  const ref = db.collection('rates').doc(String(req.body.days));
  if (!(await ref.get()).exists) throw new UserError('그런 기간이 없어요');
  await ref.update({ rates: nums });
  res.json({ ok: true, message: '이자율을 바꿨어요' });
}));


// ======================================================================
//  직업소
// ======================================================================
app.get('/api/jobs', auth, wrap(async (req, res) => {
  const id = targetId(req);
  const [S, jobs, info, sSnap] = await Promise.all([getSettings(), getJobs(), buildInfo(id), db.collection('students').get()]);
  const count = {};
  sSnap.docs.forEach((d) => { const j = d.data().jobId; if (j) count[j] = (count[j] || 0) + 1; });
  res.json(Object.values(jobs).sort((a, b) => (a.order || 0) - (b.order || 0)).map((j) => {
    const creditOk = info.credit.grade <= j.minCredit;
    const mathOk = info.mathGrade === null ? false : info.mathGrade <= j.minMath;
    const filled = count[j.id] || 0;
    return {
      id: j.id, name: j.name, salary: j.salary, net: netPay(j.salary, S), minCredit: j.minCredit, minMath: j.minMath, desc: j.desc,
      capacity: j.capacity, count: filled, open: j.capacity ? filled < j.capacity : true, source: j.source,
      eligible: creditOk && mathOk, mine: info.job ? info.job.id === j.id : false,
    };
  }));
}));

app.get('/api/admin/assign', guard('teacher'), wrap(async (req, res) => {
  const [S, jobs, sSnap, cSnap] = await Promise.all([getSettings(), getJobs(), db.collection('students').get(), db.collection('credits').get()]);
  const by = {};
  cSnap.docs.forEach((d) => { const x = d.data(); (by[x.studentId] = by[x.studentId] || []).push(x); });
  const students = sSnap.docs.map((d) => ({
    id: d.id, name: d.data().name, jobId: d.data().jobId || '',
    creditGrade: creditSummary(by[d.id] || [], S).grade, mathGrade: mathGrade(d.data().math, S),
  })).sort((a, b) => Number(a.id) - Number(b.id));
  res.json({
    students,
    jobs: Object.values(jobs).sort((a, b) => (a.order || 0) - (b.order || 0)).map((j) => ({
      id: j.id, name: j.name, salary: j.salary, minCredit: j.minCredit, minMath: j.minMath, capacity: j.capacity,
      assigned: students.filter((s) => s.jobId === j.id).map((s) => s.id),
    })),
  });
}));
// 한 직업에 학생들을 한꺼번에 배정: 체크한 학생은 이 직업으로, 체크 풀린 기존 담당자는 직업 없음으로
app.post('/api/admin/jobs/:id/assign', guard('teacher'), wrap(async (req, res) => {
  const jobs = await getJobs();
  const job = jobs[req.params.id];
  if (!job) throw new UserError('그런 직업이 없어요');
  const ids = uniqIds(req.body.ids);
  if (job.capacity && ids.length > job.capacity) throw new UserError(`${job.name}은(는) 정원 ${job.capacity}명까지예요`);
  const sSnap = await db.collection('students').get();
  const valid = new Set(sSnap.docs.map((d) => d.id));
  const batch = db.batch();
  sSnap.docs.forEach((d) => {
    const mine = ids.includes(d.id) && valid.has(d.id);
    if (mine && d.data().jobId !== job.id) batch.update(d.ref, { jobId: job.id });
    else if (!mine && d.data().jobId === job.id) batch.update(d.ref, { jobId: '' });
  });
  await batch.commit();
  res.json({ ok: true, message: `${job.name} 배정을 저장했어요 (${ids.length}명)` });
}));
app.post('/api/admin/jobs/clear', guard('teacher'), wrap(async (req, res) => {
  const sSnap = await db.collection('students').get();
  const batch = db.batch();
  sSnap.docs.forEach((d) => { if (d.data().jobId) batch.update(d.ref, { jobId: '' }); });
  await batch.commit();
  res.json({ ok: true, message: '모든 학생의 직업을 비웠어요' });
}));

// ======================================================================
//  선생님 모드 — 기본정보 (학생 관리 · 월급 · 조정)
// ======================================================================
app.get('/api/admin/students', guard('teacher'), wrap(async (req, res) => {
  const [S, jobs, sSnap, cSnap] = await Promise.all([
    getSettings(), getJobs(), db.collection('students').get(), db.collection('credits').get(),
  ]);
  const byStudent = {};
  cSnap.docs.forEach((d) => { const x = d.data(); (byStudent[x.studentId] = byStudent[x.studentId] || []).push(x); });
  const students = sSnap.docs.map((d) => {
    const s = d.data();
    const c = creditSummary(byStudent[d.id] || [], S);
    const job = jobs[s.jobId];
    return {
      id: d.id, name: s.name, balance: s.balance || 0, debt: (s.balance || 0) < 0,
      creditGrade: c.grade, creditTotal: c.total, submitted: c.submitted, missed: c.missed, adjust: c.adjust,
      math: s.math === undefined ? null : s.math, mathGrade: mathGrade(s.math, S),
      jobId: s.jobId || '', job: job ? job.name : '', seat: s.seat || '', seatPaid: !!s.seatPaid,
    };
  }).sort((a, b) => Number(a.id) - Number(b.id));
  const tSnap = await db.collection('treasury').get();
  const treasury = tSnap.docs.reduce((sum, d) => sum + (d.data().amount || 0), 0);
  res.json({
    students, currency: S.화폐단위, treasury, taxRate: Number(S.소득세율),
    jobs: Object.values(jobs).sort((a, b) => (a.order || 0) - (b.order || 0)).map((j) => ({ id: j.id, name: j.name, salary: j.salary, capacity: j.capacity, source: j.source, count: sSnap.docs.filter((d) => d.data().jobId === j.id).length })),
  });
}));

// 명단 등록: 한 줄에 한 명, 줄 순서가 번호. 이미 있는 번호는 건드리지 않아요. 처음 비밀번호는 1111.
app.post('/api/admin/students/seed', guard('teacher'), wrap(async (req, res) => {
  const names = (req.body.names || []).map((n) => String(n).trim()).filter(Boolean);
  if (!names.length) throw new UserError('이름을 한 줄에 한 명씩 적어 주세요');
  const refs = names.map((_, n) => db.collection('students').doc(String(n + 1)));
  const docs = await Promise.all(refs.map((r) => r.get()));
  const batch = db.batch();
  let created = 0;
  docs.forEach((d, n) => {
    if (d.exists) return;
    batch.set(refs[n], { name: names[n], balance: 0, jobId: '', math: null, seat: '', seatPaid: false, pinHash: hashPin(DEFAULT_PIN) });
    created++;
  });
  await batch.commit();
  res.json({ ok: true, message: `${created}명을 등록했어요 (처음 비밀번호 ${DEFAULT_PIN})` });
}));
app.post('/api/admin/students/:id/rename', guard('teacher'), wrap(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw new UserError('이름을 적어주세요');
  await db.collection('students').doc(req.params.id).update({ name });
  res.json({ ok: true, message: '이름을 고쳤어요' });
}));
app.post('/api/admin/students/:id/resetpin', guard('teacher'), wrap(async (req, res) => {
  await db.collection('students').doc(req.params.id).update({ pinHash: hashPin(DEFAULT_PIN) });
  res.json({ ok: true, message: `비밀번호를 ${DEFAULT_PIN}로 되돌렸어요` });
}));
app.post('/api/admin/students/:id/math', guard('teacher'), wrap(async (req, res) => {
  const v = req.body.score === '' || req.body.score === null ? null : Number(req.body.score);
  if (v !== null && !Number.isFinite(v)) throw new UserError('숫자를 넣어주세요');
  await db.collection('students').doc(req.params.id).update({ math: v });
  res.json({ ok: true, message: '수학 점수를 저장했어요' });
}));
// 자리: 이 단계에서는 "몇 줄-몇 번" 표시와 "돈 냄(월세 면제)"만 직접 지정해요
app.post('/api/admin/students/:id/seat', guard('teacher'), wrap(async (req, res) => {
  await db.collection('students').doc(req.params.id).update({ seat: String(req.body.seat || '').trim(), seatPaid: !!req.body.paid });
  res.json({ ok: true, message: '자리를 저장했어요' });
}));
// 직업 배정 (정원 확인)
app.post('/api/admin/students/:id/job', guard('teacher'), wrap(async (req, res) => {
  const jobs = await getJobs();
  const jobId = String(req.body.jobId || '');
  if (jobId) {
    const job = jobs[jobId];
    if (!job) throw new UserError('그런 직업이 없어요');
    const cur = await db.collection('students').doc(req.params.id).get();
    if (job.capacity && cur.data().jobId !== jobId) {
      const filled = await db.collection('students').where('jobId', '==', jobId).get();
      if (filled.size >= job.capacity) throw new UserError(`${job.name}은(는) 정원 ${job.capacity}명이 이미 찼어요`);
    }
  }
  await db.collection('students').doc(req.params.id).update({ jobId });
  res.json({ ok: true, message: jobId ? `${jobs[jobId].name}(으)로 배정했어요` : '직업을 비웠어요' });
}));

// 월급 지급: 직업이 있는 모든 학생. 월급 → 소득세(원천징수) → 국고. 국고 재원 직업은 국고에서 월급이 나가요.
app.post('/api/admin/payroll', guard('teacher'), wrap(async (req, res) => {
  const batchId = String(req.body.batchId || newId('PAY'));
  const [S, jobs, sSnap] = await Promise.all([getSettings(), getJobs(), db.collection('students').get()]);
  const month = `${kst(new Date()).getUTCFullYear()}년 ${kst(new Date()).getUTCMonth() + 1}월`;
  const rate = Number(S.소득세율);
  const entries = [], treasury = [];
  let govPay = 0, taxSum = 0, people = 0;
  sSnap.docs.forEach((d) => {
    const job = jobs[d.data().jobId];
    if (!job || job.salary <= 0) return;
    const tax = Math.round((job.salary * rate) / 100);
    entries.push({ studentId: d.id, kind: '월급', amount: job.salary, reason: `${month} ${job.name}`, by: '관리자', allowNegative: true });
    if (tax > 0) entries.push({ studentId: d.id, kind: '소득세', amount: -tax, reason: `${month} 소득세 ${rate}%`, by: '관리자', allowNegative: true });
    taxSum += tax; people++;
    if (job.source === '국고') govPay += job.salary;
  });
  if (!entries.length) throw new UserError('직업이 배정된 학생이 없어요');
  if (govPay > 0) treasury.push({ kind: '공무원월급', amount: -govPay, reason: `${month} 공무원 급여`, by: '관리자' });
  if (taxSum > 0) treasury.push({ kind: '소득세', amount: taxSum, reason: `${month} 소득세 원천징수`, by: '관리자' });
  const r = await runBatch(batchId, entries, treasury);
  if (r.duplicate) return res.json({ ok: true, message: '이미 지급된 건이에요 (두 번 지급되지 않았어요)' });
  res.json({ ok: true, message: `${people}명에게 지급했어요. 소득세 ${taxSum.toLocaleString()}이 국고로 들어왔어요` });
}));

// 행복 지급/삭감 (여러 명). fromTreasury면 국고에서 나가거나 들어가요.
app.post('/api/admin/happy', guard('teacher'), wrap(async (req, res) => {
  const ids = uniqIds(req.body.ids);
  const amount = toInt(req.body.amount, '0이 아닌 금액을 넣어주세요');
  if (!amount) throw new UserError('0이 아닌 금액을 넣어주세요');
  if (!ids.length) throw new UserError('학생을 선택해주세요');
  const batchId = String(req.body.batchId || newId('ADJ'));
  const reason = String(req.body.reason || '').trim() || '선생님 조정';
  const entries = ids.map((id) => ({ studentId: id, kind: amount >= 0 ? '지급' : '삭감', amount, reason, by: '관리자', allowNegative: true }));
  const treasury = req.body.fromTreasury ? [{ kind: amount >= 0 ? '보너스' : '기타수입', amount: -(amount * ids.length), reason, by: '관리자' }] : [];
  const r = await runBatch(batchId, entries, treasury);
  if (r.duplicate) return res.json({ ok: true, message: '이미 반영된 건이에요' });
  res.json({ ok: true, message: `${ids.length}명에게 ${amount > 0 ? '+' : ''}${amount.toLocaleString()} 반영했어요` });
}));

// 신용 점수 조정
app.post('/api/admin/credit', guard('teacher'), wrap(async (req, res) => {
  const ids = uniqIds(req.body.ids);
  const pts = toInt(req.body.points, '0이 아닌 숫자를 넣어주세요');
  if (!pts) throw new UserError('0이 아닌 숫자를 넣어주세요');
  if (!ids.length) throw new UserError('학생을 선택해주세요');
  const at = Timestamp.now();
  const batch = db.batch();
  ids.forEach((id) => batch.set(db.collection('credits').doc(), { studentId: id, item: String(req.body.reason || '').trim() || '선생님 조정', status: '조정', points: pts, by: '관리자', at }));
  await batch.commit();
  res.json({ ok: true, message: `${ids.length}명에게 ${pts > 0 ? '+' : ''}${pts}점 반영했어요` });
}));

// ----------------------------------------------------------------------
//  국고
// ----------------------------------------------------------------------
app.get('/api/admin/treasury', guard('국고관리'), wrap(async (req, res) => {
  const [S, tSnap, sSnap] = await Promise.all([getSettings(), db.collection('treasury').get(), db.collection('students').get()]);
  const names = {};
  sSnap.docs.forEach((d) => (names[d.id] = d.data().name));
  const income = {}, outgo = {}, monthly = {};
  let totalIn = 0, totalOut = 0;
  const rows = tSnap.docs.map((d) => d.data()).filter((r) => r.amount);
  rows.forEach((r) => {
    const month = dayStr(r.at.toDate()).slice(0, 7);
    monthly[month] = monthly[month] || { in: 0, out: 0 };
    if (r.amount > 0) { income[r.kind] = (income[r.kind] || 0) + r.amount; totalIn += r.amount; monthly[month].in += r.amount; }
    else { outgo[r.kind] = (outgo[r.kind] || 0) - r.amount; totalOut -= r.amount; monthly[month].out -= r.amount; }
  });
  const sorted = (o) => Object.keys(o).map((k) => ({ name: k, value: o[k] })).sort((a, b) => b.value - a.value);
  res.json({
    currency: S.화폐단위, balance: totalIn - totalOut, totalIn, totalOut, income: sorted(income), outgo: sorted(outgo),
    monthly: Object.keys(monthly).sort().slice(-6).map((m) => ({ month: m, in: monthly[m].in, out: monthly[m].out })),
    recent: rows.sort((a, b) => b.at.toMillis() - a.at.toMillis()).slice(0, 30)
      .map((r) => ({ at: timeStr(r.at.toDate()), kind: r.kind, amount: r.amount, reason: r.reason, student: r.studentId ? names[r.studentId] || r.studentId : '' })),
    inKinds: TREASURY_IN, outKinds: TREASURY_OUT,
  });
}));
app.post('/api/admin/treasury/adjust', guard('teacher'), wrap(async (req, res) => {
  const amount = toInt(req.body.amount, '0이 아닌 금액을 넣어주세요');
  if (!amount) throw new UserError('0이 아닌 금액을 넣어주세요');
  const kind = [...TREASURY_IN, ...TREASURY_OUT].includes(req.body.kind) ? req.body.kind : '기타수입';
  await db.collection('treasury').doc(String(req.body.batchId || newId('TA'))).set({
    kind, amount, reason: String(req.body.reason || '').trim() || '선생님 조정', studentId: '', by: '관리자', at: Timestamp.now(),
  });
  res.json({ ok: true, message: '국고에 반영했어요' });
}));

// ----------------------------------------------------------------------
//  설정
// ----------------------------------------------------------------------
app.get('/api/admin/settings', guard('teacher'), wrap(async (req, res) => {
  res.json(await getSettings());
}));
app.post('/api/admin/settings', guard('teacher'), wrap(async (req, res) => {
  const patch = {};
  EDITABLE_SETTINGS.forEach((k) => {
    if (req.body[k] === undefined) return;
    const def = DEFAULTS[k];
    patch[k] = typeof def === 'number' ? Number(req.body[k]) : String(req.body[k]);
    if (typeof def === 'number' && !Number.isFinite(patch[k])) throw new UserError(`${k}은(는) 숫자로 적어주세요`);
  });
  if (patch.빚허용 !== undefined && !['Y', 'N'].includes(patch.빚허용)) throw new UserError('빚허용은 Y 또는 N');
  if (patch.빚이면구매금지 !== undefined && !['Y', 'N'].includes(patch.빚이면구매금지)) throw new UserError('빚이면구매금지는 Y 또는 N');
  await db.collection('meta').doc('settings').set(patch, { merge: true });
  clearCaches();
  res.json({ ok: true, message: '설정을 저장했어요' });
}));

app.get('/api/country', wrap(async (req, res) => {
  const S = await getSettings();
  res.json({ name: S.나라이름, currency: S.화폐단위 });
}));

// 서버 깨우기용
app.get('/ping', (req, res) => res.send('ok'));

const PORT = process.env.PORT || 3000;
ensureSeed()
  .catch((e) => console.error('초기 데이터 준비 실패', e))
  .finally(() => app.listen(PORT, () => console.log(`돼지공주나라 서버 시작: ${PORT}`)));
