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
app.use(express.json({ limit: '7mb' })); // 보드 사진(줄인 JPEG 최대 5장) 때문에 넉넉하게
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
  보드최대사진: 5,
  글당최대댓글: 50,
  지각벌금: 15,
  일일벌금건수: 5,
  과제최대개수: 6,
  과제미제출감점: 1,
  벌금최대금액: 500,
  통로위치: '2,4',
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
  [7, '1주', [3, 2, 2, 1, 1]], // 1주·2주 이자율은 예시값이에요. 은행 교사 모드에서 바꿔 주세요
  [14, '2주', [4, 3, 2, 1, 1]],
  [30, '1달', [15, 13, 11, 7, 5]],
];
// 이름(1주·2주·1달)에서 일수를 읽어요. 이름과 일수가 어긋나지 않게 하려고요
function daysFromName(name, fallback) {
  const t = String(name || '');
  let m = t.match(/(\d+)\s*주/); if (m) return Number(m[1]) * 7;
  m = t.match(/(\d+)\s*(개월|달)/); if (m) return Number(m[1]) * 30;
  if (/한\s*달/.test(t)) return 30;
  m = t.match(/(\d+)\s*일/); if (m) return Number(m[1]);
  return fallback;
}
// 직업별 할 일 (직업 활동 배너에 표시) — [매일, 주기적]
const SEED_TASKS = {
  '국무총리': [[], ['학급 어린이회 진행', '전교 어린이회 참석']],
  '교육부 장관': [['매일 달력 바꾸기', '지나간 급식 X 표시 하기'], []],
  '외교부 장관': [[], ['가정통신문이나 활동지 챙겨오기', '다른 반에 배달하기']],
  '환경부 장관': [['공기청정기 켜고 끄기', '등교하면 창문열기'], ['교실 대청소']],
  '국토교통부 장관': [[], ['교실 부동산 관리']],
  '국세청장': [['세금 판 관리'], ['세금 사용 관리하기(보너스 지급 등)']],
  '통계청 공무원': [[], ['숙제와 가정통신문 제출 확인']],
  '외교부 공무원': [[], ['가정통신문과 활동지 다른 반에 배달하기']],
  '환경부 공무원': [['분단 별로 청소 검사'], ['분리수거']],
  '신용등급 평가원': [[], ['신용등급 판 최신화', '신용등급 점수 기준 조정']],
  '경찰': [['지각 학생 체크', '욕설 학생 체크'], []],
  '성실 은행장': [[], ['만기된 친구들의 예금 확인하기']],
  '친절병원': [[], ['다친 친구들이 필요한 물건 제공하기', '모자란 물건 보건실 가서 채워오기']],
  '나눔 슈퍼': [['재고 확인해서 맞추기'], ['모자란 재고 채우기']],
  '우리 전자': [['패드 충전함 열고 닫기'], []],
  '아르바이트생': [[], []],
};
const JOB_PERMS = ['자리관리', '국고관리', '제출승인', '신용관리', '벌금', '은행관리', '상점관리'];
const CATEGORIES = ['세금', '간식', '쿠폰'];
const TREASURY_IN = ['소득세', '월세', '전기세', '건강보험료', '벌금', '자리판매', '상점수입', '공동구매', '기타수입'];
const TREASURY_OUT = ['공무원월급', '은행이자', '보너스', '부동산개발', '기타지출'];

// 이미 만들어진 예금 상품을 1주·2주·1달로 맞춰요 (이름에서 일수를 다시 읽고, 1달이 없으면 한 번만 추가)
async function migrateBank() {
  const mref = db.collection('meta').doc('migrations');
  const m = await mref.get();
  if (m.exists && m.data().bank3) return;
  const snap = await db.collection('rates').get();
  const have = new Set(snap.docs.map((d) => Number(d.data().days)));
  const b = db.batch();
  snap.docs.forEach((d) => {
    const x = d.data(), nd = daysFromName(x.name, Number(x.days));
    if (nd !== Number(x.days) && !have.has(nd)) { b.set(db.collection('rates').doc(String(nd)), { ...x, days: nd }); b.delete(d.ref); have.delete(Number(x.days)); have.add(nd); }
    else if (nd !== Number(x.days)) b.delete(d.ref);
  });
  if (!have.has(30)) b.set(db.collection('rates').doc('30'), { days: 30, name: '1달', rates: [15, 13, 11, 7, 5] });
  const sref = db.collection('meta').doc('settings'), sd = await sref.get();
  if (sd.exists && Number(sd.data().예금최대일수) < 30) b.set(sref, { 예금최대일수: 60 }, { merge: true });
  b.set(mref, { bank3: true }, { merge: true });
  await b.commit();
  clearCaches();
}
async function ensureSeed() {
  const rates = await db.collection('rates').limit(1).get();
  if (rates.empty) {
    const b = db.batch();
    SEED_RATES.forEach((r) => b.set(db.collection('rates').doc(String(r[0])), { days: r[0], name: r[1], rates: r[2] }));
    await b.commit();
  }
  await migrateBank();
  const jobs = await db.collection('jobs').limit(1).get();
  if (jobs.empty) {
    const b = db.batch();
    SEED_JOBS.forEach((j, i) =>
      b.set(db.collection('jobs').doc(j[0]), {
        name: j[1], salary: j[2], minCredit: j[3], minMath: j[4], desc: j[5],
        perms: j[6] ? j[6].split(',') : [], capacity: j[7], source: j[8], order: i,
        daily: (SEED_TASKS[j[1]] || [[], []])[0], periodic: (SEED_TASKS[j[1]] || [[], []])[1], reportable: j[1] === '아르바이트생',
      })
    );
    await b.commit();
  }
  // 할 일 목록이 없는 직업(예전에 만든 것·가져온 것)에는 이름이 같은 기본 할 일을 채워 줘요
  const allJobs = await db.collection('jobs').get();
  for (const d of allJobs.docs) {
    if (Array.isArray(d.data().daily)) continue;
    const t = SEED_TASKS[d.data().name] || [[], []];
    await d.ref.update({ daily: t[0], periodic: t[1], reportable: d.data().name === '아르바이트생' });
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

function makeToken(payload, hours = 12) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 1000 * 60 * 60 * hours })).toString('base64url');
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
  const user = readToken((req.headers.authorization || '').replace('Bearer ', '') || String(req.query.t || '')); // 사진 주소는 ?t= 로 확인
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
  res.json({ token: makeToken({ role: 'student', id: doc.id }, 24 * 60), role: 'student' });
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
  res.json({ role: 'student', id: req.user.id, name: d.exists ? d.data().name : '', perms: job ? job.perms || [] : [], job: job ? { id: job.id, name: job.name, desc: job.desc || '', daily: job.daily || [], periodic: job.periodic || [], reportable: !!job.reportable } : null });
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
      daily: j.daily || [], periodic: j.periodic || [],
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
// 이번 세금 주기에 아직 안 낸 학생 (월세는 자리를 산 학생 제외)
async function unpaidTaxes(S) {
  const cycle = cycleOf(new Date(), startDayOf(S));
  const [items, sales, studs] = await Promise.all([db.collection('shopItems').get(), db.collection('sales').where('cycle', '==', cycle).get(), db.collection('students').get()]);
  const paid = {};
  sales.docs.forEach((d) => { const x = d.data(); (paid[x.itemId] = paid[x.itemId] || new Set()).add(x.studentId); });
  const all = studs.docs.map((d) => ({ id: d.id, ...d.data() }));
  return items.docs.map((d) => ({ id: d.id, ...d.data() })).filter((it) => it.category === '세금' && it.active !== false).sort((a, b) => (a.order || 0) - (b.order || 0)).map((it) => {
    const target = all.filter((x) => !(isRentItem(it) && x.seat && x.seatPaid));
    const pset = paid[it.id] || new Set();
    return { name: it.name, paid: target.filter((x) => pset.has(x.id)).length, total: target.length, exempt: all.length - target.length, unpaid: target.filter((x) => !pset.has(x.id)).map((x) => x.name) };
  });
}
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
    inKinds: TREASURY_IN, outKinds: TREASURY_OUT, unpaid: await unpaidTaxes(S),
    students: sSnap.docs.map((d) => ({ id: d.id, name: d.data().name })).sort((a, b) => Number(a.id) - Number(b.id)),
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

// ======================================================================
//  우리반 보드 (글 · 사진 · 댓글 · 추천)
//   사진은 화면에서 긴 변 1000px 안팎 JPEG로 줄여 보내고, 글과 따로 boardPhotos 문서에 저장 (Firestore 문서 1MB 제한 때문)
// ======================================================================
const TEACHER_AUTHOR = '선생님';
const MAX_PHOTO_CHARS = 700000; // base64 글자 수 (약 500KB)
const boardOf = (d) => ({ id: d.id, name: d.data().name, desc: d.data().desc || '', comments: d.data().comments !== false, likes: d.data().likes !== false, active: d.data().active !== false });

