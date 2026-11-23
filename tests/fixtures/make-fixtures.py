"""Builds the small TEST-ONLY fixtures used by tests/pc-import-browser-check.js. No real clinical content. Run: python3 tests/fixtures/make-fixtures.py"""
import io, os
from reportlab.lib.pagesizes import A5
from reportlab.pdfgen import canvas
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from PIL import Image, ImageDraw, ImageFont
from pypdf import PdfReader, PdfWriter
import docx

HERE = os.path.dirname(os.path.abspath(__file__))
P = lambda n: os.path.join(HERE, n)

# ---------- text.pdf: running header, page numbers, two chapters, a table, a paragraph that crosses a page
ss = getSampleStyleSheet()
body = ParagraphStyle("b", parent=ss["Normal"], fontSize=10, leading=12.5, spaceAfter=5)
h1 = ParagraphStyle("h1", parent=ss["Normal"], fontSize=18, leading=22, spaceAfter=8, fontName="Helvetica-Bold")
h2 = ParagraphStyle("h2", parent=ss["Normal"], fontSize=13, leading=16, spaceAfter=6, fontName="Helvetica-Bold")
def deco(c, d):
    c.saveState(); c.setFont("Helvetica", 7); c.drawString(30, A5[1] - 20, "Test Guideline Handbook 2023"); c.setFont("Helvetica", 9); c.drawCentredString(A5[0] / 2, 18, str(d.page)); c.restoreState()
doc = SimpleDocTemplate(P("text.pdf"), pagesize=A5, leftMargin=34, rightMargin=34, topMargin=42, bottomMargin=40, title="Test text pdf")
S = []
S += [Paragraph("Test Chapter One", h1), Paragraph("TEST TEXT ONLY. This is the first paragraph of chapter one and it is used to check that normal body text is read in order.", body), Paragraph("Second paragraph of chapter one. It has a few more words so that it wraps over more than one line on the small test page.", body)]
S += [Paragraph("Section 1.1 Test table", h2)]
t = Table([["Item", "Test note"], ["Alpha", "first test note"], ["Beta", "second test note"], ["Gamma", "third test note"]], colWidths=[90, 170])
t.setStyle(TableStyle([("FONTSIZE", (0, 0), (-1, -1), 10), ("GRID", (0, 0), (-1, -1), 0.3, colors.grey)])); S += [t, Spacer(1, 8)]
for i in range(40): S.append(Paragraph("Filler paragraph %d for chapter one. TEST TEXT ONLY. It carries on so that the text runs onto the following pages of this small test document." % (i + 1), body))
S += [PageBreak(), Paragraph("Test Chapter Two", h1), Paragraph("TEST TEXT ONLY. First paragraph of chapter two.", body)]
for i in range(24): S.append(Paragraph("Chapter two filler paragraph %d. TEST TEXT ONLY and more text to fill the page for the layout check." % (i + 1), body))
doc.build(S, onFirstPage=deco, onLaterPages=deco)

# ---------- scanned pages (image only): large clean synthetic text
def scan(lines, path_png):
    img = Image.new("L", (1240, 1754), 255); d = ImageDraw.Draw(img)
    f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 34); y = 160
    for ln in lines: d.text((120, y), ln, fill=0, font=f); y += 62
    img.save(path_png)
scan(["Scanned test page one.", "", "The quick brown fox jumps over the lazy dog.", "This page is an image with no text layer.", "TEST TEXT ONLY."], "/tmp/scan1.png")
scan(["Scanned test page two.", "", "Pack my box with five dozen liquor jugs.", "Second paragraph of the scanned page.", "TEST TEXT ONLY."], "/tmp/scan2.png")
import img2pdf
with open(P("scanned.pdf"), "wb") as fh: fh.write(img2pdf.convert(["/tmp/scan1.png", "/tmp/scan2.png"]))

# ---------- mixed.pdf: text page, scanned page, text page
def one_text_page(txt):
    b = io.BytesIO(); c = canvas.Canvas(b, pagesize=A5); c.setFont("Helvetica", 10)
    y = A5[1] - 60
    for ln in txt: c.drawString(34, y, ln); y -= 12.5
    c.save(); b.seek(0); return PdfReader(b).pages[0]
w = PdfWriter(); w.add_page(one_text_page(["Mixed test page one has a real text layer.", "TEST TEXT ONLY."]))
w.add_page(PdfReader(P("scanned.pdf")).pages[0]); w.add_page(one_text_page(["Mixed test page three has a real text layer again.", "TEST TEXT ONLY."]))
with open(P("mixed.pdf"), "wb") as fh: w.write(fh)

# ---------- password protected
w = PdfWriter(); w.append(PdfReader(P("text.pdf"))); w.encrypt("secret")
with open(P("locked.pdf"), "wb") as fh: w.write(fh)

# ---------- test.docx: headings, paragraph, list, table, picture
dd = docx.Document()
dd.add_heading("Test Word Document", level=1); dd.add_paragraph("TEST TEXT ONLY. A first paragraph in the Word file.")
dd.add_heading("Test section", level=2); dd.add_paragraph("A bullet item one", style="List Bullet"); dd.add_paragraph("A bullet item two", style="List Bullet")
tb = dd.add_table(rows=3, cols=2); tb.style = "Table Grid"
for r, (a, b) in enumerate([("Item", "Test note"), ("Alpha", "first test note"), ("Beta", "second test note")]): tb.cell(r, 0).text = a; tb.cell(r, 1).text = b
Image.new("RGB", (40, 40), (200, 30, 30)).save("/tmp/pic.png"); dd.add_picture("/tmp/pic.png")
dd.add_paragraph("Paragraph after the table and picture.")
dd.save(P("test.docx"))
print("fixtures written:", sorted(os.listdir(HERE)))
