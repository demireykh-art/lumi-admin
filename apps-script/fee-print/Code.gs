/**
 * 루미의원 수가표 (원본) — 원내 출력물 인쇄
 *
 * 시트에 붙여 쓰는 Apps Script (확장 프로그램 → Apps Script).
 * 메뉴 "🖨 원내 출력물 → 가격표 인쇄 미리보기" 를 누르면 Print.html 이 뜨고,
 * 거기서 [🖨 인쇄] 를 누르면 브라우저 인쇄 창(→ PDF 저장/프린터)이 열린다.
 *
 * 서버는 세 탭의 값을 그대로 넘기기만 한다. 노출 판정·묶음·디자인은 전부
 * Print.html 쪽에 있다(미리보기 생성기도 같은 파일을 쓰도록 한 곳에 모음).
 */

var FEE_SHEET = '수가표';
var CAT_SHEET = '카테고리';
var FOOT_SHEET = '하단 문구';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🖨 원내 출력물')
    .addItem('가격표 인쇄 미리보기', 'openFeePrint')
    .addToUi();
}

function openFeePrint() {
  var html = HtmlService.createHtmlOutputFromFile('Print')
    .setWidth(1100)
    .setHeight(820);
  SpreadsheetApp.getUi().showModelessDialog(html, '원내 가격표');
}

/** Print.html 이 google.script.run 으로 부른다. */
function getPrintData() {
  var ss = SpreadsheetApp.getActive();
  function read(name) {
    var sh = ss.getSheetByName(name);
    if (!sh) return [];
    var rng = sh.getDataRange();
    var vals = rng.getValues();
    // 날짜 등은 문자열로(google.script.run 이 Date 를 못 넘기는 경우 대비)
    return vals
      .map(function (r) {
        return r.map(function (v) {
          return v instanceof Date ? Utilities.formatDate(v, ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd') : v;
        });
      })
      .filter(function (r) {
        return r.some(function (v) { return String(v).trim() !== ''; });
      });
  }
  return {
    fees: read(FEE_SHEET),
    cats: read(CAT_SHEET),
    foot: read(FOOT_SHEET),
    today: Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd'),
  };
}
