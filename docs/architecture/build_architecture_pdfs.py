from pathlib import Path
from lxml import etree
from weasyprint import HTML

ROOT = Path(__file__).resolve().parent
XML = ROOT / 'agentos-platform-architecture.xml'
XSL = ROOT / 'agentos-platform-architecture.xsl'
OUT = ROOT / 'output'
OUT.mkdir(exist_ok=True)

xml_doc = etree.parse(str(XML))
xsl_doc = etree.parse(str(XSL))
transform = etree.XSLT(xsl_doc)
brief_html = str(transform(xml_doc))
(OUT / 'agentos-platform-architecture.html').write_text(brief_html, encoding='utf-8')
HTML(string=brief_html, base_url=str(ROOT)).write_pdf(str(OUT / 'agentos-platform-architecture-brief.pdf'))

# A compact board-oriented PDF, generated from the same XML source.
root = xml_doc.getroot()
platform = root.find('platform')
partners = root.find('partnerLayer')
services = root.find('controlPlane')

def esc(value):
    return (value or '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

capability_cards = ''.join(
    f'<div class="cap"><div class="cap-title">{esc(c.get("name"))}</div>'
    f'<div class="cap-sub">{esc(c.findtext("provider", "Platform capability"))}</div>'
    f'<ul>{"".join(f"<li>{esc(x.text)}</li>" for x in c.findall("component"))}</ul></div>'
    for c in platform.findall('capability')
)
partner_rows = ''.join(
    f'<tr><td><strong>{esc(p.get("name"))}</strong></td><td>{esc(p.get("region"))}</td>'
    f'<td>{esc(p.get("sites"))}</td><td>{esc(p.get("monthlyValue"))}</td></tr>'
    for p in partners.findall('partner')
)
service_rows = ''.join(
    f'<div class="service"><strong>{esc(s.get("name"))}</strong><span>{esc(s.get("owner"))}</span></div>'
    for s in services.findall('service')
)
board_html = f'''<!doctype html><html><head><meta charset="utf-8"><style>
@page{{size:A4 landscape;margin:13mm 15mm;background:#f8fafc}}
*{{box-sizing:border-box}}body{{font-family:Inter,Arial,sans-serif;color:#172033;margin:0;background:#f8fafc}}
.page{{min-height:180mm;page-break-after:always;position:relative;padding:4mm 1mm}}
.page:last-child{{page-break-after:auto}}.kicker{{font-size:10px;text-transform:uppercase;letter-spacing:.18em;color:#2563eb;font-weight:800}}
h1{{font-size:31px;line-height:1.06;color:#0f172a;margin:9mm 0 4mm;max-width:180mm}}h2{{font-size:24px;color:#0f172a;margin:0 0 7mm}}p{{font-size:12px;line-height:1.5;max-width:240mm}}
.hero{{background:linear-gradient(135deg,#0f172a,#172554 60%,#0f766e);color:#fff;border-radius:5mm;padding:16mm;min-height:155mm}}
.hero h1{{color:#fff;max-width:230mm}}.hero p{{color:#dbeafe;max-width:210mm}}.tag{{display:inline-block;margin-top:15mm;border:1px solid #93c5fd;padding:3mm 5mm;font-size:11px;color:#dbeafe}}
.cards{{display:grid;grid-template-columns:repeat(3,1fr);gap:6mm}}.cap{{background:#fff;border-top:4px solid #2563eb;padding:6mm;min-height:60mm;box-shadow:0 2px 5px #dbe3ed}}.cap:nth-child(2){{border-color:#0f766e}}.cap:nth-child(3){{border-color:#d97706}}.cap-title{{font-weight:800;font-size:17px;color:#0f172a}}.cap-sub{{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.08em;margin-top:2mm}}ul{{font-size:11px;line-height:1.55;margin-top:5mm;padding-left:5mm}}
.layer{{display:grid;grid-template-columns:1fr 1fr;gap:8mm;align-items:stretch}}.layer-box{{background:#fff;border:1px solid #cbd5e1;padding:7mm;min-height:70mm}}.layer-box h3{{margin:0 0 3mm;color:#0f172a;font-size:16px}}.layer-box p{{font-size:11px}}.pill{{display:inline-block;background:#eff6ff;color:#1d4ed8;padding:2mm 3mm;margin:1.5mm;font-size:10px;font-weight:700}}
table{{width:100%;border-collapse:collapse;background:#fff;font-size:11px}}th{{background:#0f172a;color:#fff;text-align:left;padding:4mm}}td{{padding:4mm;border-bottom:1px solid #e2e8f0}}.service-grid{{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm}}.service{{background:#fff;border-left:4px solid #0f766e;padding:4mm;min-height:23mm}}.service span{{display:block;color:#64748b;font-size:10px;margin-top:2mm}}.quote{{border-left:5px solid #d97706;background:#fffbeb;padding:6mm;font-size:14px;line-height:1.45;margin-top:9mm}}.footer{{position:absolute;bottom:2mm;left:1mm;color:#64748b;font-size:9px}}
</style></head><body>
<section class="page"><div class="hero"><div class="kicker">AgentOS Platform HQ · br3eze.africa</div><h1>Partner bots are the operating edge of a centrally governed platform.</h1><p>AgentOS combines AI operations, billing, hardware inventory, tenant-scoped partner bots, and administrator policy into one control plane.</p><div class="tag">Concept architecture · supplied figures are illustrative</div></div><div class="footer">Partner and admin control architecture</div></section>
<section class="page"><div class="kicker">01 · Platform core</div><h2>Shared capabilities create leverage across every tenant.</h2><div class="cards">{capability_cards}</div><div class="quote">AgentOS owns the runtime, policy, settlement, and audit boundaries. Partners receive capabilities inside an explicit tenant scope.</div><div class="footer">AgentOS Platform HQ</div></section>
<section class="page"><div class="kicker">02 · Tenant economics</div><h2>White-label partners operate regional service networks.</h2><table><thead><tr><th>Partner</th><th>Region</th><th>Sites</th><th>Illustrative monthly value</th></tr></thead><tbody>{partner_rows}</tbody></table><p style="margin-top:9mm">The same model supports connectivity, CCTV, network operations, hardware distribution, and AI-assisted field support while keeping commercial records tenant-scoped.</p><div class="footer">Values shown exactly as supplied; not audited financial statements.</div></section>
<section class="page"><div class="kicker">03 · Governance</div><h2>Admin control protects the partner layer.</h2><div class="service-grid">{service_rows}</div><div class="layer" style="margin-top:9mm"><div class="layer-box"><h3>Partner bot</h3><p>Branded Telegram experience for approved plans, customer service, stock, wallet views, and payment initiation.</p><span class="pill">Partner-scoped</span><span class="pill">Short-lived state</span><span class="pill">No raw credentials</span></div><div class="layer-box"><h3>Admin plane</h3><p>Tenant lifecycle, RBAC, regional assignments, pricing policy, settlement, reconciliation, and audit review.</p><span class="pill">Platform-owned</span><span class="pill">Policy-enforced</span><span class="pill">Auditable</span></div></div><div class="footer">AgentOS control-plane boundary</div></section>
</body></html>'''
(OUT / 'agentos-partner-admin-control-model.html').write_text(board_html, encoding='utf-8')
HTML(string=board_html, base_url=str(ROOT)).write_pdf(str(OUT / 'agentos-partner-admin-control-model.pdf'))
print(f'Generated {OUT / "agentos-platform-architecture-brief.pdf"}')
print(f'Generated {OUT / "agentos-partner-admin-control-model.pdf"}')
