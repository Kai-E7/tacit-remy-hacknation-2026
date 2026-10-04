"""Render three lean, presentation-sized technical walkthrough slides."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.utils import ImageReader

OUT = Path("output/pdf/tacit-technical-architecture.pdf")
REMY = Path("public/brand/remy-companion-v2.png")
EXAMPLE_SCREEN = Path("public/demo-evidence/quote-1.jpg")
OUT.parent.mkdir(parents=True, exist_ok=True)
W, H = landscape(A4)
PAPER = HexColor("#F7F4EE")
FOREST = HexColor("#193C32")
INK = HexColor("#233C34")
MUTED = HexColor("#647269")
SAGE = HexColor("#E4EBE0")
LINE = HexColor("#D5DED2")
CLAY = HexColor("#B66C50")

c = canvas.Canvas(str(OUT), pagesize=(W, H))
c.setTitle("Tacit / Remy - Technical walkthrough")
c.setAuthor("Tacit / AI Apprentice hackathon")
c.setFillColor(PAPER)
c.rect(0, 0, W, H, fill=1, stroke=0)

def label(x, y, text, size=9, color=INK, font="Helvetica"):
    c.setFont(font, size)
    c.setFillColor(color)
    c.drawString(x, y, text)

def flow_card(x, y, w, h, stack, title, caption):
    c.setFillColor(SAGE)
    c.setStrokeColor(LINE)
    c.roundRect(x, y, w, h, 13, fill=1, stroke=1)
    label(x + 16, y + h - 34, stack, 10.5, CLAY, "Helvetica-Bold")
    label(x + 16, y + h - 102, title, 22, FOREST, "Helvetica-Bold")
    label(x + 16, y + h - 134, caption, 12.5, INK)

def arrow(x1, y, x2):
    c.setStrokeColor(FOREST)
    c.setFillColor(FOREST)
    c.setLineWidth(1.7)
    c.line(x1, y, x2 - 7, y)
    path = c.beginPath()
    path.moveTo(x2 - 7, y + 4)
    path.lineTo(x2, y)
    path.lineTo(x2 - 7, y - 4)
    path.close()
    c.drawPath(path, fill=1, stroke=0)

def remy_bubble():
    """Use the same portrait as the app, clipped like a small presenter bubble."""
    x, y, radius = 779, 61, 28
    image = ImageReader(str(REMY))
    c.saveState()
    clip = c.beginPath()
    clip.circle(x, y, radius)
    c.clipPath(clip, stroke=0, fill=0)
    c.drawImage(image, x - radius, y - radius, 2 * radius, 2 * radius)
    c.restoreState()
    c.setStrokeColor(FOREST)
    c.setLineWidth(1.5)
    c.circle(x, y, radius, fill=0, stroke=1)

def page_base(title, subtitle):
    c.setFillColor(PAPER)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    label(40, 554, "TACIT  /  REMY", 10, CLAY, "Helvetica-Bold")
    label(40, 514, title, 35, FOREST, "Times-Roman")
    label(40, 484, subtitle, 14, MUTED)

def panel(x, y, w, h, fill=HexColor("#FFFDF8")):
    c.setFillColor(fill)
    c.setStrokeColor(LINE)
    c.roundRect(x, y, w, h, 11, fill=1, stroke=1)

def image_contain(path, x, y, w, h):
    image = ImageReader(str(path))
    iw, ih = image.getSize()
    scale = min(w / iw, h / ih)
    dw, dh = iw * scale, ih * scale
    c.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)

def process_step(x, y, number, app, title, subtitle="", decision=False):
    fill = HexColor("#FBF1E0") if decision else SAGE
    c.setFillColor(fill)
    c.setStrokeColor(HexColor("#E2CBA6") if decision else LINE)
    c.roundRect(x, y, 90, 110, 9, fill=1, stroke=1)
    label(x + 10, y + 87, number, 9, CLAY, "Helvetica-Bold")
    label(x + 10, y + 69, app, 9.5, FOREST, "Helvetica-Bold")
    label(x + 10, y + 40, title, 12.5, INK, "Helvetica-Bold")
    if subtitle:
        label(x + 10, y + 24, subtitle, 12.5, INK, "Helvetica-Bold")

def footer(number, message):
    c.setStrokeColor(LINE)
    c.line(40, 100, 801, 100)
    label(40, 65, message, 11, MUTED)
    label(701, 32, f"{number} / 02", 9, MUTED)
    remy_bubble()

page_base("Technical walkthrough", "How Remy learns - and teaches")
label(40, 442, "FOUR STEPS  /  ONE SOURCE-LINKED LOOP", 10, CLAY, "Helvetica-Bold")
flow_card(40, 224, 173, 195, "NEXT.JS + ELEVENLABS", "Capture", "Screen + voice")
flow_card(234, 224, 173, 195, "PRESIDIO + OCR + SHARP", "Protect", "Best-effort redaction")
flow_card(428, 224, 173, 195, "ANTHROPIC CLAUDE", "Understand", "Steps + reasons")
flow_card(622, 224, 179, 195, "REACT FLOW / INDEXEDDB", "Guide", "Approved Work Map")
arrow(214, 322, 232)
arrow(408, 322, 426)
arrow(602, 322, 620)

panel(40, 122, 761, 73)
label(57, 161, "EXPERT APPROVAL", 11, CLAY, "Helvetica-Bold")
label(238, 158, "Remy guides a learner and checks before saving", 17, FOREST, "Helvetica-Bold")
label(40, 82, "Deployment: Sliplane   /   Cloud sync: Supabase live", 11, INK)
label(40, 63, "Synthetic demo data. Privacy checks are best effort.", 10, MUTED)
label(701, 32, "01 / 02", 9, MUTED)
remy_bubble()

c.showPage()

# Page 2: complete synthetic process, distilled from the app's four source-linked steps.
page_base("From observation to guidance", "One complete Notion-to-Outlook workflow")
panel(40, 133, 246, 337)
label(56, 444, "EXPERT INPUT", 10.5, CLAY, "Helvetica-Bold")
label(56, 414, "Screen + voice", 20, FOREST, "Helvetica-Bold")
panel(52, 235, 222, 165, HexColor("#F5F7F2"))
image_contain(EXAMPLE_SCREEN, 57, 243, 212, 149)
label(56, 206, "Notion CRM example", 13, FOREST, "Helvetica-Bold")
label(56, 182, "Expert explains the why", 11, MUTED)

panel(306, 133, 495, 337)
label(322, 444, "REMY OUTPUT", 10.5, CLAY, "Helvetica-Bold")
label(322, 414, "Source-linked process", 20, FOREST, "Helvetica-Bold")
process_step(323, 268, "01", "Notion", "Open CRM")
process_step(446, 268, "02", "Notion", "Adapt", "template")
process_step(569, 268, "03", "Sales Lead", "Approve", "discount", decision=True)
process_step(692, 268, "04", "Outlook", "Send", "proposal")
arrow(414, 323, 444)
arrow(537, 323, 567)
arrow(660, 323, 690)
label(585, 386, ">10% only", 9, CLAY, "Helvetica-Bold")
c.setStrokeColor(MUTED)
c.setLineWidth(1)
c.line(491, 267, 491, 242)
c.line(491, 242, 737, 242)
c.line(737, 242, 737, 260)
c.setFillColor(MUTED)
branch = c.beginPath()
branch.moveTo(733, 260)
branch.lineTo(737, 268)
branch.lineTo(741, 260)
branch.close()
c.drawPath(branch, fill=1, stroke=0)
label(539, 222, "Discount <= 10%: skip approval", 10, MUTED)
label(322, 179, "Click a step for its screenshot and expert rationale", 11, INK)
footer("02", "Synthetic case  |  expert review before tutoring")

c.showPage()
c.save()
print(OUT)
