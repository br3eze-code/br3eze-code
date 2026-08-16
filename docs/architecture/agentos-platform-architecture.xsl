<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html" encoding="UTF-8" indent="yes" />
  <xsl:template match="/">
    <html>
      <head>
        <meta charset="UTF-8" />
        <title><xsl:value-of select="agentosArchitecture/metadata/title" /></title>
        <style>
          @page { size: A4; margin: 18mm 16mm 18mm 16mm; }
          :root { --navy:#0f172a; --blue:#2563eb; --teal:#0f766e; --amber:#d97706; --ink:#1e293b; --muted:#64748b; --line:#cbd5e1; --wash:#f8fafc; }
          * { box-sizing:border-box; }
          body { margin:0; font-family: Inter, Arial, sans-serif; color:var(--ink); background:white; }
          .cover { min-height:250mm; display:flex; flex-direction:column; justify-content:space-between; padding:18mm; background:linear-gradient(135deg,#0f172a 0%,#172554 55%,#0f766e 100%); color:white; page-break-after:always; }
          .eyebrow { text-transform:uppercase; letter-spacing:.16em; font-size:10px; color:#93c5fd; font-weight:700; }
          h1 { font-size:38px; line-height:1.05; max-width:170mm; margin:22mm 0 8mm; }
          .subtitle { font-size:17px; line-height:1.45; max-width:145mm; color:#dbeafe; }
          .cover-footer { display:flex; justify-content:space-between; border-top:1px solid rgba(255,255,255,.3); padding-top:5mm; font-size:10px; color:#cbd5e1; }
          h2 { color:var(--navy); font-size:23px; margin:0 0 5mm; }
          h3 { color:var(--navy); font-size:15px; margin:0 0 3mm; }
          p { font-size:10.5px; line-height:1.55; margin:0 0 4mm; }
          .section { page-break-inside:avoid; margin-bottom:9mm; }
          .grid3 { display:grid; grid-template-columns:repeat(3,1fr); gap:5mm; }
          .capability { min-height:42mm; border-top:4px solid var(--blue); background:var(--wash); padding:5mm; }
          .capability.teal { border-top-color:var(--teal); }
          .capability.amber { border-top-color:var(--amber); }
          .label { color:var(--muted); font-size:9px; text-transform:uppercase; letter-spacing:.08em; font-weight:700; }
          ul { margin:3mm 0 0 5mm; padding:0; font-size:10px; line-height:1.6; }
          .partner-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:4mm; }
          .partner { border:1px solid var(--line); padding:4mm; display:grid; grid-template-columns:1fr auto; gap:2mm 4mm; }
          .partner strong { color:var(--navy); }
          .partner .value { color:var(--teal); font-weight:800; text-align:right; }
          .partner .meta { color:var(--muted); font-size:9px; }
          .control { display:grid; grid-template-columns:repeat(3,1fr); gap:3mm; }
          .control div { border-left:3px solid var(--blue); background:#eff6ff; padding:3mm 4mm; font-size:10px; }
          .flow { margin-top:4mm; border:1px solid var(--line); padding:5mm; background:linear-gradient(90deg,#eff6ff,#f0fdfa); }
          .flow-row { display:flex; align-items:center; gap:4mm; margin:3mm 0; }
          .node { padding:3mm 4mm; background:white; border:1px solid var(--line); font-weight:700; font-size:10px; min-width:37mm; text-align:center; }
          .arrow { color:var(--blue); font-size:18px; font-weight:800; }
          .note { border-left:4px solid var(--amber); background:#fffbeb; padding:4mm; font-size:9.5px; line-height:1.5; }
          .footer { border-top:1px solid var(--line); margin-top:8mm; padding-top:3mm; color:var(--muted); font-size:8.5px; }
        </style>
      </head>
      <body>
        <section class="cover">
          <div>
            <div class="eyebrow">AgentOS Platform HQ</div>
            <h1><xsl:value-of select="agentosArchitecture/metadata/title" /></h1>
            <div class="subtitle">A domain-agnostic control plane for AI operations, partner-led commerce, managed connectivity, CCTV, and hardware distribution.</div>
          </div>
          <div class="cover-footer"><span><xsl:value-of select="agentosArchitecture/metadata/owner" /></span><span>Architecture brief · conceptual model</span></div>
        </section>
        <main>
          <section class="section">
            <h2>1. Platform capabilities</h2>
            <p>AgentOS concentrates the shared platform capabilities while keeping partner operations tenant-scoped. The platform owns the control plane, policy, settlement, and audit boundaries.</p>
            <div class="grid3">
              <xsl:for-each select="agentosArchitecture/platform/capability">
                <div class="capability">
                  <xsl:attribute name="class">capability <xsl:choose><xsl:when test="@id='billing'">teal</xsl:when><xsl:when test="@id='hardware'">amber</xsl:when><xsl:otherwise>blue</xsl:otherwise></xsl:choose></xsl:attribute>
                  <div class="label">Shared capability</div><h3><xsl:value-of select="@name" /></h3>
                  <xsl:if test="provider"><p><strong>Provider:</strong> <xsl:value-of select="provider" /></p></xsl:if>
                  <ul><xsl:for-each select="component"><li><xsl:value-of select="." /></li></xsl:for-each></ul>
                </div>
              </xsl:for-each>
            </div>
          </section>
          <section class="section">
            <h2>2. White-label partner layer</h2>
            <p>Each partner is an isolated tenant with its own regional operating footprint, sites, commercial ledger, and customer relationships. The values below are illustrative planning figures from the supplied architecture.</p>
            <div class="partner-grid">
              <xsl:for-each select="agentosArchitecture/partnerLayer/partner">
                <div class="partner"><strong><xsl:value-of select="@name" /></strong><span class="value"><xsl:value-of select="@monthlyValue" /></span><span class="meta"><xsl:value-of select="@region" /> · <xsl:value-of select="@sites" /> sites</span><span class="meta">Illustrative monthly value</span></div>
              </xsl:for-each>
            </div>
          </section>
          <section class="section">
            <h2>3. AgentOS control plane</h2>
            <div class="control"><xsl:for-each select="agentosArchitecture/controlPlane/service"><div><strong><xsl:value-of select="@name" /></strong><br /><span class="meta">Owner: <xsl:value-of select="@owner" /></span></div></xsl:for-each></div>
          </section>
          <section class="section">
            <h2>4. Value and data flows</h2>
            <div class="flow">
              <xsl:for-each select="agentosArchitecture/flows/flow"><div class="flow-row"><div class="node"><xsl:value-of select="@from" /></div><div class="arrow">→</div><div class="node"><xsl:value-of select="@to" /></div><div><xsl:value-of select="@label" /></div></div></xsl:for-each>
            </div>
          </section>
          <section class="section">
            <h2>5. Operating boundary</h2>
            <div class="note"><strong>AgentOS owns the runtime and policy.</strong> Partners operate inside their assigned tenant scope. Admins manage partner lifecycle, roles, approved plans, payment credentials, settlement, regional scope, and auditability. End customers receive the partner-facing services without receiving platform control-plane access.</div>
          </section>
          <div class="footer"><xsl:value-of select="agentosArchitecture/metadata/note" /></div>
        </main>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
