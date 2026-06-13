"""Generate Windows 실행 가이드 PDF."""
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Preformatted,
)

pdfmetrics.registerFont(TTFont('NanumKR',
    '/usr/share/fonts/truetype/nanum/NanumBarunGothic.ttf'))
pdfmetrics.registerFont(TTFont('NanumKR-Bold',
    '/usr/share/fonts/truetype/nanum/NanumBarunGothicBold.ttf'))
pdfmetrics.registerFont(TTFont('NanumMono',
    '/usr/share/fonts/truetype/nanum/NanumGothicCoding.ttf'))
registerFontFamily('NanumKR', normal='NanumKR', bold='NanumKR-Bold',
                   italic='NanumKR', boldItalic='NanumKR-Bold')

KFONT = 'NanumKR'
KFONT_BOLD = 'NanumKR-Bold'
KMONO = 'NanumMono'


def build():
    out = '/home/user/lumi-admin/quote/견적서_생성_가이드_Windows.pdf'
    doc = SimpleDocTemplate(
        out, pagesize=A4,
        leftMargin=20*mm, rightMargin=20*mm,
        topMargin=18*mm, bottomMargin=18*mm,
        title='견적서 PDF 생성 가이드 (Windows)',
    )

    styles = getSampleStyleSheet()
    title = ParagraphStyle('Title', parent=styles['Title'],
                           fontName=KFONT_BOLD, fontSize=20, leading=26,
                           alignment=1, spaceAfter=4)
    sub = ParagraphStyle('Sub', parent=styles['Normal'],
                         fontName=KFONT, fontSize=11, leading=16,
                         alignment=1, textColor=colors.HexColor('#666666'),
                         spaceAfter=14)
    h2 = ParagraphStyle('H2', parent=styles['Heading2'],
                        fontName=KFONT_BOLD, fontSize=13, leading=20,
                        textColor=colors.HexColor('#1a3a6e'),
                        spaceBefore=14, spaceAfter=6)
    h3 = ParagraphStyle('H3', parent=styles['Heading3'],
                        fontName=KFONT_BOLD, fontSize=11, leading=17,
                        spaceBefore=8, spaceAfter=4)
    body = ParagraphStyle('Body', parent=styles['BodyText'],
                          fontName=KFONT, fontSize=10, leading=16)
    body_b = ParagraphStyle('BodyB', parent=body, fontName=KFONT_BOLD)
    note = ParagraphStyle('Note', parent=body, fontSize=9, leading=14,
                          textColor=colors.HexColor('#555555'))
    code_style = ParagraphStyle('Code', parent=styles['Code'],
                                fontName=KMONO, fontSize=9, leading=13,
                                leftIndent=0, backColor=colors.HexColor('#F4F4F4'),
                                borderColor=colors.HexColor('#DDDDDD'),
                                borderWidth=0.5, borderPadding=6,
                                spaceBefore=4, spaceAfter=8)

    story = []

    story.append(Paragraph('견적서 PDF 생성 가이드', title))
    story.append(Paragraph('Windows 환경 기준 · generate_quote.py 실행 방법', sub))

    # 개요
    story.append(Paragraph('■ 개요', h2))
    story.append(Paragraph(
        '<b>quote/generate_quote.py</b> 는 ReportLab 라이브러리와 나눔바른고딕 폰트를 사용해 '
        '루미의원 경영관리 프로그램 견적서 PDF를 자동으로 생성하는 Python 스크립트입니다. '
        '아래 순서대로 한 번만 환경을 셋업해 두면, 이후에는 명령 한 줄로 PDF를 다시 만들 수 있습니다.',
        body))

    # STEP 1
    story.append(Paragraph('STEP 1. Python 설치 (최초 1회)', h2))
    story.append(Paragraph(
        '① 공식 사이트에서 Python 설치 파일을 다운로드합니다.', body))
    story.append(Preformatted('https://www.python.org/downloads/windows/',
                              code_style))
    story.append(Paragraph(
        '② 설치 마법사 첫 화면에서 <b>"Add Python to PATH"</b> 체크박스를 반드시 켠 뒤 '
        '"Install Now" 를 누릅니다. (체크를 안 하면 명령 프롬프트에서 python 명령이 인식되지 않습니다.)',
        body))
    story.append(Paragraph(
        '③ 설치 완료 후 명령 프롬프트(cmd)를 새로 열어 아래 명령으로 버전이 출력되는지 확인합니다.',
        body))
    story.append(Preformatted('python --version', code_style))

    # STEP 2
    story.append(Paragraph('STEP 2. 나눔 폰트 설치 (최초 1회)', h2))
    story.append(Paragraph(
        '스크립트가 한글을 표시하려면 <b>나눔바른고딕</b> TTF 파일이 필요합니다.',
        body))
    story.append(Paragraph(
        '① 아래 링크에서 "나눔 글꼴 모음"을 다운로드합니다.', body))
    story.append(Preformatted(
        'https://hangeul.naver.com/font  (네이버 한글한글 아름답게)', code_style))
    story.append(Paragraph(
        '② 압축을 풀고 <b>NanumBarunGothic.ttf</b>, <b>NanumBarunGothicBold.ttf</b>, '
        '<b>NanumGothicCoding.ttf</b> 세 파일을 더블클릭한 뒤 "설치" 버튼을 눌러 시스템에 설치합니다.',
        body))
    story.append(Paragraph(
        '③ 설치 후 윈도우 폰트 경로는 일반적으로 아래와 같습니다 (스크립트에서 참조하는 경로).',
        body))
    story.append(Preformatted(
        'C:\\Windows\\Fonts\\NanumBarunGothic.ttf\n'
        'C:\\Windows\\Fonts\\NanumBarunGothicBold.ttf',
        code_style))

    # STEP 3
    story.append(Paragraph('STEP 3. ReportLab 라이브러리 설치 (최초 1회)', h2))
    story.append(Paragraph(
        '명령 프롬프트(cmd) 또는 PowerShell 을 열고 아래 명령을 실행합니다.', body))
    story.append(Preformatted('pip install reportlab', code_style))
    story.append(Paragraph(
        '"Successfully installed reportlab-…" 메시지가 나오면 정상입니다.', note))

    # STEP 4
    story.append(Paragraph('STEP 4. 스크립트 폰트 경로 수정 (Windows 1회)', h2))
    story.append(Paragraph(
        '<b>quote/generate_quote.py</b> 를 메모장 또는 VS Code 로 열어 상단의 폰트 경로 3줄을 '
        'Windows 경로로 바꿔 줍니다.',
        body))
    story.append(Paragraph('수정 전 (Linux 경로):', body_b))
    story.append(Preformatted(
        "pdfmetrics.registerFont(TTFont('NanumKR',\n"
        "    '/usr/share/fonts/truetype/nanum/NanumBarunGothic.ttf'))\n"
        "pdfmetrics.registerFont(TTFont('NanumKR-Bold',\n"
        "    '/usr/share/fonts/truetype/nanum/NanumBarunGothicBold.ttf'))",
        code_style))
    story.append(Paragraph('수정 후 (Windows 경로):', body_b))
    story.append(Preformatted(
        "pdfmetrics.registerFont(TTFont('NanumKR',\n"
        "    r'C:\\Windows\\Fonts\\NanumBarunGothic.ttf'))\n"
        "pdfmetrics.registerFont(TTFont('NanumKR-Bold',\n"
        "    r'C:\\Windows\\Fonts\\NanumBarunGothicBold.ttf'))",
        code_style))
    story.append(Paragraph(
        '※ 경로 앞에 <b>r</b> 을 붙이면(raw 문자열) 백슬래시(\\)를 그대로 인식합니다.', note))

    # STEP 5
    story.append(Paragraph('STEP 5. 견적서 PDF 생성', h2))
    story.append(Paragraph(
        '① 명령 프롬프트(cmd) 를 열고 저장소 폴더로 이동합니다.', body))
    story.append(Preformatted('cd C:\\path\\to\\lumi-admin', code_style))
    story.append(Paragraph(
        '② 아래 명령으로 스크립트를 실행합니다.', body))
    story.append(Preformatted('python quote\\generate_quote.py', code_style))
    story.append(Paragraph(
        '③ 정상 실행되면 아래 메시지가 출력되고, 같은 폴더에 PDF 가 생성됩니다.', body))
    story.append(Preformatted(
        'Wrote .../quote/루미의원_경영관리프로그램_견적서.pdf', code_style))

    # STEP 6
    story.append(Paragraph('STEP 6. 견적 내용 수정하기', h2))
    story.append(Paragraph(
        '금액, 기간, 항목을 바꾸고 싶다면 <b>generate_quote.py</b> 안에서 다음 위치를 직접 수정한 뒤 '
        'STEP 5 명령을 다시 실행하면 됩니다.', body))
    items_tbl = Table([
        [Paragraph('<b>수정 위치</b>', body_b), Paragraph('<b>내용</b>', body_b)],
        [Paragraph('items 리스트', body), Paragraph('세부 내역 9개 항목의 제목·설명·금액', body)],
        [Paragraph('total_tbl 블록', body), Paragraph('총 견적금액 (₩30,000,000 표기)', body)],
        [Paragraph("'■ 납부 조건' 아래", body), Paragraph('계약 기간, 분할 납부 조건', body)],
        [Paragraph("'■ 견적 발행처' 아래", body), Paragraph('발행처 회사 정보', body)],
        [Paragraph('meta_tbl 블록', body), Paragraph('견적일자, 견적번호', body)],
    ], colWidths=[55*mm, 115*mm])
    items_tbl.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#EEEAE0')),
        ('BOX', (0,0), (-1,-1), 0.5, colors.grey),
        ('INNERGRID', (0,0), (-1,-1), 0.25, colors.grey),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('LEFTPADDING', (0,0), (-1,-1), 6),
        ('RIGHTPADDING', (0,0), (-1,-1), 6),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
    ]))
    story.append(items_tbl)
    story.append(Spacer(1, 10))

    # 문제 해결
    story.append(Paragraph('■ 자주 발생하는 오류와 해결법', h2))
    trouble_tbl = Table([
        [Paragraph('<b>증상</b>', body_b), Paragraph('<b>원인 / 해결</b>', body_b)],
        [Paragraph("'python' is not recognized…", body),
         Paragraph('Python 설치 시 "Add Python to PATH" 체크를 누락. '
                   '재설치하거나 환경변수 PATH 에 Python 폴더를 추가.', body)],
        [Paragraph('ModuleNotFoundError: reportlab', body),
         Paragraph('STEP 3 의 pip install reportlab 을 다시 실행.', body)],
        [Paragraph('Cannot open resource …NanumBarunGothic.ttf', body),
         Paragraph('폰트 파일이 없거나 경로가 다른 경우. STEP 2 폰트 설치 확인 후 '
                   'STEP 4 의 경로를 실제 파일 경로로 맞춰 줄 것.', body)],
        [Paragraph('PDF 안의 한글이 □□□ 로 깨짐', body),
         Paragraph('폰트가 제대로 등록되지 않은 경우. 폰트 파일이 정확히 위 경로에 있는지 확인.',
                   body)],
    ], colWidths=[55*mm, 115*mm])
    trouble_tbl.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#FBEAEA')),
        ('BOX', (0,0), (-1,-1), 0.5, colors.grey),
        ('INNERGRID', (0,0), (-1,-1), 0.25, colors.grey),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('LEFTPADDING', (0,0), (-1,-1), 6),
        ('RIGHTPADDING', (0,0), (-1,-1), 6),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
    ]))
    story.append(trouble_tbl)
    story.append(Spacer(1, 14))

    # 요약
    story.append(Paragraph('■ 한눈에 보는 요약', h2))
    story.append(Preformatted(
        '# 최초 1회\n'
        '1) Python 설치  (Add Python to PATH 체크)\n'
        '2) 나눔 폰트 설치  (NanumBarunGothic / Bold / GothicCoding)\n'
        '3) pip install reportlab\n'
        '4) generate_quote.py 폰트 경로를 C:\\Windows\\Fonts\\... 로 수정\n\n'
        '# 매번 실행\n'
        'cd C:\\path\\to\\lumi-admin\n'
        'python quote\\generate_quote.py\n'
        '→ quote\\루미의원_경영관리프로그램_견적서.pdf 생성',
        code_style))

    story.append(Spacer(1, 12))
    story.append(Paragraph(
        '(주)루미드림 · 박신영',
        ParagraphStyle('foot', parent=body_b, alignment=2, fontSize=10,
                       textColor=colors.HexColor('#666666'))))

    doc.build(story)
    print('Wrote', out)


if __name__ == '__main__':
    build()