async function getBoard(id) {
  const d = await db.collection('boards').doc(String(id || '')).get();
  if (!d.exists) throw new UserError('그런 보드가 없어요');
  return boardOf(d);
}
async function studentNames() {
  const snap = await db.collection('students').get();
  const names = {};
  snap.docs.forEach((d) => (names[d.id] = d.data().name));
  return names;
}
function cleanPhotos(list, S, keepCount = 0) {
  const arr = (Array.isArray(list) ? list : []).filter((p) => p && p.data);
  const max = Number(S.보드최대사진) || 5;
  if (arr.length + keepCount > max) throw new UserError(`사진은 모두 ${max}장까지 붙일 수 있어요`);
  return arr.map((p, i) => {
    const data = String(p.data).replace(/^data:image\/jpeg;base64,/, '');
    if (data.length > MAX_PHOTO_CHARS) throw new UserError(`${i + 1}번째 사진이 너무 커요`);
    if (!/^[A-Za-z0-9+/=]+$/.test(data) || !Buffer.from(data.slice(0, 8), 'base64').slice(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) throw new UserError(`${i + 1}번째 사진을 읽을 수 없어요`);
    return data;
  });
}
function cleanPost(b, hasPhoto) {
  const text = String(b.text || '').trim();
  const link = String(b.link || '').trim();
  if (!text && !link && !hasPhoto) throw new UserError('내용이나 사진, 링크 중 하나는 있어야 해요');
  if (text.length > 1000) throw new UserError('내용이 너무 길어요. 1000자까지 쓸 수 있어요');
  if (link && !/^https?:\/\//i.test(link)) throw new UserError('링크는 http로 시작해야 해요');
  return { text, link };
}
async function savePhotos(postId, datas) {
  const ids = [];
  for (const data of datas) {
    const id = newId('P');
    await db.collection('boardPhotos').doc(id).set({ postId, data, at: Timestamp.now() });
    ids.push(id);
  }
  return ids;
}
async function writePost(boardId, authorId, b, S, admin) {
  const board = await getBoard(boardId);
  if (!board.active && !admin) throw new UserError('지금은 쓸 수 없는 보드예요');
  const datas = cleanPhotos(b.photos, S);
  const { text, link } = cleanPost(b, datas.length > 0);
  const postId = newId('B');
  const photoIds = await savePhotos(postId, datas);
  await db.collection('boardPosts').doc(postId).set({ boardId: board.id, authorId, at: Timestamp.now(), text, link, photoIds, deleted: false, order: -Date.now() });
  return photoIds.length > 1 ? `사진 ${photoIds.length}장과 함께 올렸어요!` : '올렸어요!';
}

// 보드 목록 (선생님은 숨긴 보드도 보임)
app.get('/api/board', auth, wrap(async (req, res) => {
  const teacher = req.user.role === 'teacher';
  const [bs, ps] = await Promise.all([db.collection('boards').get(), db.collection('boardPosts').get()]);
  const counts = {};
  ps.docs.forEach((d) => { if (!d.data().deleted) counts[d.data().boardId] = (counts[d.data().boardId] || 0) + 1; });
  const S = await getSettings();
  const boards = bs.docs.map((d) => ({ ...boardOf(d), createdMs: d.data().createdMs || 0, count: counts[d.id] || 0 }))
    .filter((b) => teacher || b.active).sort((a, b) => a.createdMs - b.createdMs);
  res.json({ boards, maxPhotos: Number(S.보드최대사진) || 5, teacher });
}));

// 한 보드의 글 (최근 순, 40개)
app.get('/api/board/:id/posts', auth, wrap(async (req, res) => {
  const teacher = req.user.role === 'teacher';
  const me = teacher ? '' : req.user.id;
  const board = await getBoard(req.params.id);
  if (!board.active && !teacher) throw new UserError('볼 수 없는 보드예요');
  const [ps, cs, ls, names] = await Promise.all([
    db.collection('boardPosts').where('boardId', '==', board.id).get(),
    db.collection('boardComments').where('boardId', '==', board.id).get(),
    db.collection('boardLikes').where('boardId', '==', board.id).get(),
    studentNames(),
  ]);
  const nm = (id) => (id === TEACHER_AUTHOR ? TEACHER_AUTHOR : names[id] || id);
  const posts = ps.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => !p.deleted)
    .sort((a, b) => (typeof a.order === 'number' ? a.order : -a.at.toMillis()) - (typeof b.order === 'number' ? b.order : -b.at.toMillis())).slice(0, 40);
  const byPost = {};
  posts.forEach((p) => (byPost[p.id] = { likes: 0, liked: false, comments: [] }));
  ls.docs.forEach((d) => { const x = byPost[d.data().postId]; if (!x) return; x.likes++; if (d.data().studentId === me) x.liked = true; });
  cs.docs.map((d) => ({ id: d.id, ...d.data() })).filter((c) => !c.deleted).sort((a, b) => a.at.toMillis() - b.at.toMillis())
    .forEach((c) => { const x = byPost[c.postId]; if (x) x.comments.push({ id: c.id, name: nm(c.studentId), at: timeStr(c.at.toDate()), text: c.text }); });
  res.json({
    board, teacher,
    posts: posts.map((p) => ({
      id: p.id, name: nm(p.authorId), at: timeStr(p.at.toDate()), text: p.text, link: p.link, photos: p.photoIds || [],
      mine: !!me && p.authorId === me, ...byPost[p.id],
    })),
  });
}));

// 사진 파일 (<img src>가 헤더를 못 보내서 ?t=토큰으로 확인)
app.get('/api/board/photo/:id', auth, wrap(async (req, res) => {
  const d = await db.collection('boardPhotos').doc(String(req.params.id)).get();
  if (!d.exists) return res.status(404).json({ error: '사진을 찾을 수 없어요' });
  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'private, max-age=86400');
  res.send(Buffer.from(d.data().data, 'base64'));
}));

app.post('/api/board/post', auth, studentOnly, wrap(async (req, res) => {
  const S = await getSettings();
  const message = await writePost(req.body.boardId, req.user.id, req.body, S, false);
  res.json({ ok: true, message });
}));

app.post('/api/board/post/:id/edit', auth, studentOnly, wrap(async (req, res) => {
  const S = await getSettings();
  const ref = db.collection('boardPosts').doc(String(req.params.id));
  const d = await ref.get();
  if (!d.exists || d.data().deleted) throw new UserError('그 글을 찾을 수 없어요');
  if (d.data().authorId !== req.user.id) throw new UserError('내가 쓴 글만 고칠 수 있어요');
  const board = await getBoard(d.data().boardId);
  if (!board.active) throw new UserError('지금은 고칠 수 없는 보드예요');
  const old = d.data().photoIds || [];
  const keep = old.filter((id) => (Array.isArray(req.body.keep) ? req.body.keep : []).includes(id));
  const datas = cleanPhotos(req.body.photos, S, keep.length);
  const { text, link } = cleanPost(req.body, keep.length + datas.length > 0);
  const added = await savePhotos(ref.id, datas);
  await ref.update({ text, link, photoIds: keep.concat(added) });
  await Promise.all(old.filter((id) => !keep.includes(id)).map((id) => db.collection('boardPhotos').doc(id).delete()));
  res.json({ ok: true, message: '글을 고쳤어요' });
}));

app.post('/api/board/post/:id/delete', auth, studentOnly, wrap(async (req, res) => {
  const ref = db.collection('boardPosts').doc(String(req.params.id));
  const d = await ref.get();
  if (!d.exists || d.data().deleted) throw new UserError('그 글을 찾을 수 없어요');
  if (d.data().authorId !== req.user.id) throw new UserError('내가 쓴 글만 지울 수 있어요');
  await ref.update({ deleted: true });
  res.json({ ok: true, message: '글을 지웠어요' });
}));

app.post('/api/board/comment', auth, studentOnly, wrap(async (req, res) => {
  const S = await getSettings();
  const text = String(req.body.text || '').trim();
  if (!text) throw new UserError('댓글을 적어주세요');
  if (text.length > 300) throw new UserError('댓글은 300자까지 쓸 수 있어요');
  const p = await db.collection('boardPosts').doc(String(req.body.postId)).get();
  if (!p.exists || p.data().deleted) throw new UserError('그 글을 찾을 수 없어요');
  const board = await getBoard(p.data().boardId);
  if (!board.active || !board.comments) throw new UserError('이 보드는 댓글을 받지 않아요');
  const mine = await db.collection('boardComments').where('postId', '==', p.id).get();
  const max = Number(S.글당최대댓글) || 50;
  if (mine.docs.filter((d) => !d.data().deleted).length >= max) throw new UserError(`댓글이 너무 많아요 (${max}개까지)`);
  await db.collection('boardComments').doc(newId('C')).set({ postId: p.id, boardId: board.id, studentId: req.user.id, at: Timestamp.now(), text, deleted: false });
  res.json({ ok: true, message: '댓글을 달았어요' });
}));

app.post('/api/board/like', auth, studentOnly, wrap(async (req, res) => {
  const p = await db.collection('boardPosts').doc(String(req.body.postId)).get();
  if (!p.exists || p.data().deleted) throw new UserError('그 글을 찾을 수 없어요');
  const board = await getBoard(p.data().boardId);
  if (!board.active || !board.likes) throw new UserError('이 보드는 추천을 받지 않아요');
  const ref = db.collection('boardLikes').doc(`${p.id}_${req.user.id}`); // 글 하나에 한 사람 한 번 (다시 누르면 취소)
  const cancelled = await db.runTransaction(async (t) => {
    const l = await t.get(ref);
    if (l.exists) { t.delete(ref); return true; }
    t.set(ref, { postId: p.id, boardId: board.id, studentId: req.user.id, at: Timestamp.now() });
    return false;
  });
  res.json({ ok: true, message: cancelled ? '추천을 취소했어요' : '추천했어요!' });
}));

