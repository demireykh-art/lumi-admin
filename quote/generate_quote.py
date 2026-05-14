"""Generate 견적서 PDF for 루미의원 경영 관리 프로그램 개발."""
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
)


pdfmetrics.registerFont(TTFont(
    'NanumKR',
    '/usr/share/fonts/truetype/nanum/NanumBarunGothic.ttf',
))
pdfmetrics.registerFont(TTFont(
    'NanumKR-Bold',
    '/usr/share/fonts/truetype/nanum/NanumBarunGothicBold.ttf',
))
registerFontFamily('NanumKR', normal='NanumKR', bold='NanumKR-Bold',
                   italic='NanumKR', boldItalic='NanumKR-Bold')
KFONT = 'NanumKR'
KFONT_BOLD = 'NanumKR-Bold'


def build():
    out = '/home/user/lumi-admin/quote/루미의원_경영관리프로그램_견적서.pdf'
    doc = SimpleDocTemplate(
        out, pagesize=A4,
        leftMargin=20*mm, rightMargin=20*mm,
        topMargin=20*mm, bottomMargin=20*mm,
        title='루미의원 경영관리 프로그램 견적서',
    )

    styles = getSampleStyleSheet()
    title = ParagraphStyle('Title', parent=styles['Title'],
                           fontName=KFONT_BOLD, fontSize=22, leading=28,
                           alignment=1, spaceAfter=12)
    h2 = ParagraphStyle('H2', parent=styles['Heading2'],
                        fontName=KFONT_BOLD, fontSize=12, leading=18,
                        spaceBefore=10, spaceAfter=6)
    body = ParagraphStyle('Body', parent=styles['BodyText'],
                          fontName=KFONT, fontSize=10, leading=15)
    body_bold = ParagraphStyle('BodyBold', parent=body, fontName=KFONT_BOLD)
    right = ParagraphStyle('Right', parent=body, alignment=2)
    center_big = ParagraphStyle('CenterBig', parent=body_bold,
                                fontSize=13, leading=20, alignment=1,
                                spaceBefore=6, spaceAfter=6)
    right_small = ParagraphStyle('RightSmall', parent=body, alignment=2, fontSize=10)

    story = []

    # Title
    story.append(Paragraph('견 적 서', title))

    # Top right meta
    meta_tbl = Table(
        [[Paragraph('견적일자: 2026년 5월 14일', right_small)],
         [Paragraph('견적번호: LUMI-2026-002', right_small)]],
        colWidths=[170*mm]
    )
    meta_tbl.setStyle(TableStyle([
        ('LEFTPADDING', (0,0), (-1,-1), 0),
        ('RIGHTPADDING', (0,0), (-1,-1), 0),
        ('TOPPADDING', (0,0), (-1,-1), 0),
        ('BOTTOMPADDING', (0,0), (-1,-1), 1),
    ]))
    story.append(meta_tbl)
    story.append(Spacer(1, 8))

    # Recipient block
    recv_data = [
        [Paragraph('수 신', body_bold), Paragraph('루미의원 (더클리닉루미)', body)],
        [Paragraph('주 소', body_bold), Paragraph('서울 송파구 백제고분로 204 5,6층', body)],
        [Paragraph('사업자번호', body_bold), Paragraph('119-36-00735', body)],
    ]
    recv_tbl = Table(recv_data, colWidths=[30*mm, 140*mm])
    recv_tbl.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (0,-1), colors.HexColor('#F2F2F2')),
        ('BOX', (0,0), (-1,-1), 0.5, colors.grey),
        ('INNERGRID', (0,0), (-1,-1), 0.25, colors.grey),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('LEFTPADDING', (0,0), (-1,-1), 6),
        ('RIGHTPADDING', (0,0), (-1,-1), 6),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
    ]))
    story.append(recv_tbl)
    story.append(Spacer(1, 12))

    # Project name
    story.append(Paragraph(
        '<b>프로젝트명:</b> 루미클리닉 경영 관리 프로그램(Admin Portal) 구축 및 운영', body_bold))
    story.append(Spacer(1, 8))

    # Total amount box
    total_tbl = Table(
        [[Paragraph('<b>총 견적금액:</b>  금 삼천만원정 (₩30,000,000)  (VAT 별도)',
                    center_big)]],
        colWidths=[170*mm]
    )
    total_tbl.setStyle(TableStyle([
        ('BOX', (0,0), (-1,-1), 0.8, colors.black),
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#FAF6EE')),
        ('TOPPADDING', (0,0), (-1,-1), 8),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
    ]))
    story.append(total_tbl)
    story.append(Spacer(1, 14))

    # Details header
    story.append(Paragraph('■ 세부 내역', h2))

    items = [
        ['No', '항목', '상세 내용', '금액'],
        ['1', '프로젝트 기획 및 UI/UX 설계',
         '업무 분석, 화면 설계, 반응형 디자인', '₩3,000,000'],
        ['2', '매출 관리 모듈 개발',
         '진료의별·담당직원별·일본인 매출 분석, 객단가/점유율, 월별 추이', '₩5,500,000'],
        ['3', '지출 관리 모듈 개발',
         '카드명세서 자동 파싱(PDF/Excel), 비용 카테고리, 증빙 업로드', '₩4,500,000'],
        ['4', '직원/근태 관리 모듈 개발',
         '출퇴근 기록, 급여·인센티브 산정, 생일/근속 알림', '₩4,000,000'],
        ['5', '재고 관리 모듈 개발',
         '입출고/소진 관리, 재고 알람, 시술 연동', '₩2,500,000'],
        ['6', '손익 리포트 및 대시보드',
         '월별 P&amp;L, 손익 분석, 경영 KPI 시각화(Chart.js)', '₩3,000,000'],
        ['7', '백엔드 및 인증 시스템',
         'Firebase Auth/Firestore/Functions, 권한 관리, 데이터 보안', '₩3,500,000'],
        ['8', '데이터 마이그레이션 및 배포',
         '기존 데이터 이관, 도메인/호스팅 셋업, 관리자 교육', '₩2,000,000'],
        ['9', '유지보수 (4개월)',
         '버그 수정, 기능 개선, 보안 업데이트', '₩2,000,000'],
    ]

    detail_data = []
    detail_data.append([
        Paragraph(f'<b>{c}</b>', ParagraphStyle('th', parent=body_bold, alignment=1))
        for c in items[0]
    ])
    for row in items[1:]:
        detail_data.append([
            Paragraph(row[0], ParagraphStyle('c', parent=body, alignment=1)),
            Paragraph(row[1], body),
            Paragraph(row[2], body),
            Paragraph(row[3], ParagraphStyle('r', parent=body, alignment=2)),
        ])
    detail_data.append([
        Paragraph('', body),
        Paragraph('<b>합 계</b>', ParagraphStyle('th', parent=body_bold, alignment=1)),
        Paragraph('', body),
        Paragraph('<b>₩30,000,000</b>',
                  ParagraphStyle('r', parent=body_bold, alignment=2)),
    ])

    detail_tbl = Table(detail_data, colWidths=[12*mm, 50*mm, 75*mm, 33*mm])
    detail_tbl.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#EEEAE0')),
        ('BACKGROUND', (0,-1), (-1,-1), colors.HexColor('#F7F4EC')),
        ('SPAN', (1,-1), (2,-1)),
        ('BOX', (0,0), (-1,-1), 0.5, colors.grey),
        ('INNERGRID', (0,0), (-1,-1), 0.25, colors.grey),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('LEFTPADDING', (0,0), (-1,-1), 5),
        ('RIGHTPADDING', (0,0), (-1,-1), 5),
        ('TOPPADDING', (0,0), (-1,-1), 5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 5),
    ]))
    story.append(detail_tbl)
    story.append(Spacer(1, 14))

    # Payment terms
    story.append(Paragraph('■ 납부 조건', h2))
    for line in [
        '• 계약 기간: 2026년 6월 1일 ~ 2026년 9월 30일 (4개월)',
        '• 납부 방식: 월 750만원 × 4회 분할 납부',
        '• 세금계산서: 매월 발행 예정',
        '• 유지보수: 계약기간 내 포함, 이후 별도 계약',
    ]:
        story.append(Paragraph(line, body))
    story.append(Spacer(1, 14))

    # Scope notes
    story.append(Paragraph('■ 주요 개발 범위', h2))
    for line in [
        '• 매출/지출/직원/재고/손익 통합 관리 Admin Portal',
        '• 외부 데이터(카드명세서·진료 매출 엑셀) 자동 업로드 및 파싱',
        '• 클리닉 전용 인센티브·일본인 환자 분석 등 맞춤 로직 반영',
        '• Firebase 기반 실시간 데이터베이스 및 권한 관리',
        '• 관리자 권한별 접근 제어 및 운영자 매뉴얼 제공',
    ]:
        story.append(Paragraph(line, body))
    story.append(Spacer(1, 14))

    # Issuer
    story.append(Paragraph('■ 견적 발행처', h2))
    issuer = [
        ['상 호', '(주)루미드림'],
        ['대표자', '박신영'],
        ['사업자번호', '565-87-01749'],
        ['주 소', '경기도 용인시 기흥구 강남서로 9, 7층 703-A1044호(구갈동, 아카데미프라자)'],
        ['연락처', '010.4140.1101'],
    ]
    issuer_tbl = Table(
        [[Paragraph(f'<b>{k}</b>', body_bold), Paragraph(v, body)] for k, v in issuer],
        colWidths=[30*mm, 140*mm]
    )
    issuer_tbl.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (0,-1), colors.HexColor('#F2F2F2')),
        ('BOX', (0,0), (-1,-1), 0.5, colors.grey),
        ('INNERGRID', (0,0), (-1,-1), 0.25, colors.grey),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('LEFTPADDING', (0,0), (-1,-1), 6),
        ('RIGHTPADDING', (0,0), (-1,-1), 6),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
    ]))
    story.append(issuer_tbl)
    story.append(Spacer(1, 18))

    story.append(Paragraph('(주)루미드림  대표  박신영',
                           ParagraphStyle('sign', parent=body_bold,
                                          fontSize=12, alignment=2)))

    doc.build(story)
    print('Wrote', out)


if __name__ == '__main__':
    build()
