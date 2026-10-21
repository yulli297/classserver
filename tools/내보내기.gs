/**************************************************************
 * 돼지공주나라 → 서버 버전 데이터 내보내기 (읽기만 합니다. 기존 시트는 바꾸지 않아요)
 *
 * 사용법
 *  1) 기존 Apps Script 프로젝트에 새 파일(예: 99_Export.gs)을 만들고 이 내용을 붙여넣어요.
 *  2) 위쪽 함수 선택 칸에서 '내보내기_서버버전' 을 고르고 ▶ 실행 (처음 한 번 권한 허용)
 *  3) 실행 로그에 나온 링크의 파일을 내려받아요. (드라이브 맨 위 폴더에 '돼지공주나라_내보내기.json'이 생겨요)
 *  4) 서버 버전 → 선생님 로그인 → 기본정보 → 교사 모드 → '데이터 가져오기'에서 그 파일을 올려요.
 *
 *  ※ 비밀번호는 담지 않아요. 가져온 뒤 학생 비밀번호는 모두 1111 이에요.
 **************************************************************/

function 표읽기_(이름) {
  const sh = sh_(이름);
  if (!sh || sh.getLastRow() < 2) return [];
  const 값 = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const 머리 = 값[0].map(function (h) { return String(h).trim(); });
  return 값.slice(1).filter(function (r) { return r.some(function (c) { return c !== '' && c !== null; }); })
    .map(function (r) { const o = {}; 머리.forEach(function (h, i) { if (h) o[h] = r[i]; }); return o; });
}
function 글자_(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function 시각_(v) { try { return v ? new Date(v).toISOString() : ''; } catch (e) { return ''; } }
function 예_(v) { return v === true || String(v).toUpperCase() === 'Y' || String(v).toUpperCase() === 'TRUE'; }

function 내보내기_서버버전() {
  const 결과 = { 만든시각: new Date().toISOString(), 버전: 1 };

  // 설정 (비밀번호·소금은 제외)
  결과.설정 = {};
  표읽기_('설정').forEach(function (r) {
    const k = 글자_(r['키']);
    if (!k || k === '관리자비밀번호' || k === '비밀번호소금') return;
    결과.설정[k] = 글자_(r['값']);
  });

  결과.학생 = 표읽기_('학생데이터').filter(function (r) { return r['학생ID'] !== ''; }).map(function (r) {
    return { id: 글자_(r['학생ID']), 이름: 글자_(r['이름']), 직업ID: 글자_(r['현재직업ID']),
             수학: (r['수학점수'] === '' || r['수학점수'] === null) ? null : Number(r['수학점수']) };
  });

  결과.잔액 = {};
  표읽기_('잔액요약').forEach(function (r) { 결과.잔액[글자_(r['학생ID'])] = Math.round(Number(r['잔액']) || 0); });

  결과.국고잔액 = Math.round(Number(국고현황_().잔액) || 0);

  결과.신용 = 표읽기_('제출기록').map(function (r) {
    return { id: 글자_(r['기록ID']), 시각: 시각_(r['날짜']), 학생ID: 글자_(r['학생ID']), 항목: 글자_(r['항목']),
             상태: 글자_(r['상태']), 점수: Number(r['점수']) || 0, 승인자: 글자_(r['승인자']) };
  });

  결과.자리 = 표읽기_('자리배치').filter(function (r) { return 글자_(r['줄']) && 글자_(r['칸']); }).map(function (r) {
    return { 줄: 글자_(r['줄']), 칸: 글자_(r['칸']), 가격: Number(r['가격']) || 0, 판매중: 글자_(r['판매중']).toUpperCase() !== 'N',
             학생ID: 글자_(r['등록학생ID']), 납부: 예_(r['납부완료']) };
  });

  결과.직업 = 표읽기_('직업목록').filter(function (r) { return 글자_(r['직업ID']); }).map(function (r) {
    return { id: 글자_(r['직업ID']), 이름: 글자_(r['직업명']), 월급: Number(r['월급']) || 0,
             최소신용: Number(r['최소신용등급']) || 5, 최소수학: Number(r['최소수학등급']) || 5, 설명: 글자_(r['직업설명']),
             권한: 글자_(r['권한']), 정원: Number(r['정원']) || 0, 재원: 글자_(r['급여재원']) || '민간' };
  });

  // 상점: 남은 재고(판매기준 반영)와 '이번 세금 주기에 낸 학생'·'오늘 산 개수'를 함께 담아요
  const 판매 = 판매현황_();
  const 기준 = 판매기준표_(sh_('상점아이템'));
  결과.상점 = 표읽기_('상점아이템').filter(function (r) { return 글자_(r['아이템ID']); }).map(function (r) {
    const id = 글자_(r['아이템ID']);
    const m = 판매[id] || { 총판매: 0, 이번달학생: {}, 오늘학생별: {} };
    const 총재고 = (r['재고'] === '' || r['재고'] === null) ? null : Number(r['재고']);
    const 팔린 = Math.max(0, (m.총판매 || 0) - (기준[id] || 0));
    return { id: id, 분류: 글자_(r['카테고리']), 이름: 글자_(r['아이템명']), 가격: Number(r['가격']) || 0, 설명: 글자_(r['설명']),
             활성: String(r['활성']).toUpperCase() !== 'N', 남은재고: 총재고 === null ? null : Math.max(0, 총재고 - 팔린),
             한도: (r['1인한도'] === '' || r['1인한도'] === null) ? null : Number(r['1인한도']),
             이번주기납부: Object.keys(m.이번달학생 || {}), 오늘구매: m.오늘학생별 || {} };
  });

  결과.이자율 = 표읽기_('이자율표').map(function (r) {
    const 개월 = Number(r['기간개월']) || 0;
    const 일수 = Number(r['기간일수']) || 개월 * 30;
    return { 일수: 일수, 이름: 글자_(r['기간이름']) || (개월 ? 개월 + '개월' : 일수 + '일'),
             이율: [1, 2, 3, 4, 5].map(function (g) { return Number(r[g + '등급']) || 0; }) };
  });

  결과.예금 = 표읽기_('예금').filter(function (r) { return 글자_(r['상태']) === '예치중'; }).map(function (r) {
    return { id: 글자_(r['예금ID']), 학생ID: 글자_(r['학생ID']), 원금: Number(r['원금']) || 0, 이자율: Number(r['이자율']) || 0,
             가입: 시각_(r['가입일']), 만기: 시각_(r['만기일']), 일수: Number(r['기간일수']) || (Number(r['기간개월']) || 0) * 30,
             이름: 글자_(r['기간이름']) };
  });

  const 목표 = 표읽기_('공동목표').filter(function (r) { return (글자_(r['상태']) || '진행중') === '진행중'; });
  const 목표ID = {}; 목표.forEach(function (r) { 목표ID[글자_(r['목표ID'])] = true; });
  결과.공동구매 = 목표.map(function (r) {
    return { id: 글자_(r['목표ID']), 제목: 글자_(r['제목']), 설명: 글자_(r['설명']), 목표: Number(r['목표금액']) || 0,
             모인: Number(r['모인금액']) || 0, 최소: (r['최소금액'] === '' || r['최소금액'] === null) ? null : Number(r['최소금액']), 생성: 시각_(r['생성일']) };
  });
  결과.공동참여 = 표읽기_('공동참여').filter(function (r) { return 목표ID[글자_(r['목표ID'])] && !예_(r['취소됨']); }).map(function (r) {
    return { id: 글자_(r['참여ID']), 목표ID: 글자_(r['목표ID']), 학생ID: 글자_(r['학생ID']), 금액: Number(r['금액']) || 0, 시각: 시각_(r['시각']) };
  });

  const 파일 = DriveApp.createFile('돼지공주나라_내보내기.json', JSON.stringify(결과), 'application/json');
  Logger.log('완료! 이 파일을 내려받으세요: ' + 파일.getUrl());
  Logger.log('학생 ' + 결과.학생.length + '명 · 신용기록 ' + 결과.신용.length + '건 · 자리 ' + 결과.자리.length + '칸');
}