// 선생님
app.post('/api/admin/board', guard('teacher'), wrap(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw new UserError('보드 이름을 적어주세요');
  await db.collection('boards').doc(newId('BD')).set({
    name, desc: String(req.body.desc || '').trim(), comments: req.body.comments !== false, likes: req.body.likes !== false, active: true, createdMs: Date.now(),
  });
  res.json({ ok: true, message: `"${name}" 보드를 만들었어요` });
}));
app.post('/api/admin/board/:id', guard('teacher'), wrap(async (req, res) => {
  await getBoard(req.params.id);
  const b = req.body, patch = {};
  if (b.name !== undefined && String(b.name).trim()) patch.name = String(b.name).trim();
  if (b.desc !== undefined) patch.desc = String(b.desc).trim();
  ['comments', 'likes', 'active'].forEach((k) => { if (b[k] !== undefined) patch[k] = !!b[k]; });
  await db.collection('boards').doc(req.params.id).update(patch);
  res.json({ ok: true, message: '저장했어요' });
}));
app.post('/api/admin/board/:id/delete', guard('teacher'), wrap(async (req, res) => {
  const board = await getBoard(req.params.id);
  for (const c of ['boardPosts', 'boardComments', 'boardLikes']) {
    const snap = await db.collection(c).where('boardId', '==', board.id).get();
    for (const d of snap.docs) {
      if (c === 'boardPosts') await Promise.all((d.data().photoIds || []).map((id) => db.collection('boardPhotos').doc(id).delete()));
      await d.ref.delete();
    }
  }
  await db.collection('boards').doc(board.id).delete();
  res.json({ ok: true, message: `"${board.name}" 보드를 지웠어요` });
}));
app.post('/api/admin/board/:id/post', guard('teacher'), wrap(async (req, res) => {
  const S = await getSettings();
  const message = await writePost(req.params.id, TEACHER_AUTHOR, req.body, S, true);
  res.json({ ok: true, message });
}));
app.post('/api/admin/board/:id/order', guard('teacher'), wrap(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String).slice(0, 100) : [];
  if (!ids.length) throw new UserError('순서를 받지 못했어요');
  const snap = await db.collection('boardPosts').where('boardId', '==', req.params.id).get();
  const ok = new Set(snap.docs.map((d) => d.id));
  const T = Date.now(), b = db.batch();
  ids.filter((id) => ok.has(id)).forEach((id, i) => b.update(db.collection('boardPosts').doc(id), { order: -T + i }));
  await b.commit();
  res.json({ ok: true, message: '순서를 바꿨어요' });
}));
app.post('/api/admin/board/post/:id/delete', guard('teacher'), wrap(async (req, res) => {
  const ref = db.collection('boardPosts').doc(String(req.params.id));
  if (!(await ref.get()).exists) throw new UserError('그 글을 찾을 수 없어요');
  await ref.update({ deleted: true });
  res.json({ ok: true, message: '글을 숨겼어요' });
}));
app.post('/api/admin/board/comment/:id/delete', guard('teacher'), wrap(async (req, res) => {
  const ref = db.collection('boardComments').doc(String(req.params.id));
  if (!(await ref.get()).exists) throw new UserError('댓글을 찾을 수 없어요');
  await ref.update({ deleted: true });
  res.json({ ok: true, message: '댓글을 숨겼어요' });
}));


// ======================================================================
//  기존 앱(구글 시트) 데이터 가져오기 — tools/내보내기.gs 가 만든 JSON을 올립니다
//   · 거래원장·보드는 가져오지 않아요. 학생 잔액·국고는 '이월' 한 줄로 시작합니다.
//   · 같은 파일을 두 번 올려도 돈이 두 번 들어가지 않아요 (번호가 정해져 있어요)
// ======================================================================
app.post('/api/admin/import', guard('teacher'), wrap(async (req, res) => {
  const D = req.body.data;
  if (!D || !Array.isArray(D.학생)) throw new UserError('내보내기 파일이 아니에요');
  const run = req.body.run === true;
  const S = await getSettings();
  const now = new Date(), at = Timestamp.now();

  // 학생 번호: 기존 번호가 모두 숫자면 그대로, 아니면 시트 순서대로 1, 2, 3…
  const allNum = D.학생.length > 0 && D.학생.every((s) => /^[0-9]+$/.test(String(s.id)));
  const idMap = {};
  D.학생.forEach((s, i) => (idMap[String(s.id)] = allNum ? String(Number(s.id)) : String(i + 1)));
  const sid = (old) => idMap[String(old)];
  const arr = (x) => (Array.isArray(x) ? x : []);
  const iso = (v) => { const d = v ? new Date(v) : null; return d && !isNaN(d) ? Timestamp.fromDate(d) : at; };
  const num = (v) => Number(v) || 0;

  const ops = []; // [type, ref, data, merge]
  const put = (coll, id, data, merge) => ops.push(['set', db.collection(coll).doc(String(id)), data, merge]);
  const del = (coll, id) => ops.push(['del', db.collection(coll).doc(String(id))]);
  const report = {};

  // 설정
  const patch = {};
  Object.keys(D.설정 || {}).forEach((k) => {
    if (!(k in DEFAULTS)) return;
    const v = D.설정[k];
    patch[k] = typeof DEFAULTS[k] === 'number' ? Number(v) : String(v);
    if (typeof DEFAULTS[k] === 'number' && !Number.isFinite(patch[k])) delete patch[k];
  });
  if (Object.keys(patch).length) put('meta', 'settings', patch, true);
  report.설정 = Object.keys(patch).length;

  // 직업 · 상점 · 이자율 (파일에 있으면 기존 값으로 바꿔요)
  const replaceAll = async (coll, rows, make, idOf) => {
    if (!rows.length) return 0;
    const keep = new Set(rows.map(idOf));
    (await db.collection(coll).get()).docs.forEach((d) => { if (!keep.has(d.id)) del(coll, d.id); });
    rows.forEach((r, i) => put(coll, idOf(r), make(r, i), false));
    return rows.length;
  };
  const oldJobs = await getJobs();
  report.직업 = await replaceAll('jobs', arr(D.직업), (j, i) => ({
    name: j.이름, salary: num(j.월급), minCredit: num(j.최소신용) || 5, minMath: num(j.최소수학) || 5, desc: j.설명 || '',
    perms: j.권한 ? String(j.권한).split(',').map((x) => x.trim()).filter(Boolean) : [], capacity: num(j.정원), source: j.재원 === '국고' ? '국고' : '민간', order: i,
    daily: Array.isArray((oldJobs[j.id] || {}).daily) ? oldJobs[j.id].daily : (SEED_TASKS[j.이름] || [[], []])[0], periodic: Array.isArray((oldJobs[j.id] || {}).periodic) ? oldJobs[j.id].periodic : (SEED_TASKS[j.이름] || [[], []])[1],
    reportable: (oldJobs[j.id] || {}).reportable !== undefined ? !!oldJobs[j.id].reportable : j.이름 === '아르바이트생',
  }), (j) => String(j.id));
  const today = dayStr(now), cycle = cycleOf(now, startDayOf({ ...S, ...patch }));
  report.상점 = await replaceAll('shopItems', arr(D.상점), (x, i) => ({
    category: x.분류, name: x.이름, price: num(x.가격), desc: x.설명 || '', active: x.활성 !== false,
    stock: x.남은재고 === null || x.남은재고 === undefined ? null : num(x.남은재고), limit: x.한도 === null || x.한도 === undefined ? null : num(x.한도),
    baseline: 0, sold: 0, order: i,
  }), (x) => String(x.id));
  const rateRows = arr(D.이자율).map((r) => ({ ...r, 일수: daysFromName(r.이름, num(r.일수)) })).filter((r) => r.일수 > 0);
  report.이자율 = await replaceAll('rates', rateRows, (r) => ({ days: r.일수, name: r.이름, rates: arr(r.이율).map(num) }), (r) => String(r.일수));
  clearCaches();

  // 이번 세금 주기에 낸 학생 · 오늘 산 개수 (다시 내거나 한도를 넘기지 않도록)
  let salesN = 0;
  arr(D.상점).forEach((x) => {
    arr(x.이번주기납부).forEach((old) => { if (sid(old)) { put('sales', `IMP-${x.id}-${sid(old)}-c`, { itemId: String(x.id), studentId: sid(old), price: num(x.가격), day: '', cycle, at, imported: true }, false); salesN++; } });
    Object.keys(x.오늘구매 || {}).forEach((old) => { if (!sid(old)) return; for (let k = 0; k < num(x.오늘구매[old]); k++) put('sales', `IMP-${x.id}-${sid(old)}-t${k}`, { itemId: String(x.id), studentId: sid(old), price: num(x.가격), day: today, cycle: 'import-' + today, at, imported: true }, false); });
  });
  report.납부기록 = salesN;

  // 학생 (새 학생은 비밀번호 1111, 이미 있는 학생은 비밀번호·잔액을 건드리지 않아요)
  const existing = new Map((await db.collection('students').get()).docs.map((d) => [d.id, d.data()]));
  const seatOf = {};
  arr(D.자리).forEach((s) => {
    const stu = sid(s.학생ID) || '';
    if (stu) seatOf[stu] = { seat: `${s.줄}-${s.칸}`, paid: !!s.납부 };
    if (num(s.줄) > 0 && num(s.칸) > 0) put('seats', `P${num(s.줄)}-${num(s.칸)}`, { row: num(s.줄), col: num(s.칸), price: num(s.가격), forSale: s.판매중 !== false, studentId: stu, paid: !!s.납부 && !!stu }, false);
  });
  report.자리 = arr(D.자리).length;
  if (arr(D.자리).length) {
    const keepSeat = new Set(arr(D.자리).filter((x) => num(x.줄) > 0 && num(x.칸) > 0).map((x) => `P${num(x.줄)}-${num(x.칸)}`));
    (await db.collection('seats').get()).docs.forEach((d) => { if (!keepSeat.has(d.id)) del('seats', d.id); });
  }
  let moved = 0, sumBal = 0;
  D.학생.forEach((s) => {
    const id = sid(s.id), bal = Math.round(num((D.잔액 || {})[String(s.id)]));
    const base = { name: s.이름, jobId: s.직업ID || '', math: s.수학 === null || s.수학 === undefined ? null : num(s.수학), seat: (seatOf[id] || {}).seat || '', seatPaid: !!(seatOf[id] || {}).paid };
    if (existing.has(id)) { put('students', id, base, true); return; }
    put('students', id, { ...base, balance: bal, pinHash: hashPin(DEFAULT_PIN) }, false);
    if (bal !== 0) {
      put('ledger', `IMPORT-OPEN-${id}`, { studentId: id, kind: '이월', amount: bal, reason: '기존 앱에서 옮겨온 잔액', memo: '', by: '관리자', balanceAfter: bal, at }, false);
      moved++; sumBal += bal;
    }
  });
  if (arr(D.자리).length) { const inFile = new Set(D.학생.map((x) => sid(x.id))); existing.forEach((v, id) => { if (!inFile.has(id) && (v.seat || v.seatPaid)) put('students', id, { seat: '', seatPaid: false }, true); }); }
  report.학생 = D.학생.length; report.잔액이월 = moved; report.잔액합계 = sumBal;

  // 국고 (이미 가져온 적 있으면 같은 번호라 덮어쓰기만 돼요)
  const tb = Math.round(num(D.국고잔액));
  if (tb !== 0) put('treasury', 'IMPORT-OPEN-T', { kind: tb > 0 ? '기타수입' : '기타지출', amount: tb, reason: '기존 앱에서 옮겨온 국고 잔액', studentId: '', by: '관리자', at }, false);
  report.국고 = tb;

  // 신용 기록 · 예금 · 공동구매
  arr(D.신용).forEach((c, i) => { if (sid(c.학생ID)) put('credits', `IMP-${c.id || i}`, { studentId: sid(c.학생ID), item: c.항목 || '', status: c.상태 || '', points: num(c.점수), by: c.승인자 || '', at: iso(c.시각) }, false); });
  report.신용기록 = arr(D.신용).length;
  arr(D.예금).forEach((d, i) => { if (sid(d.학생ID)) put('deposits', `IMP-${d.id || i}`, { studentId: sid(d.학생ID), principal: num(d.원금), days: num(d.일수), name: d.이름 || `${num(d.일수)}일`, rate: num(d.이자율), createdAt: iso(d.가입), maturity: iso(d.만기), status: '예치중', interest: 0 }, false); });
  report.예금 = arr(D.예금).length;
  arr(D.공동구매).forEach((g) => put('groupGoals', `IMP-${g.id}`, { title: g.제목, desc: g.설명 || '', target: num(g.목표), raised: num(g.모인), status: '진행중', min: g.최소 === null || g.최소 === undefined ? null : num(g.최소), createdMs: g.생성 ? new Date(g.생성).getTime() : Date.now() }, false));
  arr(D.공동참여).forEach((j, i) => { if (sid(j.학생ID)) put('groupJoins', `IMP-${j.id || i}`, { goalId: `IMP-${j.목표ID}`, studentId: sid(j.학생ID), amount: num(j.금액), at: iso(j.시각), cancelled: false }, false); });
  report.공동구매 = arr(D.공동구매).length;


  const mapping = D.학생.map((s) => ({ old: String(s.id), id: sid(s.id), name: s.이름 }));
  const nameOf = {}; D.학생.forEach((x) => (nameOf[String(x.id)] = x.이름));
  const seatList = arr(D.자리).filter((x) => num(x.줄) > 0 && num(x.칸) > 0).sort((a, b) => num(a.줄) - num(b.줄) || num(a.칸) - num(b.칸))
    .map((x) => ({ row: num(x.줄), col: num(x.칸), price: num(x.가격), forSale: x.판매중 !== false, name: x.학생ID ? (nameOf[String(x.학생ID)] || '(없는 학생 ' + x.학생ID + ')') : '', paid: !!x.납부 }));
  const warn = [];
  if (!seatList.length) warn.push('파일에 자리 정보가 없어요. 기존 앱 Apps Script에 최신 내보내기 코드(tools/내보내기.gs)를 다시 붙여넣고 실행해서 새 파일을 만들어 주세요. 이 파일로 가져오면 지금 서버의 자리는 그대로 남아요.');
  if (seatList.some((x) => x.name.startsWith('(없는'))) warn.push('앉은 학생 중 학생 목록에 없는 번호가 있어요.');
  report.자리_앉은학생 = seatList.filter((x) => x.name && !x.name.startsWith('(없는')).length;
  report.자리_납부 = seatList.filter((x) => x.paid).length;
  report.통로위치 = patch.통로위치 || S.통로위치;
  if (!run) return res.json({ ok: true, preview: true, report, mapping, seatList, warn, writes: ops.length });

  for (let i = 0; i < ops.length; i += 400) {
    const b = db.batch();
    ops.slice(i, i + 400).forEach(([type, ref, data, merge]) => (type === 'del' ? b.delete(ref) : merge ? b.set(ref, data, { merge: true }) : b.set(ref, data)));
    await b.commit();
  }
  res.json({ ok: true, preview: false, report, mapping, seatList, warn, message: '가져오기를 마쳤어요' });
}));

