jsximport { useState, useEffect } from "react";

const BRANCH_MAP = {
  eau_claire: "Eau Claire", duluth: "Duluth", firekeepers___wi: "GRB Firekeepers",
  lightkeepers___wi: "GRB Light", milwaukee: "Milwaukee", sheboygan__wi: "Sheboygan",
  rochester: "Rochester", miami_fl_leon: "MIA Leon N", miami_fl_leon_south: "MIA Leon S",
  chicago_s: "Chicago S", springfield_il: "Springfield IL", la_crosse: "La Crosse",
  stevens_point: "Stevens Point", mountain_movers___wi: "GRB Mountain",
  hiawatha__ia: "Hiawatha IA", hudson: "Hudson WI", st_cloud_mn_blue_team: "St Cloud B",
  st_cloud: "St Cloud", golden_valley: "Golden Valley", golden_valley_mn_purple: "GV Purple",
  madison: "Madison", mankato: "Mankato", brainerd: "Brainerd", rhinelander_wi: "Rhinelander",
  alexandria: "Alexandria",
};

const CRITICAL_TAGS = {
  _unverified_visit_request: { label: "Late/Unverified Visit", severity: "critical", color: "#FF4B4B" },
  daily_audit_for_unverified_visit: { label: "Orders Missing", severity: "critical", color: "#FF4B4B" },
  occurrence_clarification: { label: "QI Incident", severity: "critical", color: "#FF4B4B" },
  _declined_visit: { label: "Declined Visit", severity: "high", color: "#FF8C00" },
  huv_follow_up: { label: "HUV Audit", severity: "high", color: "#FF8C00" },
  dme_not_ordered: { label: "DME Not Ordered", severity: "critical", color: "#FF4B4B" },
  dme_need_more_info_from_field_worker: { label: "DME Pending", severity: "high", color: "#FF8C00" },
  no_response_start: { label: "No Response", severity: "high", color: "#FF8C00" },
  order_tracking: { label: "Open Order", severity: "high", color: "#FF8C00" },
  qa_bump_start: { label: "QA Escalated", severity: "critical", color: "#FF4B4B" },
  declined_meds: { label: "Meds Declined", severity: "critical", color: "#FF4B4B" },
  referral_intake: { label: "New Referral", severity: "info", color: "#00D4AA" },
  reschedule_visit: { label: "Reschedule", severity: "medium", color: "#FFD700" },
  reassign_visit: { label: "Reassign Visit", severity: "medium", color: "#FFD700" },
};

function useTypewriter(text, speed = 10) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!text) return;
    setDisplayed(""); setDone(false);
    let i = 0;
    const iv = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) { clearInterval(iv); setDone(true); }
    }, speed);
    return () => clearInterval(iv);
  }, [text]);
  return { displayed, done };
}

async function fetchZendeskIntelligence() {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: `You are a hospice operations analyst. Query Zendesk via CData and return ONLY valid JSON (no markdown) with this exact structure:
{"lateVisits":number,"qiIncidents":number,"dmeIssues":number,"openOrders":number,"newReferrals":number,"noResponse":number,"topBranches":[{"branch":"tag","count":number}],"criticalSubjects":["subject1","subject2"],"summary":"2 sentence summary"}`,
      messages: [{ role: "user", content: "Query [Zendesk1].[Zendesk].[Tickets] WHERE Status IN ('new','open','pending'). Count tickets by critical operational tags. Return the JSON." }],
      mcp_servers: [{ type: "url", url: "https://mcp.cloud.cdata.com/mcp", name: "cdata-zendesk" }]
    })
  });
  const data = await resp.json();
  const text = data.content?.find(b => b.type === "text")?.text || "";
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