// ======================================================================
//  직업 활동 · 승인 · 자리 · 제출 · 신용 기준 · 직업 편집 · 은행 상품
// ======================================================================
const TASK_KINDS = ['벌금', '국고지출', '자리징수', '알바수당'];
const studentGuard = (...perms) => [...guard(...perms), studentOnly];
const okMsg = (res, message, extra) => res.json({ ok: true, message, ...(extra || {}) });

// ---------- 승인 ----------
async function approvalRows(status) {
  const [snap, names] = await Promise.all([db.collection('approvals').where('status', '==', status).get(), studentNames()]);
  const nm = (id) => (id === TEACHER_AUTHOR || id === '관리자' ? '선생님' : names[id] || id || '');
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.at.toMillis() - a.at.toMillis()).map((x) => ({
    id: x.id, type: x.type, requester: nm(x.requesterId), student: nm(x.studentId), amount: x.amount, reason: x.reason || '', kind: x.kind || '',
    at: timeStr(x.at.toDate()), status: x.status, batch: x.batch || '', handledAt: x.handledAt ? timeStr(x.handledAt.toDate()) : '', seatId: x.seatId || '',
  }));
}
app.get('/api/admin/approvals', guard('teacher'), wrap(async (req, res) => {
  const pending = await approvalRows('대기');
  const done = (await Promise.all(['승인', '거절'].map((s) => approvalRows(s)))).flat().slice(0, 30);
  res.json({ pending, done });
}));
async function resolveApproval(id, approve, by, override) {
  const ref = db.collection('approvals').doc(String(id));
  const S = await getSettings();
  return db.runTransaction(async (t) => {
    const a = await t.get(ref);
    if (!a.exists) throw new UserError('신청을 찾을 수 없어요');
    const x = a.data();
    if (x.status !== '대기') throw new UserError('이미 처리된 신청이에요');
    const at = Timestamp.now();
    if (!approve) { t.update(ref, { status: '거절', handledAt: at, by }); return '거절했어요'; }
    const students = await loadStudents(t, x.studentId ? [x.studentId] : []);
    let seat = null, seatRef = null;
    if (x.type === '자리징수') { seatRef = db.collection('seats').doc(x.seatId); seat = await t.get(seatRef); }
    let amount = x.amount;
    if (x.type === '알바수당' && override !== undefined && override !== null && override !== '') {
      amount = toInt(override, '금액을 확인해 주세요');
      if (amount <= 0) throw new UserError('금액은 0보다 커야 해요');
    }
    if (x.type === '벌금') {
      stageEntry(t, students, { txId: `FN-${id}`, studentId: x.studentId, kind: '벌금', amount: -amount, reason: x.reason, by: x.requesterId, allowNegative: S.빚허용 === 'Y', failMsg: '학생의 행복이 모자라요' }, at);
      stageTreasury(t, `FN-${id}:T`, { kind: '벌금', amount, reason: x.reason, studentId: x.studentId, by: x.requesterId }, at);
    } else if (x.type === '국고지출') {
      const kind = TREASURY_OUT.includes(x.kind) ? x.kind : '기타지출';
      if (x.studentId) stageEntry(t, students, { txId: `GV-${id}`, studentId: x.studentId, kind, amount, reason: x.reason, by: '관리자' }, at);
      stageTreasury(t, `GV-${id}:T`, { kind, amount: -amount, reason: x.reason, studentId: x.studentId || '', by: x.requesterId }, at);
    } else if (x.type === '자리징수') {
      if (!seat.exists) throw new UserError('그 자리가 사라졌어요');
      const sd = seat.data();
      if (sd.studentId !== x.studentId) throw new UserError('자리에 앉은 친구가 바뀌었어요');
      if (sd.paid) throw new UserError('이미 다 낸 자리예요');
      const price = sd.price || 0;
      stageEntry(t, students, { txId: `ST-${id}`, studentId: x.studentId, kind: '자리구매', amount: -price, reason: x.reason, memo: x.seatId, by: by, failMsg: '학생의 행복이 모자라요. 나중에 다시 승인해 주세요' }, at);
      stageTreasury(t, `ST-${id}:T`, { kind: '자리판매', amount: price, reason: x.reason, studentId: x.studentId, by }, at);
      t.update(seatRef, { paid: true, paidAt: at });
      t.update(students.get(x.studentId).ref, { seatPaid: true });
      amount = price;
    } else if (x.type === '알바수당') {
      stageEntry(t, students, { txId: `AB-${id}`, studentId: x.studentId, kind: '업무수당', amount, reason: x.reason, by: '관리자' }, at);
    }
    t.update(ref, { status: '승인', handledAt: at, by, amount });
    return '승인했어요';
  });
}
app.post('/api/admin/approvals/:id/approve', guard('teacher'), wrap(async (req, res) => okMsg(res, await resolveApproval(req.params.id, true, '관리자', req.body.amount))));
app.post('/api/admin/approvals/:id/reject', guard('teacher'), wrap(async (req, res) => okMsg(res, await resolveApproval(req.params.id, false, '관리자'))));
app.post('/api/admin/approvals/approve-many', guard('teacher'), wrap(async (req, res) => {
  const ids = uniqIds(req.body.ids);
  let ok = 0; const fails = [];
  for (const id of ids) { try { await resolveApproval(id, true, '관리자'); ok++; } catch (e) { if (e instanceof UserError) fails.push(e.message); else throw e; } }
  okMsg(res, `${ok}건 승인했어요${fails.length ? ` (${fails.length}건은 못 했어요: ${[...new Set(fails)].join(', ')})` : ''}`);
}));

// ---------- 직업 활동 화면에 쓸 내 직업 정보 ----------
app.get('/api/work/info', auth, wrap(async (req, res) => {
  const id = targetId(req);
  const [d, jobs] = await Promise.all([db.collection('students').doc(id).get(), getJobs()]);
  if (!d.exists) throw new UserError('학생을 찾을 수 없어요');
  const j = jobs[d.data().jobId];
  res.json({ name: d.data().name, job: j ? { id: j.id, name: j.name, desc: j.desc || '', perms: j.perms || [], daily: j.daily || [], periodic: j.periodic || [], reportable: !!j.reportable } : null });
}));

// ---------- 내 신청 내역 ----------
app.get('/api/work/mine', auth, studentOnly, wrap(async (req, res) => {
  const type = String(req.query.type || '');
  if (!TASK_KINDS.includes(type)) throw new UserError('종류를 확인해 주세요');
  const [snap, names] = await Promise.all([db.collection('approvals').where('requesterId', '==', req.user.id).get(), studentNames()]);
  res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => x.type === type).sort((a, b) => b.at.toMillis() - a.at.toMillis()).slice(0, 20)
    .map((x) => ({ at: timeStr(x.at.toDate()), student: names[x.studentId] || '', amount: x.amount, reason: x.reason, status: x.status })));
}));

// ---------- 경찰: 벌금 ----------
const fineItems = (S) => [{ id: 'late', name: '지각', amount: Number(S.지각벌금) }, { id: 'curse', name: '욕설', amount: null }, { id: 'other', name: '기타', amount: null }];
app.get('/api/work/fines', studentGuard('벌금'), wrap(async (req, res) => {
  const S = await getSettings();
  const names = await studentNames();
  res.json({ items: fineItems(S), max: Number(S.벌금최대금액), daily: Number(S.일일벌금건수), currency: S.화폐단위, students: Object.keys(names).sort((a, b) => Number(a) - Number(b)).filter((id) => id !== req.user.id).map((id) => ({ id, name: names[id] })) });
}));
app.post('/api/work/fines', studentGuard('벌금'), wrap(async (req, res) => {
  const S = await getSettings();
  const me = req.user.id, today = dayStr(new Date());
  const names = await studentNames();
  const targets = uniqIds(req.body.targets).filter((id) => id !== me && names[id]);
  if (!targets.length) throw new UserError('벌금을 매길 친구를 골라 주세요 (자기 자신은 안 돼요)');
  const item = fineItems(S).find((f) => f.id === req.body.itemId);
  if (!item) throw new UserError('없는 벌금 항목이에요');
  const amount = item.amount === null ? toInt(req.body.amount, '금액을 올바르게 넣어 주세요') : item.amount;
  if (amount <= 0) throw new UserError('금액을 올바르게 넣어 주세요');
  if (amount > Number(S.벌금최대금액)) throw new UserError(`한 사람에게 ${Number(S.벌금최대금액).toLocaleString()}까지만 매길 수 있어요`);
  const mine = await db.collection('approvals').where('requesterId', '==', me).get();
  const todays = new Set(mine.docs.filter((d) => d.data().type === '벌금' && d.data().day === today).map((d) => d.data().batch));
  if (todays.size >= Number(S.일일벌금건수)) throw new UserError(`오늘은 ${Number(S.일일벌금건수)}번까지만 신청할 수 있어요`);
  const note = String(req.body.note || '').trim().slice(0, 100);
  const batch = newId('FB'), at = Timestamp.now(), b = db.batch();
  targets.forEach((id) => b.set(db.collection('approvals').doc(newId('Q')), { type: '벌금', requesterId: me, studentId: id, amount, kind: item.name, reason: item.name + (note ? ' — ' + note : ''), status: '대기', at, day: today, batch }));
  await b.commit();
  okMsg(res, `${targets.length}명 벌금을 선생님께 신청했어요. 승인되면 반영돼요`);
}));

// ---------- 아르바이트 등 자유 업무 보고 ----------
app.post('/api/work/report', auth, studentOnly, wrap(async (req, res) => {
  const jobs = await getJobs();
  const me = await db.collection('students').doc(req.user.id).get();
  const job = me.exists ? jobs[me.data().jobId] : null;
  if (!job || !job.reportable) throw new UserError('업무 보고를 할 수 있는 직업이 아니에요');
  const content = String(req.body.content || '').trim();
  if (!content) throw new UserError('한 일을 적어 주세요');
  if (content.length > 200) throw new UserError('한 일은 200자까지 적을 수 있어요');
  const amount = toInt(req.body.amount, '받고 싶은 행복을 숫자로 적어 주세요');
  if (amount <= 0 || amount > 100000) throw new UserError('받고 싶은 행복을 올바르게 적어 주세요');
  const pend = (await db.collection('approvals').where('requesterId', '==', req.user.id).where('status', '==', '대기').get()).docs.filter((d) => d.data().type === '알바수당');
  if (pend.length >= 10) throw new UserError('아직 확인받지 못한 보고가 10개예요. 선생님이 확인한 뒤에 또 올려 주세요');
  await db.collection('approvals').doc(newId('Q')).set({ type: '알바수당', requesterId: req.user.id, studentId: req.user.id, amount, kind: '업무수당', reason: content, status: '대기', at: Timestamp.now(), day: dayStr(new Date()) });
  okMsg(res, '선생님께 보고했어요. 승인되면 행복을 받아요');
}));