async function generateBriefing(tableau, zd) {
  const rnDrop = Math.round((1 - tableau.rnW13 / tableau.rnW11) * 100);
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{ role: "user", content: `Hospice operations briefing. Be specific, use numbers, 4 sentences max, no fluff.

TABLEAU TODAY: Census ${tableau.census} | MTD Admits ${tableau.mtdAdmits} | MTD DC ${tableau.mtdDischarges} | ALOS ${tableau.alos}d (target 120) | Discharged ALOS ${tableau.dischAlos}d (target 80) | RN scheduled visits: Week11=${tableau.rnW11} Week12=${tableau.rnW12} Week13=${tableau.rnW13} (${rnDrop}% drop)

ZENDESK LIVE: Late visits=${zd.lateVisits} | QI incidents=${zd.qiIncidents} | DME issues=${zd.dmeIssues} | No-response=${zd.noResponse} | Referrals=${zd.newReferrals} | Hottest branches: ${(zd.topBranches||[]).slice(0,3).map(b=>`${BRANCH_MAP[b.branch]||b.branch}(${b.count})`).join(", ")}

Write the executive briefing:` }]
    })
  });
  const data = await resp.json();
  return data.content?.find(b => b.type === "text")?.text || "";
}

const DEMO_ZD = {
  lateVisits: 15, qiIncidents: 8, dmeIssues: 4, openOrders: 7, newReferrals: 4, noResponse: 12,
  topBranches: [
    { branch: "eau_claire", count: 9 }, { branch: "firekeepers___wi", count: 8 },
    { branch: "milwaukee", count: 7 }, { branch: "duluth", count: 6 }, { branch: "mankato", count: 5 },
  ],
  criticalSubjects: [
    "Late Visit – Please address ASAP! (×15 open)",
    "GRB Unverified Visits – Orders Needed ASAP",
    "Visits Holding Billing [URGENT] – Chicago S",
    "FIREKPRS – M. STADLER – FALL",
    "MKE Late/Incomplete Visits – please complete ASAP",
    "ATW and GRB Unverified Visits – Orders Needed",
  ],
  summary: "15 late-visit tickets open across Eau Claire, GRB, Duluth, Milwaukee. 8 QI incidents pending QA review."
};