// ---------- 자리 ----------
function seatLabelOf(s) { return `${s.row}-${s.col}`; }
async function cancelSeatRequests(seatId) {
  const snap = await db.collection('approvals').where('seatId', '==', seatId).get();
  const b = db.batch();
  snap.docs.forEach((d) => { if (d.data().type === '자리징수' && d.data().status === '대기') b.update(d.ref, { status: '취소', handledAt: Timestamp.now(), by: '시스템' }); });
  await b.commit();
}
async function seatsView() {
  const [S, seatSnap, studSnap, pendSnap] = await Promise.all([getSettings(), db.collection('seats').get(), db.collection('students').get(), db.collection('approvals').where('status', '==', '대기').get()]);
  const studs = {};
  studSnap.docs.forEach((d) => (studs[d.id] = d.data()));
  const pend = {};
  pendSnap.docs.forEach((d) => { if (d.data().type === '자리징수') pend[d.data().seatId] = d.id; });
  const seats = seatSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.row - b.row || a.col - b.col).map((s) => {
    const bal = s.studentId && studs[s.studentId] ? studs[s.studentId].balance || 0 : 0;
    return { id: s.id, row: s.row, col: s.col, price: s.price || 0, forSale: s.forSale !== false, studentId: s.studentId || '', name: s.studentId && studs[s.studentId] ? studs[s.studentId].name : '', paid: !!s.paid, balance: bal, shortfall: s.studentId ? Math.max(0, (s.price || 0) - bal) : 0, pending: !!pend[s.id] };
  });
  const seated = {};
  seats.forEach((s) => { if (s.studentId) seated[s.studentId] = s.id; });
  return {
    currency: S.화폐단위, rent: Number(S.월세), aisle: String(S.통로위치).split(',').map(Number).filter((n) => n > 0), seats,
    rows: Math.max(0, ...seats.map((s) => s.row)), cols: Math.max(0, ...seats.map((s) => s.col)),
    students: Object.keys(studs).sort((a, b) => Number(a) - Number(b)).map((id) => ({ id, name: studs[id].name, seat: seated[id] ? seated[id] : '' })),
  };
}
app.get('/api/work/seats', guard('자리관리'), wrap(async (req, res) => res.json(await seatsView())));
app.post('/api/work/seats/init', guard('자리관리'), wrap(async (req, res) => {
  const rows = toInt(req.body.rows, '줄 수를 넣어 주세요'), cols = toInt(req.body.cols, '칸 수를 넣어 주세요'), price = Math.max(0, toInt(req.body.price || 0));
  if (rows < 1 || cols < 1 || rows > 12 || cols > 12) throw new UserError('줄과 칸은 1~12 사이로 넣어 주세요');
  const existing = new Set((await db.collection('seats').get()).docs.map((d) => d.id));
  const b = db.batch(); let n = 0;
  for (let r = 1; r <= rows; r++) for (let c = 1; c <= cols; c++) { const id = `P${r}-${c}`; if (!existing.has(id)) { b.set(db.collection('seats').doc(id), { row: r, col: c, price, forSale: true, studentId: '', paid: false }); n++; } }
  await b.commit();
  okMsg(res, `${n}칸을 만들었어요`);
}));
app.post('/api/work/seats/add', guard('자리관리'), wrap(async (req, res) => {
  const r = toInt(req.body.row, '줄을 넣어 주세요'), c = toInt(req.body.col, '칸을 넣어 주세요'), price = Math.max(0, toInt(req.body.price || 0));
  if (r < 1 || c < 1 || r > 12 || c > 12) throw new UserError('줄과 칸은 1~12 사이로 넣어 주세요');
  const ref = db.collection('seats').doc(`P${r}-${c}`);
  if ((await ref.get()).exists) throw new UserError(`${r}줄 ${c}칸은 이미 있어요`);
  await ref.set({ row: r, col: c, price, forSale: true, studentId: '', paid: false });
  okMsg(res, `${r}줄 ${c}칸을 만들었어요`);
}));
app.post('/api/work/seats/bulk-price', guard('자리관리'), wrap(async (req, res) => {
  const price = toInt(req.body.price, '가격을 넣어 주세요');
  if (price < 0) throw new UserError('가격을 올바르게 넣어 주세요');
  const row = req.body.row === '' || req.body.row == null ? null : toInt(req.body.row);
  const snap = await db.collection('seats').get();
  const b = db.batch(); let n = 0, skip = 0;
  snap.docs.forEach((d) => { const x = d.data(); if (row !== null && x.row !== row) return; if (x.paid) { skip++; return; } b.update(d.ref, { price }); n++; });
  await b.commit();
  okMsg(res, `${row ? row + '줄 ' : ''}${n}칸을 ${price.toLocaleString()}으로 맞췄어요${skip ? ` (이미 낸 ${skip}칸은 그대로)` : ''}`);
}));
app.post('/api/work/seats/:id/set', guard('자리관리'), wrap(async (req, res) => {
  const ref = db.collection('seats').doc(req.params.id), d = await ref.get();
  if (!d.exists) throw new UserError('그런 자리가 없어요');
  const patch = {};
  if (req.body.price !== undefined && req.body.price !== '') {
    const price = toInt(req.body.price, '가격을 올바르게 넣어 주세요');
    if (price < 0) throw new UserError('가격을 올바르게 넣어 주세요');
    if (d.data().paid && price !== d.data().price) throw new UserError('이미 돈을 낸 자리는 가격을 바꿀 수 없어요');
    patch.price = price;
  }
  if (req.body.forSale !== undefined) patch.forSale = !!req.body.forSale;
  await ref.update(patch);
  okMsg(res, '저장했어요');
}));
app.post('/api/work/seats/:id/assign', guard('자리관리'), wrap(async (req, res) => {
  const ref = db.collection('seats').doc(req.params.id), d = await ref.get();
  if (!d.exists) throw new UserError('그런 자리가 없어요');
  const seat = d.data(), sid = String(req.body.studentId || '');
  if (seat.paid) throw new UserError('이미 돈을 낸 자리예요. 바꾸려면 선생님이 먼저 풀어야 해요');
  const b = db.batch();
  if (sid) {
    const stu = await db.collection('students').doc(sid).get();
    if (!stu.exists) throw new UserError('학생을 찾을 수 없어요');
    const others = (await db.collection('seats').where('studentId', '==', sid).get()).docs.filter((o) => o.id !== d.id);
    if (others.some((o) => o.data().paid)) throw new UserError('이 친구는 이미 돈을 낸 자리가 있어요');
    for (const o of others) { b.update(o.ref, { studentId: '' }); await cancelSeatRequests(o.id); }
    if (seat.studentId && seat.studentId !== sid) b.update(db.collection('students').doc(seat.studentId), { seat: '', seatPaid: false });
    b.update(ref, { studentId: sid });
    b.update(db.collection('students').doc(sid), { seat: seatLabelOf(seat), seatPaid: false });
  } else {
    if (seat.studentId) b.update(db.collection('students').doc(seat.studentId), { seat: '', seatPaid: false });
    b.update(ref, { studentId: '' });
  }
  await cancelSeatRequests(d.id);
  await b.commit();
  okMsg(res, sid ? '등록했어요. [징수 신청]을 눌러야 돈이 걷혀요' : '등록을 지웠어요');
}));
app.post('/api/work/seats/:id/collect', guard('자리관리'), wrap(async (req, res) => {
  const d = await db.collection('seats').doc(req.params.id).get();
  if (!d.exists) throw new UserError('그런 자리가 없어요');
  const s = d.data();
  if (!s.studentId) throw new UserError('먼저 이 칸에 앉을 친구를 등록해 주세요');
  if (s.paid) throw new UserError('이미 다 낸 자리예요');
  if (!(s.price > 0)) throw new UserError('가격을 먼저 정해 주세요');
  const stu = await db.collection('students').doc(s.studentId).get();
  const bal = stu.exists ? stu.data().balance || 0 : 0;
  if (bal < s.price) throw new UserError(`${stu.data().name}의 행복이 ${(s.price - bal).toLocaleString()} 모자라요 (지금 ${bal.toLocaleString()})`);
  const pend = (await db.collection('approvals').where('seatId', '==', d.id).get()).docs.some((x) => x.data().type === '자리징수' && x.data().status === '대기');
  if (pend) throw new UserError('이미 선생님께 신청해 둔 자리예요');
  const requester = req.user.role === 'teacher' ? '관리자' : req.user.id;
  await db.collection('approvals').doc(newId('Q')).set({ type: '자리징수', requesterId: requester, studentId: s.studentId, seatId: d.id, amount: s.price, kind: '자리판매', reason: `${stu.data().name} · ${s.row}줄 ${s.col}칸`, status: '대기', at: Timestamp.now(), day: dayStr(new Date()) });
  okMsg(res, '선생님께 징수를 신청했어요. 승인되면 국고로 들어가요');
}));
app.post('/api/work/seats/:id/delete', guard('자리관리'), wrap(async (req, res) => {
  const ref = db.collection('seats').doc(req.params.id), d = await ref.get();
  if (!d.exists) throw new UserError('그런 자리가 없어요');
  if (d.data().paid) throw new UserError('이미 돈을 낸 자리는 지울 수 없어요. 선생님이 먼저 풀어야 해요');
  if (d.data().studentId) await db.collection('students').doc(d.data().studentId).update({ seat: '', seatPaid: false });
  await cancelSeatRequests(d.id);
  await ref.delete();
  okMsg(res, '자리를 없앴어요');
}));
// 자리 배치 전체 지우기 (선생님만) — 자리 칸, 학생의 자리 표시, 대기 중인 징수 신청을 모두 정리해요
app.post('/api/admin/seats/reset-all', guard('teacher'), wrap(async (req, res) => {
  if (String(req.body.confirm || '').trim() !== '초기화') throw new UserError('확인 문구 "초기화"를 입력해 주세요');
  const [seatSnap, studSnap, apSnap] = await Promise.all([db.collection('seats').get(), db.collection('students').get(), db.collection('approvals').where('status', '==', '대기').get()]);
  const ops = [];
  seatSnap.docs.forEach((d) => ops.push((b) => b.delete(d.ref)));
  studSnap.docs.forEach((d) => { const x = d.data(); if (x.seat || x.seatPaid) ops.push((b) => b.update(d.ref, { seat: '', seatPaid: false })); });
  apSnap.docs.forEach((d) => { if (d.data().type === '자리징수') ops.push((b) => b.update(d.ref, { status: '취소', handledAt: Timestamp.now(), by: '시스템' })); });
  for (let i = 0; i < ops.length; i += 400) { const b = db.batch(); ops.slice(i, i + 400).forEach((f) => f(b)); await b.commit(); }
  okMsg(res, `자리 ${seatSnap.size}칸을 모두 지웠어요. 새로 만들어 주세요`);
}));
// 이미 낸 자리 풀기 (선생님만, 돈을 돌려줄 수도 있어요)
app.post('/api/admin/seats/:id/release', guard('teacher'), wrap(async (req, res) => {
  const refund = req.body.refund === true;
  const ref = db.collection('seats').doc(req.params.id);
  await db.runTransaction(async (t) => {
    const d = await t.get(ref);
    if (!d.exists) throw new UserError('그런 자리가 없어요');
    const s = d.data();
    if (!s.studentId) throw new UserError('비어 있는 자리예요');
    const students = await loadStudents(t, [s.studentId]);
    const at = Timestamp.now();
    if (refund && s.paid && s.price > 0) {
      const tx = `SR-${d.id}-${Date.now().toString(36)}`;
      stageEntry(t, students, { txId: tx, studentId: s.studentId, kind: '자리환불', amount: s.price, reason: `${s.row}줄 ${s.col}칸 환불`, by: '관리자' }, at);
      stageTreasury(t, `${tx}:T`, { kind: '부동산개발', amount: -s.price, reason: '자리 환불', studentId: s.studentId, by: '관리자' }, at);
    }
    t.update(ref, { studentId: '', paid: false });
    t.update(students.get(s.studentId).ref, { seat: '', seatPaid: false });
  });
  await cancelSeatRequests(req.params.id);
  okMsg(res, refund ? '자리를 풀고 돈을 돌려줬어요' : '자리를 풀었어요');
}));

// ---------- 국세청: 국고 지출 신청 ----------
app.post('/api/work/treasury/request', studentGuard('국고관리'), wrap(async (req, res) => {
  const kind = String(req.body.kind || '');
  if (!TREASURY_OUT.includes(kind)) throw new UserError('없는 항목이에요');
  const amount = toInt(req.body.amount, '금액을 올바르게 넣어 주세요');
  if (amount <= 0) throw new UserError('금액을 올바르게 넣어 주세요');
  const why = String(req.body.reason || '').trim();
  if (!why) throw new UserError('무엇에 쓸지 적어 주세요');
  const sid = String(req.body.studentId || '');
  if (sid && !(await db.collection('students').doc(sid).get()).exists) throw new UserError('학생을 찾을 수 없어요');
  await db.collection('approvals').doc(newId('Q')).set({ type: '국고지출', requesterId: req.user.id, studentId: sid, amount, kind, reason: `${kind} — ${why}`.slice(0, 160), status: '대기', at: Timestamp.now(), day: dayStr(new Date()) });
  okMsg(res, '선생님께 신청했어요');
}));

// ---------- 통계청: 제출 확인 (임시 기록 → 선생님이 저장) ----------
const SUBMIT_REF = () => db.collection('meta').doc('submission');
async function submitView() {
  const [d, names] = await Promise.all([SUBMIT_REF().get(), studentNames()]);
  const x = d.exists ? d.data() : {};
  return { item: x.item || '', status: x.status || {}, by: x.by || '', at: x.atMs || 0, students: Object.keys(names).sort((a, b) => Number(a) - Number(b)).map((id) => ({ id, name: names[id] })) };
}
app.get('/api/work/submit', guard('teacher'), wrap(async (req, res) => res.json(await submitView())));
async function bumpSubmit(req, patchFn) {
  const by = req.user.role === 'teacher' ? '선생님' : (await studentNames())[req.user.id] || '';
  await db.runTransaction(async (t) => {
    const d = await t.get(SUBMIT_REF());
    const x = d.exists ? d.data() : { item: '', status: {} };
    patchFn(x);
    t.set(SUBMIT_REF(), { item: x.item || '', status: x.status || {}, by, atMs: Date.now() });
  });
}
app.post('/api/work/submit/check', guard('teacher'), wrap(async (req, res) => {
  const st = String(req.body.status || '');
  if (!['제출', '미제출', ''].includes(st)) throw new UserError('상태를 확인해 주세요');
  await bumpSubmit(req, (x) => { x.status = x.status || {}; if (req.body.item !== undefined) x.item = String(req.body.item).slice(0, 60); if (req.body.studentId) { if (st) x.status[req.body.studentId] = st; else delete x.status[req.body.studentId]; } });
  res.json(await submitView());
}));
app.post('/api/work/submit/all', guard('teacher'), wrap(async (req, res) => {
  const st = String(req.body.status || '');
  if (!['제출', '미제출', ''].includes(st)) throw new UserError('상태를 확인해 주세요');
  const names = await studentNames();
  await bumpSubmit(req, (x) => { x.status = {}; if (st) Object.keys(names).forEach((id) => (x.status[id] = st)); });
  res.json(await submitView());
}));
// 기록으로 저장 → 신용점수 반영 (선생님만)
app.post('/api/admin/submit/save', guard('teacher'), wrap(async (req, res) => {
  const S = await getSettings();
  const v = await submitView();
  const item = String(req.body.item !== undefined ? req.body.item : v.item).trim();
  if (!item) throw new UserError('항목 이름을 적어 주세요 (예: 수학 숙제)');
  const ids = Object.keys(v.status).filter((id) => ['제출', '미제출'].includes(v.status[id]));
  if (!ids.length) throw new UserError('체크한 학생이 없어요');
  const at = Timestamp.now(), b = db.batch();
  ids.forEach((id) => b.set(db.collection('credits').doc(), { studentId: id, item, status: v.status[id], points: v.status[id] === '제출' ? Number(S.제출점수) : Number(S.미제출점수), by: '관리자', at }));
  b.delete(SUBMIT_REF());
  await b.commit();
  okMsg(res, `${ids.length}명의 "${item}" 기록을 저장했어요`);
}));

// ======================================================================
//  과제 (선생님이 내면 → 학생 기본정보에 나타남 → 통계청이 O/X 체크해서 선생님께 보냄 → 선생님이 최종 저장하면 신용점수 반영)
//   상태: 진행중 → 검토대기 → 마감
// ======================================================================
const ASG = () => db.collection('assignments');
async function asgNames() { return studentNames(); }
function asgSummary(id, x, total) {
  const marks = x.marks || {}, done = x.done || {};
  return {
    id, title: x.title, desc: x.desc || '', status: x.status, day: x.day || '', penalty: !!x.penalty,
    doneCount: Object.keys(done).length, checked: Object.keys(marks).length, total,
    by: x.editedBy || '', sentBy: x.sentBy || '', sentAt: x.sentAt ? timeStr(x.sentAt.toDate()) : '', closedAt: x.closedAt ? timeStr(x.closedAt.toDate()) : '',
    ok: x.status === '마감' ? Number(x.okCount || 0) : 0, no: x.status === '마감' ? Number(x.noCount || 0) : 0,
  };
}
async function asgList(statuses) {
  const [snap, names] = await Promise.all([ASG().get(), asgNames()]);
  const total = Object.keys(names).length;
  return { total, list: snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => statuses.includes(x.status))
    .sort((a, b) => (b.createdMs || 0) - (a.createdMs || 0)).map((x) => asgSummary(x.id, x, total)) };
}
async function asgBoard(id) {
  const [d, names] = await Promise.all([ASG().doc(String(id)).get(), asgNames()]);
  if (!d.exists) throw new UserError('그 과제를 찾을 수 없어요');
  const x = d.data(), done = x.done || {};
  return {
    assignment: { id: d.id, title: x.title, desc: x.desc || '', status: x.status, penalty: !!x.penalty }, status: x.marks || {}, by: x.editedBy || '',
    students: Object.keys(names).sort((a, b) => Number(a) - Number(b)).map((sid) => ({ id: sid, name: names[sid], done: !!done[sid], doneAt: done[sid] ? timeStr(new Date(done[sid])) : '' })),
  };
}
async function asgEdit(req, id, patchFn, statuses) {
  const by = req.user.role === 'teacher' ? '선생님' : (await studentNames())[req.user.id] || '';
  await db.runTransaction(async (t) => {
    const ref = ASG().doc(String(id)), d = await t.get(ref);
    if (!d.exists) throw new UserError('그 과제를 찾을 수 없어요');
    const x = d.data();
    if (!statuses.includes(x.status)) throw new UserError(x.status === '마감' ? '이미 마감한 과제예요' : '이미 선생님께 보낸 과제라 더 고칠 수 없어요');
    const nx = { marks: { ...(x.marks || {}) }, done: { ...(x.done || {}) }, status: x.status };
    patchFn(nx);
    t.update(ref, { marks: nx.marks, done: nx.done, status: nx.status, editedBy: by, editedMs: Date.now(), ...(nx.sent ? { sentBy: by, sentAt: Timestamp.now() } : {}) });
  });
}
const editable = (req) => (req.user.role === 'teacher' ? ['진행중', '검토대기'] : ['진행중']);

// 학생: 내 과제 (진행중인 것만) · 다했어요
app.get('/api/assignments/mine', auth, wrap(async (req, res) => {
  const id = targetId(req), S = await getSettings();
  const { list } = await asgList(['진행중']);
  const snap = await ASG().get();
  const doneOf = {}; snap.docs.forEach((d) => (doneOf[d.id] = (d.data().done || {})[id]));
  res.json({ assignments: list.slice(0, Number(S.과제최대개수) || 6).map((a) => ({ id: a.id, title: a.title, desc: a.desc, day: a.day, penalty: !!a.penalty, done: !!doneOf[a.id], doneAt: doneOf[a.id] ? timeStr(new Date(doneOf[a.id])) : '' })) });
}));
app.post('/api/assignments/:id/done', auth, studentOnly, wrap(async (req, res) => {
  const sid = req.user.id, on = req.body.on !== false;
  await asgEdit(req, req.params.id, (nx) => { if (on) nx.done[sid] = Date.now(); else delete nx.done[sid]; }, ['진행중']);
  okMsg(res, on ? '다했어요로 알렸어요' : '취소했어요');
}));

// 통계청 공무원(제출승인 권한) · 선생님: 체크판
app.get('/api/work/assignments', guard('제출승인'), wrap(async (req, res) => res.json(await asgList(req.user.role === 'teacher' ? ['진행중', '검토대기'] : ['진행중']))));
app.get('/api/work/assignments/:id', guard('제출승인'), wrap(async (req, res) => res.json(await asgBoard(req.params.id))));
app.post('/api/work/assignments/:id/check', guard('제출승인'), wrap(async (req, res) => {
  const st = String(req.body.status || ''), sid = String(req.body.studentId || '');
  if (!['제출', '미제출', ''].includes(st)) throw new UserError('상태를 확인해 주세요');
  await asgEdit(req, req.params.id, (nx) => { if (st) nx.marks[sid] = st; else delete nx.marks[sid]; }, editable(req));
  res.json(await asgBoard(req.params.id));
}));
app.post('/api/work/assignments/:id/all', guard('제출승인'), wrap(async (req, res) => {
  const st = String(req.body.status || '');
  if (!['제출', '미제출', ''].includes(st)) throw new UserError('상태를 확인해 주세요');
  const names = await asgNames();
  await asgEdit(req, req.params.id, (nx) => { nx.marks = {}; if (st) Object.keys(names).forEach((id) => (nx.marks[id] = st)); }, editable(req));
  res.json(await asgBoard(req.params.id));
}));
app.post('/api/work/assignments/:id/fill-done', guard('제출승인'), wrap(async (req, res) => {
  await asgEdit(req, req.params.id, (nx) => { Object.keys(nx.done).forEach((id) => { if (!nx.marks[id]) nx.marks[id] = '제출'; }); }, editable(req));
  res.json(await asgBoard(req.params.id));
}));
app.post('/api/work/assignments/:id/send', guard('제출승인'), wrap(async (req, res) => {
  await asgEdit(req, req.params.id, (nx) => { nx.status = '검토대기'; nx.sent = true; }, ['진행중']);
  okMsg(res, '선생님께 보냈어요');
}));