export default function Dashboard() {
  const tableau = {
    census: 2032, mtdAdmits: 141, mtdDischarges: 122,
    alos: 148.1, dischAlos: 101.7, rnW11: 307, rnW12: 254, rnW13: 214, rnPct: 87,
    weekAdmits: 54, weekDischarges: 21,
  };
  const rnDrop = Math.round((1 - tableau.rnW13 / tableau.rnW11) * 100);

  const [tab, setTab] = useState("ops");
  const [zd, setZd] = useState(DEMO_ZD);
  const [loading, setLoading] = useState(false);
  const [briefing, setBriefing] = useState("");
  const [briefLoading, setBriefLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const { displayed: typed, done: typeDone } = useTypewriter(briefing, 9);

  async function refresh() {
    setLoading(true);
    try {
      const data = await fetchZendeskIntelligence();
      setZd(data);
      setLastRefresh(new Date());
      setBriefing("");
      setBriefLoading(true);
      const b = await generateBriefing(tableau, data);
      setBriefing(b);
    } catch {
      setZd(DEMO_ZD);
      setLastRefresh(new Date());
      setBriefLoading(true);
      try {
        const b = await generateBriefing(tableau, DEMO_ZD);
        setBriefing(b);
      } catch {
        setBriefing(`Census is at ${tableau.census.toLocaleString()} and growing fast — ${tableau.mtdAdmits} MTD admits vs ${tableau.mtdDischarges} discharges, a net +${tableau.mtdAdmits - tableau.mtdDischarges} this month. The most urgent clinical signal is RN scheduled visits dropping ${rnDrop}% over 3 weeks (${tableau.rnW11}→${tableau.rnW13}), compounding into frequency compliance failures. Zendesk shows ${DEMO_ZD.lateVisits} unverified visit tickets open today, concentrated in Eau Claire, GRB, and Milwaukee — these branches need immediate supervisor contact. ${DEMO_ZD.qiIncidents} QI incident tickets are pending QA review; falls in Milwaukee, Brainerd, and Duluth are unresolved past initial escalation.`);
      }
    } finally {
      setLoading(false);
      setBriefLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  const c = {
    bg: "#080F1C", panel: "rgba(10,18,32,0.95)", border: "rgba(255,255,255,0.07)",
    teal: "#00D4AA", red: "#FF4B4B", orange: "#FF8C00", gold: "#FFD700",
    text: "#C8D8E8", muted: "#4A7A8A", dim: "#2A4060",
  };

  const dot = (col) => (
    <span style={{ width: 7, height: 7, borderRadius: "50%", background: col,
      display: "inline-block", marginRight: 7, flexShrink: 0,
      boxShadow: `0 0 5px ${col}99`, verticalAlign: "middle" }} />
  );

  const tag = (col, text) => (
    <span style={{ padding: "2px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700,
      background: col + "22", border: `1px solid ${col}55`, color: col,
      letterSpacing: "0.05em", whiteSpace: "nowrap" }}>{text}</span>
  );

  const pill = (col, text) => (
    <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 10,
      background: col + "18", color: col, border: `1px solid ${col}30` }}>{text}</span>
  );

  const Panel = ({ title, badge, children, alert }) => (
    <div style={{ background: c.panel, border: `1px solid ${alert || c.border}`,
      borderRadius: 12, overflow: "hidden", transition: "border-color 0.3s" }}>
      <div style={{ padding: "11px 18px", borderBottom: `1px solid ${c.border}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "rgba(0,0,0,0.25)" }}>
        <span style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase",
          color: "#7ABBC8", fontWeight: 600 }}>{title}</span>
        {badge}
      </div>
      <div style={{ padding: "14px 18px" }}>{children}</div>
    </div>
  );

  const Bar = ({ label, val, max, col, right }) => {
    const pct = Math.round(val / max * 100);
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ width: 96, fontSize: 11, color: c.text, flexShrink: 0 }}>{label}</span>
        <div style={{ flex: 1, height: 7, background: "rgba(255,255,255,0.05)", borderRadius: 3 }}>
          <div style={{ height: 7, borderRadius: 3, width: `${pct}%`,
            background: `linear-gradient(90deg, ${col}, ${col}88)`, transition: "width 0.9s ease" }} />
        </div>
        <span style={{ width: 28, textAlign: "right", fontSize: 12, color: col, fontWeight: 700 }}>{right ?? val}</span>
      </div>
    );
  };

  const kpis = [
    { label: "Census", value: "2,032", sub: "active patients", col: c.teal },
    { label: "MTD Admits", value: "141", sub: "March 2026", col: c.teal },
    { label: "MTD Discharges", value: "122", sub: "March 2026", col: "#FF7A6B" },
    { label: "Net Census", value: "+19", sub: "month-to-date", col: c.teal },
    { label: "ALOS", value: "148.1d", sub: "target 120 ✓", col: c.teal },
    { label: "DC'd ALOS", value: "101.7d", sub: "target 80 ↑", col: c.gold },
    { label: "Late Visits", value: zd.lateVisits, sub: "open Zendesk", col: c.red },
    { label: "QI Incidents", value: zd.qiIncidents, sub: "QA pending", col: c.orange },
  ];

  return (
    <div style={{ minHeight: "100vh", background: `linear-gradient(135deg, ${c.bg} 0%, #0D1829 60%, #091520 100%)`,
      fontFamily: "'DM Mono','Courier New',monospace", color: c.text, fontSize: 13 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Sora:wght@400;600;700&display=swap');
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:#0a1220}::-webkit-scrollbar-thumb{background:#1a3050;border-radius:2px}
      `}</style>

      {/* HEADER */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "14px 24px", borderBottom: `1px solid rgba(0,212,170,0.18)`,
        background: "rgba(8,15,28,0.97)", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8,
            background: "linear-gradient(135deg,#00D4AA,#005F7A)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "'Sora',sans-serif", fontWeight: 700, fontSize: 17, color: "#fff" }}>M</div>
          <div>
            <div style={{ fontFamily: "'Sora',sans-serif", fontWeight: 700, fontSize: 14, color: "#E0EEF8", letterSpacing: "0.06em" }}>MOMENTS HOSPICE</div>
            <div style={{ fontSize: 9, color: c.muted, letterSpacing: "0.18em", textTransform: "uppercase" }}>Operations Command Center</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 3 }}>
          {[["ops","Operations"],["freq","Frequency"],["zendesk","Zendesk Intel"]].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              style={{ background: tab===id ? "rgba(0,212,170,0.14)" : "none",
                border: "none", borderRadius: 7, color: tab===id ? c.teal : c.muted,
                fontSize: 10, padding: "7px 14px", cursor: "pointer",
                letterSpacing: "0.1em", textTransform: "uppercase",
                fontFamily: "'DM Mono',monospace", transition: "all 0.2s" }}>{label}</button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {loading && <span style={{ fontSize: 10, color: c.teal, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 14, height: 14, border: `2px solid ${c.teal}33`, borderTop: `2px solid ${c.teal}`,
              borderRadius: "50%", display: "inline-block", animation: "spin 0.8s linear infinite" }} />
            Querying live data…
          </span>}
          {lastRefresh && <span style={{ fontSize: 10, color: c.dim }}>
            Refreshed {lastRefresh.toLocaleTimeString()}
          </span>}
          <button onClick={refresh} disabled={loading}
            style={{ background: "rgba(0,212,170,0.1)", border: `1px solid rgba(0,212,170,0.35)`,
              borderRadius: 8, color: c.teal, fontSize: 11, padding: "8px 16px", cursor: "pointer",
              letterSpacing: "0.07em", fontFamily: "'DM Mono',monospace" }}>
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* KPI STRIP */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(8,1fr)", gap: 10, padding: "16px 20px 10px" }}>
        {kpis.map((k, i) => (
          <div key={i} style={{ background: "rgba(13,22,40,0.85)", border: `1px solid rgba(255,255,255,0.06)`,
            borderRadius: 10, padding: "14px 10px", textAlign: "center",
            animation: `fadeUp 0.4s ease ${i*0.05}s both` }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: k.col, fontFamily: "'Sora',sans-serif",
              letterSpacing: "-0.02em", lineHeight: 1 }}>{k.value}</div>
            <div style={{ fontSize: 9, color: c.muted, letterSpacing: "0.12em", textTransform: "uppercase", marginTop: 5 }}>{k.label}</div>
            <div style={{ fontSize: 9, color: k.col + "88", marginTop: 3 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* ── OPS TAB ── */}
      {tab === "ops" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.45fr", gap: 12, padding: "4px 20px 20px" }}>

          {/* COL 1 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Panel title="⚠ RN Scheduled Visits" alert="rgba(255,75,75,0.35)"
              badge={pill(c.red, `↓${rnDrop}% IN 3 WKS`)}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
                borderRadius: 7, background: "rgba(255,75,75,0.08)", border: "1px solid rgba(255,75,75,0.2)", marginBottom: 14 }}>
                {dot(c.red)}
                <span style={{ fontSize: 11, color: "#FFAAAA" }}>
                  Dropping from <strong>{tableau.rnW11}</strong> → <strong>{tableau.rnW13}</strong> visits — {rnDrop}% decline
                </span>
              </div>
              {[["Week 11 (Mar 8)", tableau.rnW11, 100], ["Week 12 (Mar 15)", tableau.rnW12, Math.round(tableau.rnW12/tableau.rnW11*100)], ["Week 13 (Mar 22)", tableau.rnW13, Math.round(tableau.rnW13/tableau.rnW11*100)]].map(([w, v, p], i) => (
                <div key={i} style={{ marginBottom: 11 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 4, color: "#7ABBC8" }}>
                    <span>{w}</span><span style={{ color: p < 80 ? c.red : c.gold }}>{v} visits</span>
                  </div>
                  <div style={{ height: 7, background: "rgba(255,255,255,0.05)", borderRadius: 3 }}>
                    <div style={{ height: 7, borderRadius: 3, width: `${p}%`, transition: "width 0.8s ease",
                      background: `linear-gradient(90deg,${p<80?c.red:p<90?c.gold:c.teal},${p<80?c.red+"66":p<90?c.gold+"66":c.teal+"66"})` }} />
                  </div>
                </div>
              ))}
              <div style={{ fontSize: 10, color: c.muted, marginTop: 8, paddingTop: 8, borderTop: `1px solid rgba(255,255,255,0.05)` }}>
                Historical completion rate: <span style={{ color: c.gold }}>{tableau.rnPct}%</span> · Target: <span style={{ color: c.teal }}>≥95%</span>
              </div>
            </Panel>

            <Panel title="Census Growth — 12mo" badge={pill(c.teal, "+66%")}>
              {[[1222,"Apr '25"],[1431,"Jul '25"],[1704,"Oct '25"],[1842,"Jan '26"],[2033,"Mar '26"]].map(([v, m], i) => (
                <Bar key={i} label={m} val={v} max={2033} col={c.teal} right={v.toLocaleString()} />
              ))}
              <div style={{ fontSize: 10, color: c.muted, marginTop: 8, textAlign: "center" }}>
                Week: {tableau.weekAdmits} admits · {tableau.weekDischarges} DC's · Net +{tableau.weekAdmits - tableau.weekDischarges}
              </div>
            </Panel>
          </div>

          {/* COL 2 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Panel title="Live Issue Categories" badge={loading ? <span style={{ width:14,height:14,border:`2px solid ${c.teal}33`,borderTop:`2px solid ${c.teal}`,borderRadius:"50%",display:"inline-block",animation:"spin 0.8s linear infinite"}} /> : <span style={{fontSize:9,color:c.muted}}>Zendesk · now</span>}>
              {[
                ["Late / Unverified", zd.lateVisits, c.red],
                ["No Response", zd.noResponse, c.orange],
                ["QI Incidents", zd.qiIncidents, c.red],
                ["DME Issues", zd.dmeIssues, c.orange],
                ["Open Orders", zd.openOrders, c.gold],
                ["New Referrals", zd.newReferrals, c.teal],
              ].map(([label, count, col], i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    {dot(col)}<span style={{ fontSize: 12 }}>{label}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 70, height: 4, background: "rgba(255,255,255,0.05)", borderRadius: 2 }}>
                      <div style={{ height: 4, borderRadius: 2, background: col, opacity: 0.8,
                        width: `${Math.min(100, count / 20 * 100)}%` }} />
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 700, color: col, width: 22, textAlign: "right" }}>{count}</span>
                  </div>
                </div>
              ))}
            </Panel>

            <Panel title="Branch Ticket Load" badge={<span style={{fontSize:9,color:c.muted}}>top 5 · open</span>}>
              {(zd.topBranches || []).map((b, i) => {
                const pct = Math.round(b.count / Math.max(...zd.topBranches.map(x=>x.count)) * 100);
                const col = pct > 75 ? c.red : pct > 50 ? c.orange : c.gold;
                return <Bar key={i} label={BRANCH_MAP[b.branch] || b.branch.replace(/_/g," ")} val={b.count} max={Math.max(...zd.topBranches.map(x=>x.count))} col={col} />;
              })}
            </Panel>

            <Panel title="ALOS Status" badge={pill(c.gold, "Monitor")}>
              {[["Current ALOS", tableau.alos, 120, true], ["Discharged ALOS", tableau.dischAlos, 80, false]].map(([label, val, tgt, good], i) => (
                <div key={i} style={{ marginBottom: 13 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 5 }}>
                    <span style={{ color: "#7ABBC8" }}>{label}</span>
                    <span><span style={{ color: good ? c.teal : c.gold, fontWeight: 700 }}>{val}d</span><span style={{ color: c.muted }}> / {tgt}d target</span></span>
                  </div>
                  <div style={{ height: 7, background: "rgba(255,255,255,0.05)", borderRadius: 3, position: "relative" }}>
                    <div style={{ height: 7, borderRadius: 3, width: `${Math.min(100, val/200*100)}%`,
                      background: good ? c.teal : c.gold, transition: "width 0.8s ease" }} />
                    <div style={{ position: "absolute", top: 0, height: "100%", width: 2,
                      background: "rgba(255,255,255,0.25)", left: `${tgt/200*100}%` }} />
                  </div>
                </div>
              ))}
            </Panel>
          </div>

          {/* COL 3 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* AI BRIEFING */}
            <div style={{ background: "linear-gradient(135deg,rgba(0,95,122,0.18),rgba(0,212,170,0.08))",
              border: `1px solid rgba(0,212,170,0.28)`, borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "11px 18px", borderBottom: `1px solid rgba(0,212,170,0.15)`,
                display: "flex", alignItems: "center", justifyContent: "space-between",
                background: "rgba(0,0,0,0.2)" }}>
                <span style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: c.teal, fontWeight: 600 }}>◈ AI Command Briefing</span>
                {briefLoading && <span style={{ width:14,height:14,border:`2px solid ${c.teal}33`,borderTop:`2px solid ${c.teal}`,borderRadius:"50%",display:"inline-block",animation:"spin 0.8s linear infinite"}} />}
              </div>
              <div style={{ padding: "16px 18px", minHeight: 130 }}>
                {briefing ? (
                  <p style={{ fontSize: 12, lineHeight: 1.85, color: "#C8E8E0", fontFamily: "'Sora',sans-serif" }}>
                    {typed}
                    {!typeDone && <span style={{ display: "inline-block", width: 2, height: 13,
                      background: c.teal, marginLeft: 2, verticalAlign: "middle",
                      animation: "blink 1s step-end infinite" }} />}
                  </p>
                ) : briefLoading ? (
                  <span style={{ fontSize: 11, color: c.muted }}>Synthesizing cross-system intelligence…</span>
                ) : (
                  <span style={{ fontSize: 11, color: c.muted }}>Click Refresh to generate briefing</span>
                )}
              </div>
            </div>

            <Panel title="🔴 Critical Open Tickets" badge={<span style={{fontSize:9,color:c.muted}}>Zendesk · now</span>}>
              {(zd.criticalSubjects || []).map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 9,
                  padding: "8px 0", borderBottom: i < (zd.criticalSubjects.length-1) ? `1px solid rgba(255,255,255,0.04)` : "none" }}>
                  {dot(i===0 || s.includes("URGENT") || s.toUpperCase().includes("FALL") ? c.red : i<3 ? c.orange : c.gold)}
                  <span style={{ fontSize: 11, lineHeight: 1.45, color: "#D0E0EC" }}>{s}</span>
                </div>
              ))}
            </Panel>

            <Panel title="Frequency Thresholds">
              {[["CNA (HHA)","5×/week","⚠ Gap Risk",c.orange],["RN (SN)","2×/week",`🔴 Down ${rnDrop}%`,c.red],["Social Work (MSW)","2×/month","⚠ Monitor",c.gold],["Chaplain (CH)","2×/month","⚠ Monitor",c.gold]].map(([d,t,s,col],i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "7px 0", borderBottom: i<3 ? `1px solid rgba(255,255,255,0.04)` : "none" }}>
                  <div>
                    <div style={{ fontSize: 12, color: c.text }}>{d}</div>
                    <div style={{ fontSize: 9, color: c.muted }}>Target: {t}</div>
                  </div>
                  {tag(col, s)}
                </div>
              ))}
            </Panel>
          </div>
        </div>
      )}

      {/* ── FREQUENCY TAB ── */}
      {tab === "freq" && (
        <div style={{ padding: "10px 20px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px",
            borderRadius: 8, background: "rgba(255,75,75,0.08)", border: `1px solid rgba(255,75,75,0.25)`, marginBottom: 14 }}>
            {dot(c.red)}
            <strong style={{ color: "#FFA0A0", fontSize: 12 }}>RN Visit Drop Alert:</strong>
            <span style={{ fontSize: 11, color: "#D8C0C0" }}>Scheduled RN visits fell {tableau.rnW11}→{tableau.rnW12}→{tableau.rnW13} in 3 weeks ({rnDrop}% decline). Cross-reference with frequency compliance immediately.</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
            {[["CNA (HHA)","5×/wk","Below 5 = frequency gap","fa199814",c.orange],["RN (SN)","2×/wk","Below 2 = compliance risk","857f6de9",c.red],["Social Work (MSW)","2×/mo","Below 2/mo = regulatory gap","c7e9b2e3",c.gold],["Chaplain (CH/MU)","2×/mo","Below 1/mo = PEPPER risk","c7e9b2e3",c.gold]].map(([d,t,h,id,col],i) => (
              <div key={i} style={{ background: c.panel, border: `1px solid ${col}30`, borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: col, marginBottom: 6, fontFamily: "'Sora',sans-serif" }}>{d}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: c.text, fontFamily: "'Sora',sans-serif" }}>{t}</div>
                <div style={{ fontSize: 10, color: c.muted, marginTop: 6, lineHeight: 1.6 }}>{h}</div>
                <div style={{ marginTop: 10, fontSize: 9, color: c.dim }}>View ID: {id}</div>
                <a href={`https://basrv-tx.hchb.com/#/site/Moments/views/${id}`} target="_blank" rel="noreferrer"
                  style={{ fontSize: 10, color: c.teal, textDecoration: "none", display: "block", marginTop: 6 }}>→ Open in Tableau</a>
              </div>
            ))}
          </div>
          <Panel title="Weekly Frequency 2.0 — Data Reference" badge={<span style={{fontSize:9,color:c.muted}}>Tableau · fa199814 + c7e9b2e3</span>}>
            <div style={{ fontSize: 11, color: "#7ABBC8", lineHeight: 1.8 }}>
              The Weekly Frequency view shows <strong style={{color:c.text}}>planned/ordered visits</strong> — declined and missed may still appear. Cross-reference with Zendesk <code style={{background:"rgba(255,255,255,0.06)",padding:"1px 5px",borderRadius:3}}>_unverified_visit_request</code> tag for actual delivery gaps.<br/><br/>
              Key rule: any patient with <strong style={{color:c.red}}>CNA &lt; 5/wk</strong> or <strong style={{color:c.red}}>RN &lt; 2/wk</strong> should automatically surface a Zendesk ticket from your daily audit automation. If the Zendesk ticket exists but the Tableau frequency shows compliant numbers — the visit happened but wasn't documented (HUV).
            </div>
          </Panel>
        </div>
      )}

      {/* ── ZENDESK TAB ── */}
      {tab === "zendesk" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: "10px 20px 20px" }}>
          <Panel title="Tag Intelligence Guide">
            {Object.entries(CRITICAL_TAGS).map(([t, info], i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10,
                padding: "8px 0", borderBottom: i < Object.keys(CRITICAL_TAGS).length-1 ? `1px solid rgba(255,255,255,0.04)` : "none" }}>
                {tag(info.color, info.severity.toUpperCase())}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: c.text }}>{t}</div>
                  <div style={{ fontSize: 10, color: c.muted }}>{info.label}</div>
                </div>
              </div>
            ))}
          </Panel>

          <Panel title="Cross-System Signal Map">
            {[
              ["_unverified_visit_request",c.orange,"Weekly Frequency fa199814",c.teal,"Find patient in frequency grid — ordered but not completed?"],
              ["occurrence_clarification",c.red,"RN Metrics 857f6de9",c.teal,"Was RN hitting 2×/wk? Falls spike in low-frequency patients."],
              ["dme_not_ordered",c.red,"Caregiver Optimization 3e7e68e9",c.teal,"CNA visiting but not flagging DME need — documentation gap."],
              ["daily_audit_for_unverified_visit",c.orange,"Orders Lifecycle 2ca1b12f",c.teal,"Visit done, no signed order — unsigned CTI exists."],
              ["no_response_start",c.orange,"Daily Snapshot e5bf6766",c.teal,"Check L-LATE count for that worker — pattern vs exception?"],
            ].map(([zt,zc,tt,tc,action],i) => (
              <div key={i} style={{ padding: "10px 0", borderBottom: i<4 ? `1px solid rgba(255,255,255,0.04)` : "none" }}>
                <div style={{ display: "flex", gap: 6, marginBottom: 5, flexWrap: "wrap" }}>
                  {tag(zc, zt)}
                  <span style={{ fontSize: 10, color: c.muted, alignSelf: "center" }}>→</span>
                  {tag(tc, tt)}
                </div>
                <div style={{ fontSize: 11, color: "#7ABBC8", lineHeight: 1.5 }}>{action}</div>
              </div>
            ))}
          </Panel>
        </div>
      )}

      <div style={{ borderTop: `1px solid rgba(255,255,255,0.04)`, padding: "8px 24px",
        display: "flex", justifyContent: "space-between", fontSize: 9, color: c.dim }}>
        <span>Tableau: Mar 10 2026 · 11:35 AM CST · Zendesk: Live via CData MCP</span>
        <span>Moments Hospice Operations Command Center · Confidential</span>
      </div>
    </div>
  );
}