// 선생님: 만들기 · 목록 · 최종 저장 · 돌려보내기 · 지우기
app.get('/api/admin/assignments', guard('teacher'), wrap(async (req, res) => res.json(await asgList(['진행중', '검토대기', '마감']))));
app.post('/api/admin/assignments', guard('teacher'), wrap(async (req, res) => {
  const title = String(req.body.title || '').trim().slice(0, 60), desc = String(req.body.desc || '').trim().slice(0, 120);
  if (!title) throw new UserError('과제 제목을 적어 주세요');
  const S = await getSettings(), open = (await asgList(['진행중'])).list.length;
  if (open >= Number(S.과제최대개수)) throw new UserError(`진행 중인 과제는 ${Number(S.과제최대개수)}개까지예요. 먼저 마감해 주세요`);
  await ASG().doc(newId('A')).set({ title, desc, penalty: req.body.penalty === true, status: '진행중', marks: {}, done: {}, day: dayStr(new Date()), createdMs: Date.now() });
  okMsg(res, '과제를 냈어요. 학생 기본정보에 나타나요');
}));
app.post('/api/admin/assignments/:id/save', guard('teacher'), wrap(async (req, res) => {
  const S = await getSettings(), at = Timestamp.now(), names = await asgNames();
  const ref = ASG().doc(String(req.params.id)), d = await ref.get();
  if (!d.exists) throw new UserError('그 과제를 찾을 수 없어요');
  const x = d.data();
  if (x.status === '마감') throw new UserError('이미 마감한 과제예요');
  const ids = Object.keys(names);
  const b = db.batch(); let ok = 0, no = 0;
  ids.forEach((id) => {
    const stt = (x.marks || {})[id] === '미제출' ? '미제출' : '제출';
    stt === '제출' ? ok++ : no++;
    b.set(db.collection('credits').doc(), { studentId: id, item: x.title, status: stt, points: stt === '제출' ? Number(S.제출점수) : (x.penalty ? -Math.abs(Number(S.과제미제출감점) || 1) : Number(S.미제출점수)), by: '관리자', at });
  });
  b.update(ref, { status: '마감', closedAt: at, okCount: ok, noCount: no });
  await b.commit();
  okMsg(res, `"${x.title}" 마감: 제출 ${ok}명 · 미제출 ${no}명을 신용점수에 반영했어요`);
}));
app.post('/api/admin/assignments/:id/penalty', guard('teacher'), wrap(async (req, res) => {
  const ref = ASG().doc(String(req.params.id)), d = await ref.get();
  if (!d.exists) throw new UserError('그 과제를 찾을 수 없어요');
  if (d.data().status === '마감') throw new UserError('이미 마감한 과제예요');
  await ref.update({ penalty: req.body.on === true });
  okMsg(res, req.body.on === true ? '미제출 감점을 켰어요' : '미제출 감점을 껐어요');
}));
app.post('/api/admin/assignments/:id/return', guard('teacher'), wrap(async (req, res) => {
  const ref = ASG().doc(String(req.params.id)), d = await ref.get();
  if (!d.exists || d.data().status !== '검토대기') throw new UserError('돌려보낼 수 없는 과제예요');
  await ref.update({ status: '진행중' });
  okMsg(res, '통계청에 돌려보냈어요');
}));
app.post('/api/admin/assignments/:id/delete', guard('teacher'), wrap(async (req, res) => {
  const ref = ASG().doc(String(req.params.id)), d = await ref.get();
  if (!d.exists) throw new UserError('그 과제를 찾을 수 없어요');
  await ref.delete();
  okMsg(res, '과제를 지웠어요 (신용점수에 이미 반영된 기록은 그대로예요)');
}));

// ---------- 신용등급 평가원: 현황 · 등급 기준 ----------
async function creditBoard() {
  const [S, studs, cr] = await Promise.all([getSettings(), db.collection('students').get(), db.collection('credits').get()]);
  const by = {};
  cr.docs.forEach((d) => { const x = d.data(); (by[x.studentId] = by[x.studentId] || []).push(x); });
  const list = studs.docs.map((d) => { const sm = creditSummary(by[d.id] || [], S); return { id: d.id, name: d.data().name, total: sm.total, grade: sm.grade, submitted: sm.submitted, missed: sm.missed }; }).sort((a, b) => b.total - a.total);
  return { S, list };
}
function parseCuts(v) {
  const c = String(v).split(',').map((x) => x.trim()).filter((x) => x !== '').map(Number);
  if (c.length !== 4 || c.some((n) => !Number.isFinite(n))) throw new UserError('숫자 4개를 쉼표로 넣어 주세요 (예: 24,18,12,6)');
  for (let i = 1; i < c.length; i++) if (c[i] >= c[i - 1]) throw new UserError('앞에서 뒤로 갈수록 작아져야 해요');
  return c;
}
app.get('/api/work/credit', guard('신용관리'), wrap(async (req, res) => {
  const { S, list } = await creditBoard();
  const dist = [0, 0, 0, 0, 0];
  list.forEach((x) => dist[x.grade - 1]++);
  res.json({ list, cuts: String(S.신용등급컷), dist });
}));
app.post('/api/work/credit/preview', guard('신용관리'), wrap(async (req, res) => {
  const cuts = parseCuts(req.body.cuts);
  const { list } = await creditBoard();
  const dist = [0, 0, 0, 0, 0], changes = [];
  list.forEach((x) => { const g = gradeOf(x.total, cuts.join(',')); dist[g - 1]++; if (g !== x.grade) changes.push({ name: x.name, from: x.grade, to: g }); });
  res.json({ dist, changes });
}));
app.post('/api/work/credit/save', guard('신용관리'), wrap(async (req, res) => {
  const cuts = parseCuts(req.body.cuts);
  const { list } = await creditBoard();
  const n = list.filter((x) => gradeOf(x.total, cuts.join(',')) !== x.grade).length;
  await db.collection('meta').doc('settings').set({ 신용등급컷: cuts.join(',') }, { merge: true });
  clearCaches();
  okMsg(res, `등급 기준을 바꿨어요. ${n}명의 등급이 달라졌어요`);
}));

// ---------- 직업 편집 (선생님) ----------
app.get('/api/admin/jobs', guard('teacher'), wrap(async (req, res) => {
  const [jobs, studs] = await Promise.all([getJobs(), db.collection('students').get()]);
  const count = {};
  studs.docs.forEach((d) => { const j = d.data().jobId; if (j) count[j] = (count[j] || 0) + 1; });
  res.json({ perms: JOB_PERMS, jobs: Object.values(jobs).sort((a, b) => (a.order || 0) - (b.order || 0)).map((j) => ({ id: j.id, name: j.name, salary: j.salary, minCredit: j.minCredit, minMath: j.minMath, desc: j.desc || '', perms: j.perms || [], capacity: j.capacity, source: j.source, daily: j.daily || [], periodic: j.periodic || [], reportable: !!j.reportable, count: count[j.id] || 0 })) });
}));
app.post('/api/admin/jobs/save', guard('teacher'), wrap(async (req, res) => {
  const b = req.body, name = String(b.name || '').trim();
  if (!name) throw new UserError('직업 이름을 적어 주세요');
  const lines = (v) => (Array.isArray(v) ? v : String(v || '').split('\n')).map((x) => String(x).trim()).filter(Boolean).slice(0, 12);
  const num = (v, min, max, msg) => { const n = Math.round(Number(v)); if (!Number.isFinite(n) || n < min || n > max) throw new UserError(msg); return n; };
  const data = {
    name, salary: num(b.salary, 0, 100000, '월급을 확인해 주세요'), minCredit: num(b.minCredit, 1, 5, '신용등급은 1~5'), minMath: num(b.minMath, 1, 5, '수학등급은 1~5'),
    desc: String(b.desc || '').trim(), perms: (Array.isArray(b.perms) ? b.perms : []).filter((p) => JOB_PERMS.includes(p)), capacity: num(b.capacity || 0, 0, 30, '정원은 0~30'),
    source: b.source === '국고' ? '국고' : '민간', daily: lines(b.daily), periodic: lines(b.periodic), reportable: !!b.reportable,
  };
  const jobs = await getJobs();
  const id = b.id ? String(b.id) : newId('J');
  if (b.id && !jobs[id]) throw new UserError('그런 직업이 없어요');
  if (!b.id) data.order = Object.keys(jobs).length + 100;
  await db.collection('jobs').doc(id).set(data, { merge: true });
  clearCaches();
  okMsg(res, b.id ? '직업을 고쳤어요' : `"${name}" 직업을 만들었어요`);
}));
app.post('/api/admin/jobs/:id/delete', guard('teacher'), wrap(async (req, res) => {
  const jobs = await getJobs();
  if (!jobs[req.params.id]) throw new UserError('그런 직업이 없어요');
  const snap = await db.collection('students').where('jobId', '==', req.params.id).get();
  const b = db.batch();
  snap.docs.forEach((d) => b.update(d.ref, { jobId: '' }));
  b.delete(db.collection('jobs').doc(req.params.id));
  await b.commit();
  clearCaches();
  okMsg(res, `"${jobs[req.params.id].name}" 직업을 지웠어요${snap.size ? ` (${snap.size}명은 직업이 비었어요)` : ''}`);
}));

// ---------- 은행 상품 추가 · 삭제 ----------
app.post('/api/admin/bank/product', guard('은행관리'), wrap(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw new UserError('상품 이름을 적어 주세요 (예: 1주, 2주, 1달)');
  const days = daysFromName(name, Number(req.body.days));
  if (!Number.isFinite(days) || days < 1 || days > 365) throw new UserError('기간(일)을 확인해 주세요');
  const nums = (req.body.rates || []).map(Number);
  if (nums.length !== 5 || nums.some((n) => !Number.isFinite(n) || n < 0 || n > 50)) throw new UserError('이자율은 0~50 사이 숫자 5개예요');
  await db.collection('rates').doc(String(days)).set({ days, name, rates: nums });
  okMsg(res, `${name}(${days}일) 상품을 저장했어요`);
}));
app.post('/api/admin/bank/product/:days/delete', guard('은행관리'), wrap(async (req, res) => {
  const ref = db.collection('rates').doc(String(req.params.days));
  if (!(await ref.get()).exists) throw new UserError('그런 상품이 없어요');
  await ref.delete();
  okMsg(res, '상품을 없앴어요 (이미 맡긴 예금은 그대로예요)');
}));

// ---------- 보드 전체 비우기 ----------
app.post('/api/admin/boards/wipe-all', guard('teacher'), wrap(async (req, res) => {
  if (req.body.confirm !== '삭제') throw new UserError('확인 문구를 입력해 주세요');
  let n = 0;
  for (const c of ['boardPosts', 'boardComments', 'boardLikes', 'boardPhotos', 'boards']) {
    const snap = await db.collection(c).get();
    for (let i = 0; i < snap.docs.length; i += 400) { const b = db.batch(); snap.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref)); await b.commit(); }
    n += snap.size;
  }
  okMsg(res, `보드를 모두 지웠어요 (${n}개)`);
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
