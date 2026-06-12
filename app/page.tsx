"use client";

import { useState, useEffect, useCallback, useRef } from "react";

const STORAGE_KEY = "shared_calendar_v5";

const COLORS = [
  { id:"blue",   bg:"#EBF4FF", border:"#93C5FD", text:"#1E40AF", dot:"#3B82F6" },
  { id:"green",  bg:"#F0FDF4", border:"#86EFAC", text:"#166534", dot:"#22C55E" },
  { id:"pink",   bg:"#FDF2F8", border:"#F9A8D4", text:"#9D174D", dot:"#EC4899" },
  { id:"purple", bg:"#F5F3FF", border:"#C4B5FD", text:"#5B21B6", dot:"#8B5CF6" },
  { id:"yellow", bg:"#FFFBEB", border:"#FCD34D", text:"#92400E", dot:"#F59E0B" },
  { id:"orange", bg:"#FFF7ED", border:"#FDBA74", text:"#9A3412", dot:"#F97316" },
  { id:"teal",   bg:"#F0FDFA", border:"#5EEAD4", text:"#115E59", dot:"#14B8A6" },
  { id:"red",    bg:"#FEF2F2", border:"#FCA5A5", text:"#991B1B", dot:"#EF4444" },
];

const KW: Record<string, string> = {
  "健康":"green","医療":"green","病院":"green","診断":"green","薬":"green",
  "仕事":"blue","会議":"blue","ミーティング":"blue","レビュー":"blue","請求":"blue","締切":"blue",
  "食事":"pink","ランチ":"pink","ディナー":"pink","コーヒー":"pink","散髪":"pink","誕生日":"pink",
  "買い物":"yellow","ショッピング":"yellow","食品":"yellow","食料":"yellow",
  "旅行":"purple","出張":"purple","パスポート":"purple","引っ越し":"purple","帰省":"purple",
  "家事":"orange","掃除":"orange","洗車":"orange","修理":"orange","贈り物":"orange",
  "趣味":"teal","スポーツ":"teal","ヨガ":"teal","ギター":"teal","瞑想":"teal","植物":"teal",
  "記念日":"red","アラーム":"red",
};
const apiKey = process.env.GEMINI_API_KEY;
const WEEKDAYS = ["月","火","水","木","金","土","日"];
const BORDER = "rgba(0,0,0,0.07)";
const BORDER_STRONG = "rgba(0,0,0,0.10)";

function genId() { return Date.now().toString(36)+Math.random().toString(36).slice(2); }
function pad(n: number)  { return String(n).padStart(2,"0"); }

function colorForTitle(t: string) {
  if (!t) return "blue";
  for(const[k,v] of Object.entries(KW)) if(t.includes(k)) return v;
  return COLORS[Math.abs([...t].reduce((a,c)=>a+c.charCodeAt(0),0))%COLORS.length].id;
}
function getColor(id: string) { return COLORS.find(c=>c.id===id)||COLORS[0]; }

function fmtTime(t: string) {
  if(!t) return "";
  const[h,m]=t.split(":").map(Number);
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${pad(m)} ${ampm}`;
}

function fmtTimeShort(t: string) {
  if(!t) return "";
  const[h,m]=t.split(":").map(Number);
  return `${h}:${pad(m)}`;
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function isTodayFn(y: number, m: number, d: number) {
  const t = new Date();
  return t.getFullYear() === y && t.getMonth() === m && t.getDate() === d;
}

function addMinutes(timeStr: string, mins: number) {
  if(!timeStr) return "";
  const [h, m] = timeStr.split(":").map(Number);
  const total = h * 60 + m + mins;
  return `${pad(Math.floor(total/60) % 24)}:${pad(total % 60)}`;
}

async function toJpegBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("ファイルの読み込みに失敗しました"));
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      const img = new Image();
      img.onerror = () => reject(new Error("画像のデコードに失敗しました（対応形式: JPEG/PNG/GIF/WebP）"));
      img.onload = () => {
        try {
          const MAX = 2048;
          let { width: w, height: h } = img;
          if(w > MAX || h > MAX) {
            if(w > h) { h = Math.round(h * MAX / w); w = MAX; }
            else      { w = Math.round(w * MAX / h); h = MAX; }
          }
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext("2d");
          if(!ctx) { reject(new Error("Canvas初期化に失敗しました")); return; }
          ctx.drawImage(img, 0, 0, w, h);
          const jpegDataUrl = canvas.toDataURL("image/jpeg", 0.85);
          resolve(jpegDataUrl.split(",")[1]);
        } catch(err: any) {
          reject(new Error("画像の変換に失敗しました: " + err.message));
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

async function aiExtract(text: string | null, imgBase64: string | null) {
  const res = await fetch("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, imgBase64 }),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `サーバーエラー: ${res.status}`);
  }
  return await res.json();
}

/* ── EventPill ── */
function EventPill({ ev, onClick, tiny }: { ev: any, onClick: (ev: any) => void, tiny?: boolean }) {
  const c = getColor(ev.colorId || colorForTitle(ev.title));
  return (
    <div
      onClick={e => { e.stopPropagation(); onClick(ev); }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 3,
        background: c.bg,
        color: c.text,
        fontSize: tiny ? 10 : 11,
        padding: tiny ? "2px 4px" : "3px 6px",
        borderRadius: 4,
        marginBottom: 3,
        cursor: "pointer",
        overflow: "hidden",
        lineHeight: 1.4,
        fontWeight: 500,
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",
        maxWidth: "100%",
        boxSizing: "border-box",
      }}
    >
      <span style={{
        width: 6, height: 6, borderRadius: "50%",
        background: c.dot, flexShrink: 0, display: "inline-block",
      }} />
      <span style={{overflow:"hidden",textOverflow:"ellipsis"}}>
        {ev.time && !ev.isAllDay ? fmtTimeShort(ev.time)+" " : ""}{ev.title}
      </span>
    </div>
  );
}

/* ── MonthView ── */
function MonthView({ year, month, events, onDayClick, onEventClick }: any) {
  const firstDow = (() => { let d = new Date(year,month,1).getDay(); return d===0?6:d-1; })();
  const dim = getDaysInMonth(year, month);

  const cells = [];
  for(let i=0;i<firstDow;i++) cells.push(null);
  for(let d=1;d<=dim;d++) cells.push(d);
  while(cells.length%7) cells.push(null);

  const rows = [];
  for(let r=0;r<cells.length/7;r++) rows.push(cells.slice(r*7,r*7+7));

  const dayEvs = (d: number | null) => {
    if(!d) return [];
    const ds = `${year}-${pad(month+1)}-${pad(d)}`;
    return events.filter((e: any)=>e.date===ds).sort((a: any,b: any)=>(a.time||"zz").localeCompare(b.time||"zz"));
  };

  return (
    <div style={{flex:1}}>
      <div style={{
        display:"grid",gridTemplateColumns:"repeat(7,1fr)",
        background:"#FAFAFA",
        borderBottom:`1px solid ${BORDER_STRONG}`,
      }}>
        {WEEKDAYS.map((w,i)=>(
          <div key={w} style={{
            textAlign:"center", fontSize:12, fontWeight:600,
            color: i===5?"#0EA5E9":i===6?"#F43F5E":"#9CA3AF",
            padding:"12px 0 10px",
            letterSpacing:"0.04em",
            borderRight: i<6?`1px solid ${BORDER}`:"none",
          }}>{w}</div>
        ))}
      </div>
      {rows.map((row,ri) => (
        <div key={ri} style={{
          display:"grid",gridTemplateColumns:"repeat(7,1fr)",
          borderBottom:`1px solid ${BORDER}`,
        }}>
          {row.map((d,ci) => {
            const evs = dayEvs(d);
            const isT = d && isTodayFn(year,month,d);
            const isSat = ci===5, isSun = ci===6;
            return (
              <div
                key={ci}
                onClick={() => d && onDayClick(d)}
                style={{
                  minHeight: 120, // ★ パソコン向けに高さを少し広げました（元の 90px から 120px へ）
                  borderRight: ci<6?`1px solid ${BORDER}`:"none",
                  padding: "6px 4px",
                  cursor: d?"pointer":"default",
                  boxSizing:"border-box",
                  background: isT ? "#FFFBF0" : "#fff",
                  overflow: "hidden",
                  transition: "background 0.1s",
                }}
              >
                {d && (
                  <>
                    <div style={{
                      width:24,height:24,borderRadius:"50%",
                      background: isT ? "#F59E0B" : "transparent",
                      color: isT ? "#fff" : isSun ? "#F43F5E" : isSat ? "#0EA5E9" : "#374151",
                      fontSize:13,fontWeight: isT ? 700 : 500,
                      display:"flex",alignItems:"center",justifyContent:"center",
                      margin:"0 auto 6px",
                      flexShrink: 0,
                    }}>{d}</div>
                    
                    <div style={{ overflow: "hidden" }}>
                      {evs.slice(0, 4).map((ev: any) => (
                        <EventPill key={ev.id} ev={ev} onClick={onEventClick} tiny />
                      ))}
                      {evs.length > 4 && (
                        <div style={{fontSize:10,color:"#9CA3AF",paddingLeft:2,lineHeight:1.4}}>
                          +{evs.length-4}件
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ── WeekView（前後週ナビ対応） ── */
function WeekView({ weekStart, events, onEventClick, onSlotClick }: any) {
  const days = Array.from({length:7}, (_,i) => {
    const d = new Date(weekStart); d.setDate(d.getDate()+i); return d;
  });
  const hours = Array.from({length:18}, (_,i) => i+6);
  const today = new Date();
  const HOUR_H = 60; // 高さも少し広めに
  const now = new Date();
  const nowMins = (now.getHours()-6)*60 + now.getMinutes();
  const showNowLine = nowMins>=0 && nowMins<18*60;

  const getSlotEvents = (ds: string, h: number) => events.filter((e: any) => {
    if(e.date!==ds || !e.time || e.isAllDay) return false;
    const [eh] = e.time.split(":").map(Number);
    return eh === h;
  });

  return (
    <div style={{overflowY:"auto",maxHeight:"calc(100vh - 210px)"}}>
      <div style={{
        display:"grid",gridTemplateColumns:"50px repeat(7,1fr)",
        borderBottom:`1px solid ${BORDER_STRONG}`,
        position:"sticky",top:0,background:"#fff",zIndex:3,
      }}>
        <div style={{borderRight:`1px solid ${BORDER}`}} />
        {days.map((d,i) => {
          const isT = d.toDateString()===today.toDateString();
          const isSat=i===5, isSun=i===6;
          return (
            <div key={i} style={{
              textAlign:"center",padding:"10px 0 8px",
              borderRight: i<6?`1px solid ${BORDER}`:"none",
            }}>
              <div style={{
                fontSize:11,fontWeight:600,letterSpacing:"0.05em",
                color: isSun?"#F43F5E":isSat?"#0EA5E9":"#9CA3AF",
                marginBottom:4,
              }}>{WEEKDAYS[i]}</div>
              <div style={{
                width:30,height:30,borderRadius:"50%",margin:"0 auto",
                background: isT ? "#F59E0B" : "transparent",
                color: isT ? "#fff" : isSun ? "#F43F5E" : isSat ? "#0EA5E9" : "#374151",
                fontSize:15,fontWeight: isT ? 700 : 500,
                display:"flex",alignItems:"center",justifyContent:"center",
              }}>{d.getDate()}</div>
            </div>
          );
        })}
      </div>

      {(() => {
        const allDayEvs = days.map(d => {
          const ds = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
          return events.filter((e: any)=>e.date===ds&&(e.isAllDay||!e.time));
        });
        if(!allDayEvs.some(x=>x.length>0)) return null;
        return (
          <div style={{
            display:"grid",gridTemplateColumns:"50px repeat(7,1fr)",
            borderBottom:`1px solid ${BORDER_STRONG}`,
            background:"#FAFAFA",
          }}>
            <div style={{
              fontSize:10,color:"#9CA3AF",display:"flex",alignItems:"center",
              justifyContent:"flex-end",paddingRight:6,
              borderRight:`1px solid ${BORDER}`,
            }}>終日</div>
            {allDayEvs.map((evs,i) => (
              <div key={i} style={{
                borderRight:i<6?`1px solid ${BORDER}`:"none",
                padding:"4px 3px",minHeight:32,
              }}>
                {evs.map((ev: any) => <EventPill key={ev.id} ev={ev} onClick={onEventClick} />)}
              </div>
            ))}
          </div>
        );
      })()}

      <div style={{position:"relative"}}>
        {hours.map(h => (
          <div key={h} style={{
            display:"grid",gridTemplateColumns:"50px repeat(7,1fr)",
            height:HOUR_H,
          }}>
            <div style={{
              fontSize:10,color:"#9CA3AF",textAlign:"right",
              paddingRight:6,paddingTop:4,
              borderRight:`1px solid ${BORDER}`,
              borderTop:`1px solid ${BORDER}`,
              boxSizing:"border-box",lineHeight:1,
            }}>
              {h<12?`${h}AM`:h===12?"12PM":`${h-12}PM`}
            </div>
            {days.map((d,di) => {
              const ds = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
              const slotEvs = getSlotEvents(ds, h);
              return (
                <div key={di} onClick={()=>onSlotClick(ds,`${pad(h)}:00`)} style={{
                  borderRight: di<6?`1px solid ${BORDER}`:"none",
                  borderTop:`1px solid ${BORDER}`,
                  padding:"3px 3px",cursor:"pointer",
                  boxSizing:"border-box",
                  background: d.toDateString()===today.toDateString() ? "rgba(245,158,11,0.04)" : "transparent",
                }}>
                  {slotEvs.map((ev: any) => <EventPill key={ev.id} ev={ev} onClick={onEventClick} />)}
                </div>
              );
            })}
          </div>
        ))}
        {showNowLine && (
          <div style={{
            position:"absolute",left:50,right:0,
            top: nowMins/60*HOUR_H,
            height:2,background:"#EF4444",zIndex:2,pointerEvents:"none",
          }}>
            <div style={{
              width:8,height:8,borderRadius:"50%",
              background:"#EF4444",position:"absolute",left:-4,top:-3,
            }} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ── ListView ── */
function ListView({ events, onEventClick }: any) {
  const sorted = [...events].sort((a: any,b: any) => (a.date+(a.time||"")).localeCompare(b.date+(b.time||"")));
  const grouped: Record<string, any[]> = {};
  for(const ev of sorted) { (grouped[ev.date]||(grouped[ev.date]=[])).push(ev); }
  const dates = Object.keys(grouped).sort();

  if(!dates.length) return (
    <div style={{
      padding:"64px 24px",textAlign:"center",color:"#9CA3AF",
      display:"flex",flexDirection:"column",alignItems:"center",gap:16,
    }}>
      <div style={{fontSize:48}}>📅</div>
      <div style={{fontSize:16,fontWeight:500,color:"#6B7280"}}>予定がありません</div>
      <div style={{fontSize:14}}>＋ボタンから追加できます</div>
    </div>
  );

  return (
    <div style={{paddingBottom:40}}>
      {dates.map(ds => {
        const d = new Date(ds);
        const dow = ["日","月","火","水","木","金","土"][d.getDay()];
        const isSun = d.getDay()===0, isSat = d.getDay()===6;
        const isT = isTodayFn(d.getFullYear(), d.getMonth(), d.getDate());
        return (
          <div key={ds}>
            <div style={{
              fontSize:13,fontWeight:600,
              padding:"20px 20px 10px",
              color: isT ? "#F59E0B" : isSun ? "#F43F5E" : isSat ? "#0EA5E9" : "#374151",
              letterSpacing:"0.02em",
              display:"flex",alignItems:"center",gap:8,
            }}>
              {isT && (
                <span style={{
                  fontSize:11,background:"#FEF3C7",color:"#92400E",
                  padding:"2px 8px",borderRadius:20,fontWeight:700,letterSpacing:"0.05em",
                }}>今日</span>
              )}
              {d.getMonth()+1}月{d.getDate()}日（{dow}）
            </div>
            <div style={{padding:"0 16px",display:"flex",flexDirection:"column",gap:8}}>
              {grouped[ds].map(ev => {
                const c = getColor(ev.colorId || colorForTitle(ev.title));
                return (
                  <div key={ev.id} onClick={()=>onEventClick(ev)} style={{
                    display:"flex",alignItems:"stretch",gap:0,
                    borderRadius:12,background:"#fff",cursor:"pointer",
                    overflow:"hidden",
                    border:`1px solid ${BORDER}`,
                    boxShadow:"0 1px 4px rgba(0,0,0,0.04)",
                    transition:"box-shadow 0.15s",
                  }}>
                    <div style={{width:4,background:c.dot,flexShrink:0}} />
                    <div style={{padding:"14px 16px",flex:1}}>
                      <div style={{
                        fontSize:15,fontWeight:600,
                        color:"#111827",lineHeight:1.4,
                      }}>{ev.title}</div>
                      <div style={{
                        fontSize:13,color:"#6B7280",marginTop:4,
                        display:"flex",alignItems:"center",gap:6,
                      }}>
                        <span style={{
                          width:8,height:8,borderRadius:"50%",
                          background:c.dot,display:"inline-block",flexShrink:0,
                        }} />
                        {ev.isAllDay||!ev.time ? "終日" : fmtTime(ev.time)}
                        {ev.endTime ? " 〜 "+fmtTime(ev.endTime) : ""}
                        {ev.repeat && ev.repeat!=="none" && (
                          <span style={{
                            fontSize:11,background:c.bg,color:c.text,
                            padding:"2px 8px",borderRadius:20,
                          }}>
                            {ev.repeat==="weekly"?"毎週":ev.repeat==="monthly"?"毎月":"毎日"}
                          </span>
                        )}
                      </div>
                      {ev.notes && (
                        <div style={{fontSize:13,color:"#9CA3AF",marginTop:6,lineHeight:1.5}}>
                          {ev.notes}
                        </div>
                      )}
                    </div>
                    <div style={{
                      padding:"0 16px",display:"flex",
                      alignItems:"center",color:"#D1D5DB",fontSize:20,
                    }}>›</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── EventForm ── */
function EventForm({ init, onSave, onDelete }: any) {
  const [f, setF] = useState<any>({
    title:"",date:"",time:"",endTime:"",
    isAllDay:false,repeat:"none",notes:"",colorId:"blue",
    ...(init||{})
  });

  const s = (k: string, v: any) => setF((p: any) => {
    const updated = {...p, [k]:v};
    if(k === "time" && !p.isAllDay) {
      if(p.time && p.endTime && v) {
        const [sh,sm] = p.time.split(":").map(Number);
        const [eh,em] = p.endTime.split(":").map(Number);
        const diff = (eh*60+em) - (sh*60+sm);
        updated.endTime = diff > 0 ? addMinutes(v, diff) : addMinutes(v, 30);
      } else if(v && !p.endTime) {
        updated.endTime = addMinutes(v, 30);
      }
    }
    return updated;
  });

  const handleTitleChange = (v: string) => {
    const ac = colorForTitle(v);
    setF((p: any) => ({...p, title:v, colorId: p._colorManual ? p.colorId : ac}));
  };

  const inp = {
    width:"100%",boxSizing:"border-box" as const,
    padding:"12px 14px",
    borderRadius:10,
    border:`1.5px solid ${BORDER_STRONG}`,
    fontSize:15,background:"#FAFAFA",
    color:"#111827",outline:"none",
    fontFamily:"inherit",
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <div>
        <label style={{fontSize:12,color:"#9CA3AF",fontWeight:600,letterSpacing:"0.06em",display:"block",marginBottom:6}}>
          タイトル
        </label>
        <input
          value={f.title}
          onChange={e => handleTitleChange(e.target.value)}
          placeholder="例：会議、ランチ、受診など"
          autoFocus
          style={{
            ...inp,
            fontSize:18,fontWeight:600,
            padding:"14px 16px",
            borderColor: f.title ? getColor(f.colorId).border : BORDER_STRONG,
          }}
        />
      </div>

      <div>
        <label style={{fontSize:12,color:"#9CA3AF",fontWeight:600,letterSpacing:"0.06em",display:"block",marginBottom:6}}>
          日付
        </label>
        <input type="date" value={f.date} onChange={e=>s("date",e.target.value)} style={inp} />
      </div>

      {!f.isAllDay && (
        <div style={{display:"flex",gap:12}}>
          <div style={{flex:1}}>
            <label style={{fontSize:12,color:"#9CA3AF",fontWeight:600,letterSpacing:"0.06em",display:"block",marginBottom:6}}>
              開始
            </label>
            <input type="time" value={f.time} onChange={e=>s("time",e.target.value)} style={inp} />
          </div>
          <div style={{flex:1}}>
            <label style={{fontSize:12,color:"#9CA3AF",fontWeight:600,letterSpacing:"0.06em",display:"block",marginBottom:6}}>
              終了
            </label>
            <input type="time" value={f.endTime} onChange={e=>s("endTime",e.target.value)} style={inp} />
          </div>
        </div>
      )}

      <label style={{
        display:"flex",alignItems:"center",justifyContent:"space-between",
        cursor:"pointer",padding:"12px 16px",
        background:"#F9FAFB",borderRadius:10,
        border:`1.5px solid ${f.isAllDay ? "#93C5FD" : BORDER_STRONG}`,
        transition:"border-color 0.15s",
      }}>
        <div>
          <div style={{fontSize:15,color:"#374151",fontWeight:600}}>終日</div>
          <div style={{fontSize:12,color:"#9CA3AF",marginTop:2}}>時間を指定しない場合</div>
        </div>
        <div style={{
          width:50,height:28,borderRadius:14,
          background: f.isAllDay ? "#3B82F6" : "#D1D5DB",
          position:"relative",transition:"background 0.2s",flexShrink:0,
        }} onClick={()=>s("isAllDay",!f.isAllDay)}>
          <div style={{
            width:24,height:24,borderRadius:12,
            background:"#fff",position:"absolute",
            top:2,left: f.isAllDay ? 24 : 2,
            transition:"left 0.2s",
            boxShadow:"0 1px 3px rgba(0,0,0,0.2)",
          }} />
        </div>
      </label>

      <div>
        <label style={{fontSize:12,color:"#9CA3AF",fontWeight:600,letterSpacing:"0.06em",display:"block",marginBottom:8}}>
          繰り返し
        </label>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {[["none","なし"],["daily","毎日"],["weekly","毎週"],["monthly","毎月"]].map(([v,l])=>(
            <button key={v} onClick={()=>s("repeat",v)} style={{
              padding:"8px 16px",borderRadius:20,
              border:`1.5px solid ${f.repeat===v?"#93C5FD":BORDER_STRONG}`,
              background: f.repeat===v ? "#EBF4FF" : "#fff",
              color: f.repeat===v ? "#1E40AF" : "#6B7280",
              fontSize:14,cursor:"pointer",fontWeight: f.repeat===v ? 600 : 500,
              transition:"all 0.15s",
            }}>{l}</button>
          ))}
        </div>
      </div>

      <div>
        <label style={{fontSize:12,color:"#9CA3AF",fontWeight:600,letterSpacing:"0.06em",display:"block",marginBottom:10}}>
          カラー
        </label>
        <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
          {COLORS.map(c => (
            <div key={c.id} onClick={()=>setF((p: any)=>({...p,colorId:c.id,_colorManual:true}))} style={{
              width:36,height:36,borderRadius:"50%",
              background:c.bg,
              border:`3px solid ${f.colorId===c.id ? c.dot : "transparent"}`,
              outline: f.colorId===c.id ? `2px solid ${c.dot}33` : "none",
              cursor:"pointer",
              display:"flex",alignItems:"center",justifyContent:"center",
              transition:"transform 0.1s",
              transform: f.colorId===c.id ? "scale(1.1)" : "scale(1)",
            }}>
              <div style={{width:16,height:16,borderRadius:"50%",background:c.dot}} />
            </div>
          ))}
        </div>
      </div>

      <div>
        <label style={{fontSize:12,color:"#9CA3AF",fontWeight:600,letterSpacing:"0.06em",display:"block",marginBottom:6}}>
          メモ
        </label>
        <textarea
          value={f.notes}
          onChange={e=>s("notes",e.target.value)}
          rows={3}
          placeholder="メモ（任意）"
          style={{...inp,resize:"vertical",lineHeight:1.6}}
        />
      </div>

      <div style={{display:"flex",gap:12,paddingTop:10}}>
        <button onClick={()=>onSave(f)} style={{
          flex:1,padding:"14px 0",borderRadius:12,
          background: f.title ? getColor(f.colorId).dot : "#D1D5DB",
          color:"#fff",border:"none",fontSize:16,fontWeight:600,cursor:"pointer",
          transition:"background 0.2s",
        }}>保存</button>
        {onDelete && (
          <button onClick={onDelete} style={{
            padding:"14px 20px",borderRadius:12,
            background:"#FEF2F2",color:"#DC2626",
            border:`1.5px solid #FCA5A5`,fontSize:15,cursor:"pointer",
            fontWeight:600,
          }}>削除</button>
        )}
      </div>
    </div>
  );
}

/* ── EventDetail ── */
function EventDetail({ ev, onEdit, onDelete }: any) {
  const c = getColor(ev.colorId || colorForTitle(ev.title));
  const d = new Date(ev.date);
  const dow = ["日","月","火","水","木","金","土"][d.getDay()];
  
  return (
    <div style={{display:"flex",flexDirection:"column",gap:0}}>
      <div style={{
        background: c.bg,
        borderRadius:16,padding:"20px 20px",
        marginBottom:20,
        border:`1px solid ${c.border}`,
      }}>
        <div style={{display:"flex",alignItems:"flex-start",gap:16}}>
          <div style={{
            width:48,height:48,borderRadius:12,
            background:c.dot,display:"flex",alignItems:"center",justifyContent:"center",
            flexShrink:0,
          }}>
            <span style={{fontSize:24}}>
              {ev.title.includes("食")||ev.title.includes("ランチ")||ev.title.includes("ディナー") ? "🍽" :
               ev.title.includes("会議")||ev.title.includes("ミーティング") ? "💼" :
               ev.title.includes("病院")||ev.title.includes("医") ? "🏥" :
               ev.title.includes("旅")||ev.title.includes("出張") ? "✈️" :
               ev.title.includes("誕生日") ? "🎂" : "📌"}
            </span>
          </div>
          <div style={{flex:1}}>
            <div style={{fontSize:20,fontWeight:700,color:c.text,lineHeight:1.3}}>{ev.title}</div>
            <div style={{fontSize:14,color:c.text,opacity:0.8,marginTop:4}}>
              {d.getMonth()+1}月{d.getDate()}日（{dow}）
            </div>
          </div>
        </div>
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:0}}>
        {[
          {icon:"⏰", label:"時間", value: ev.isAllDay||!ev.time ? "終日" : fmtTime(ev.time)+(ev.endTime?" 〜 "+fmtTime(ev.endTime):"")},
          ev.repeat&&ev.repeat!=="none" && {icon:"🔁", label:"繰り返し", value: ev.repeat==="weekly"?"毎週":ev.repeat==="monthly"?"毎月":"毎日"},
          ev.notes && {icon:"📝", label:"メモ", value: ev.notes},
        ].filter(Boolean).map((item: any,i) => (
          <div key={i} style={{
            display:"flex",gap:16,padding:"14px 6px",
            borderBottom:`1px solid ${BORDER}`,
            alignItems:"flex-start",
          }}>
            <span style={{fontSize:20,width:28,textAlign:"center"}}>{item.icon}</span>
            <div>
              <div style={{fontSize:12,color:"#9CA3AF",fontWeight:600,letterSpacing:"0.05em",marginBottom:4}}>{item.label}</div>
              <div style={{fontSize:15,color:"#374151",lineHeight:1.5}}>{item.value}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{display:"flex",gap:12,marginTop:24}}>
        <button onClick={onEdit} style={{
          flex:1,padding:"14px 0",borderRadius:12,
          background:c.bg,color:c.text,
          border:`1.5px solid ${c.border}`,fontSize:15,fontWeight:600,cursor:"pointer",
        }}>編集</button>
        <button onClick={onDelete} style={{
          padding:"14px 20px",borderRadius:12,
          background:"#FEF2F2",color:"#DC2626",
          border:`1.5px solid #FCA5A5`,fontSize:15,fontWeight:600,cursor:"pointer",
        }}>削除</button>
      </div>
    </div>
  );
}

/* ── Sheet ── */
function Sheet({ title, onClose, children, size="default" }: any) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);
  const [closing, setClosing] = useState(false);

  const close = () => {
    setClosing(true);
    setTimeout(onClose, 220);
  };

  const handleTouchStart = (e: React.TouchEvent) => { startY.current = e.touches[0].clientY; };
  const handleTouchMove = (e: React.TouchEvent) => {
    if(startY.current === null) return;
    const dy = e.touches[0].clientY - startY.current;
    if(dy > 0) setDragY(dy);
  };
  const handleTouchEnd = () => {
    if(dragY > 80) close();
    else setDragY(0);
    startY.current = null;
  };

  return (
    <div
      style={{
        position:"fixed",inset:0,
        background: closing ? "rgba(0,0,0,0)" : "rgba(0,0,0,0.4)",
        display:"flex",alignItems:"flex-end",justifyContent:"center",
        zIndex:200,
        transition:"background 0.22s",
      }}
      onClick={e => e.target===e.currentTarget && close()}
    >
      <div
        ref={sheetRef}
        style={{
          background:"#fff",
          borderRadius:"24px 24px 0 0",
          width:"100%",maxWidth:600, // シートの幅も少し広げる
          maxHeight: size==="large" ? "95vh" : "85vh",
          display:"flex",flexDirection:"column",
          transform: closing ? "translateY(100%)" : `translateY(${dragY}px)`,
          transition: closing ? "transform 0.22s ease-in" : dragY > 0 ? "none" : "transform 0.28s cubic-bezier(0.32,0.72,0,1)",
          boxShadow:"0 -8px 40px rgba(0,0,0,0.15)",
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div style={{padding:"12px 0 0",display:"flex",justifyContent:"center",cursor:"grab"}}>
          <div style={{width:48,height:5,borderRadius:3,background:"#E5E7EB"}} />
        </div>
        <div style={{
          display:"flex",alignItems:"center",justifyContent:"space-between",
          padding:"10px 24px 16px",
          borderBottom:`1px solid ${BORDER}`,
        }}>
          <span style={{fontSize:18,fontWeight:700,color:"#111827"}}>{title}</span>
          <button onClick={close} style={{
            background:"#F3F4F6",border:"none",
            width:32,height:32,borderRadius:"50%",
            cursor:"pointer",color:"#6B7280",fontSize:18,
            display:"flex",alignItems:"center",justifyContent:"center",
            fontWeight:700,lineHeight:1,
          }}>×</button>
        </div>
        <div style={{overflowY:"auto",padding:"24px 24px 40px",flex:1}}>
          {children}
        </div>
      </div>
    </div>
  );
}

/* ── TextPanel ── */
function TextPanel({ onExtract }: any) {
  const [txt, setTxt] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const examples = [
    "6月15日 午後3時 歯医者",
    "7月2日 10:00〜12:00 チームミーティング",
    "来週月曜 ランチ 山田さんと",
    "毎週水曜 20:00 ヨガ",
  ];

  const go = async () => {
    if(!txt.trim()) return;
    setLoading(true); setErr("");
    try {
      const res = await aiExtract(txt, null);
      if(res.length) onExtract(res);
      else setErr("予定が見つかりませんでした。もう少し詳しく書いてみてください。");
    } catch(e: any) { setErr(`解析に失敗しました: ${e.message}`); }
    setLoading(false);
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div style={{
        background:"#F0FDF4",borderRadius:12,padding:"14px 16px",
        border:"1px solid #86EFAC",
        fontSize:13,color:"#166534",lineHeight:1.7,
      }}>
        💡 自然な日本語で予定を入力すると、AIが自動で解析します
      </div>
      <textarea
        value={txt}
        onChange={e => setTxt(e.target.value)}
        rows={6}
        placeholder={examples.join("\n")}
        style={{
          width:"100%",boxSizing:"border-box" as const,padding:"16px",
          borderRadius:12,border:`1.5px solid ${BORDER_STRONG}`,
          fontSize:15,background:"#FAFAFA",color:"#111827",
          resize:"none",lineHeight:1.8,outline:"none",
          fontFamily:"inherit",
        }}
      />
      {err && (
        <div style={{
          fontSize:14,color:"#DC2626",background:"#FEF2F2",
          padding:"12px 16px",borderRadius:10,
          border:"1px solid #FCA5A5",
        }}>{err}</div>
      )}
      <button onClick={go} disabled={loading||!txt.trim()} style={{
        padding:"16px 0",borderRadius:12,
        background: loading||!txt.trim() ? "#D1D5DB" : "#3B82F6",
        color:"#fff",border:"none",fontSize:16,fontWeight:600,cursor:"pointer",
        transition:"background 0.2s",
      }}>
        {loading ? "⏳ 解析中…" : "解析して追加"}
      </button>
    </div>
  );
}

/* ── PendingReview ── */
function PendingReview({ pending, onConfirm, onClose }: any) {
  const [sel, setSel] = useState<number[]>(pending.map((_: any,i: number)=>i));
  const [eds, setEds] = useState<any[]>(pending.map((e: any)=>({...e})));

  const toggle = (i: number) => setSel(s => s.includes(i) ? s.filter(x=>x!==i) : [...s,i]);

  const upd = (i: number, k: string, v: any) => setEds(es => es.map((e,idx) => {
    if(idx !== i) return e;
    const updated = {...e, [k]:v};
    if(k === "time") {
      const prevStart = e.time;
      const prevEnd   = e.endTime;
      if(prevStart && prevEnd && v) {
        const [sh,sm] = prevStart.split(":").map(Number);
        const [eh,em] = prevEnd.split(":").map(Number);
        const diff = (eh*60+em) - (sh*60+sm);
        updated.endTime = diff > 0 ? addMinutes(v, diff) : addMinutes(v, 30);
      } else {
        updated.endTime = v ? addMinutes(v, 30) : "";
      }
    }
    return updated;
  }));

  return (
    <div>
      <div style={{
        display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,
      }}>
        <p style={{fontSize:14,color:"#6B7280",margin:0}}>
          <strong style={{color:"#111827"}}>{pending.length}件</strong> が見つかりました
        </p>
        <button
          onClick={()=>setSel(sel.length===pending.length ? [] : pending.map((_: any,i: number)=>i))}
          style={{
            fontSize:14,color:"#3B82F6",background:"none",border:"none",
            cursor:"pointer",fontWeight:600,
          }}
        >
          {sel.length===pending.length ? "全解除" : "全選択"}
        </button>
      </div>
      {eds.map((ev,i) => {
        const c = getColor(ev.colorId || colorForTitle(ev.title));
        const on = sel.includes(i);
        return (
          <div key={i} style={{
            borderRadius:14,padding:"16px",marginBottom:10,
            background: on ? c.bg : "#F9FAFB",
            border:`1.5px solid ${on ? c.border : BORDER}`,
            transition:"all 0.15s",
          }}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
              <div onClick={()=>toggle(i)} style={{
                width:24,height:24,borderRadius:6,flexShrink:0,cursor:"pointer",
                border:`2px solid ${on ? c.dot : "#D1D5DB"}`,
                background: on ? c.dot : "#fff",
                display:"flex",alignItems:"center",justifyContent:"center",
              }}>
                {on && <span style={{color:"#fff",fontSize:14,fontWeight:700}}>✓</span>}
              </div>
              <input
                value={ev.title}
                onChange={e => upd(i,"title",e.target.value)}
                style={{
                  flex:1,border:"none",background:"transparent",
                  fontSize:16,fontWeight:600,color:on ? c.text : "#6B7280",
                  outline:"none",fontFamily:"inherit",
                }}
              />
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",paddingLeft:36}}>
              <input type="date" value={ev.date} onChange={e=>upd(i,"date",e.target.value)} style={{
                fontSize:13,border:`1px solid ${BORDER_STRONG}`,borderRadius:8,
                padding:"6px 10px",background:"transparent",color:"#374151",
              }} />
              {!ev.isAllDay && (<>
                <input type="time" value={ev.time||""} onChange={e=>upd(i,"time",e.target.value)} style={{
                  fontSize:13,border:`1px solid ${BORDER_STRONG}`,borderRadius:8,
                  padding:"6px 10px",background:"transparent",color:"#374151",
                }} />
                {ev.time && (
                  <>
                    <span style={{fontSize:12,color:"#9CA3AF",alignSelf:"center"}}>〜</span>
                    <input type="time" value={ev.endTime||""} onChange={e=>upd(i,"endTime",e.target.value)} style={{
                      fontSize:13,border:`1px solid ${BORDER_STRONG}`,borderRadius:8,
                      padding:"6px 10px",background:"transparent",color:"#374151",
                    }} />
                  </>
                )}
              </>)}
            </div>
          </div>
        );
      })}
      <div style={{display:"flex",gap:10,marginTop:20}}>
        <button onClick={()=>onConfirm(eds.filter((_,i)=>sel.includes(i)))} disabled={sel.length===0} style={{
          flex:1,padding:"16px 0",borderRadius:12,
          background: sel.length > 0 ? "#3B82F6" : "#D1D5DB",
          color:"#fff",border:"none",fontSize:16,fontWeight:600,cursor:"pointer",
        }}>{sel.length}件を登録</button>
        <button onClick={onClose} style={{
          padding:"16px 20px",borderRadius:12,
          background:"#F9FAFB",color:"#6B7280",
          border:`1.5px solid ${BORDER}`,fontSize:15,fontWeight:600,cursor:"pointer",
        }}>キャンセル</button>
      </div>
    </div>
  );
}

/* ── DayDetail ── */
function DayDetail({ date, events, onEventClick, onAddNew }: any) {
  const evs = events
    .filter((e: any) => e.date===date)
    .sort((a: any,b: any) => (a.time||"zz").localeCompare(b.time||"zz"));

  const d = new Date(date);
  const dow = ["日","月","火","水","木","金","土"][d.getDay()];
  const isSun = d.getDay()===0, isSat = d.getDay()===6;

  return (
    <div>
      <div style={{
        textAlign:"center",padding:"10px 0 20px",
        borderBottom:`1px solid ${BORDER}`,marginBottom:16,
      }}>
        <div style={{fontSize:36,fontWeight:700,color:"#111827"}}>{d.getDate()}</div>
        <div style={{fontSize:15,color: isSun?"#F43F5E":isSat?"#0EA5E9":"#6B7280",marginTop:4}}>
          {d.getMonth()+1}月 · {dow}曜日
        </div>
      </div>

      {evs.length === 0 ? (
        <div style={{textAlign:"center",padding:"32px 0",color:"#9CA3AF",fontSize:15}}>
          この日の予定はありません
        </div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {evs.map((ev: any) => {
            const c = getColor(ev.colorId || colorForTitle(ev.title));
            return (
              <div key={ev.id} onClick={()=>onEventClick(ev)} style={{
                display:"flex",alignItems:"stretch",gap:0,
                borderRadius:12,background:"#fff",cursor:"pointer",
                overflow:"hidden",border:`1px solid ${BORDER}`,
                boxShadow:"0 1px 3px rgba(0,0,0,0.03)",
              }}>
                <div style={{width:5,background:c.dot,flexShrink:0}} />
                <div style={{padding:"12px 16px",flex:1}}>
                  <div style={{fontSize:15,fontWeight:600,color:"#111827"}}>{ev.title}</div>
                  <div style={{fontSize:13,color:"#6B7280",marginTop:4}}>
                    {ev.isAllDay||!ev.time ? "終日" : fmtTime(ev.time)}
                    {ev.endTime ? " 〜 "+fmtTime(ev.endTime) : ""}
                  </div>
                  {ev.notes&&<div style={{fontSize:13,color:"#9CA3AF",marginTop:6}}>{ev.notes}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <button onClick={onAddNew} style={{
        width:"100%",marginTop:20,padding:"14px 0",borderRadius:12,
        background:"#EBF4FF",color:"#1E40AF",
        border:`1.5px solid #93C5FD`,fontSize:15,fontWeight:600,cursor:"pointer",
      }}>
        + この日に予定を追加
      </button>
    </div>
  );
}

/* ── SyncBadge ── */
function SyncBadge({ sync }: { sync: string }) {
  const configs: Record<string, { icon: string, color: string, label: string }> = {
    saving: { icon:"⟳", color:"#F59E0B", label:"保存中" },
    saved:  { icon:"✓", color:"#22C55E", label:"保存済" },
    error:  { icon:"⚠", color:"#EF4444", label:"エラー" },
    idle:   { icon:"☁", color:"#9CA3AF", label:"" },
  };

  const c = configs[sync] || configs.idle;
  return (
    <div style={{display:"flex",alignItems:"center",gap:6}}>
      <span style={{fontSize:16,color:c.color}}>{c.icon}</span>
      {c.label && <span style={{fontSize:12,color:c.color,fontWeight:600}}>{c.label}</span>}
    </div>
  );
}

/* ── App ── */
export default function App() {
  const [mounted, setMounted] = useState(false);
  const now = new Date();
  const [view, setView] = useState("month");

  const [yr, setYr] = useState(now.getFullYear());
  const [mo, setMo] = useState(now.getMonth());

  const [weekStartDate, setWeekStartDate] = useState(() => {
    const d = new Date(now);
    let dow = d.getDay(); dow = dow===0?6:dow-1;
    d.setDate(d.getDate()-dow);
    d.setHours(0,0,0,0);
    return d;
  });

  const [events, setEvents] = useState<any[]>([]);
  const [sheet, setSheet] = useState<any>(null);
  const [sync, setSync] = useState("idle");
  const [imgLoading, setImgLoading] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const localData = localStorage.getItem(STORAGE_KEY);
      if (localData) {
        setEvents(JSON.parse(localData));
        return;
      }
      if (typeof window !== "undefined" && (window as any).storage) {
        const r = await (window as any).storage.get(STORAGE_KEY, true);
        if(r?.value) {
          const d = JSON.parse(r.value);
          setEvents(Array.isArray(d) ? d : []);
        }
      }
    } catch (e) {
      console.error("Failed to load events:", e);
    }
  }, []);

  const save = useCallback(async (evs: any[]) => {
    setSync("saving");
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(evs));
      if (typeof window !== "undefined" && (window as any).storage) {
        await (window as any).storage.set(STORAGE_KEY, JSON.stringify(evs), true);
      }
      setSync("saved");
      setTimeout(() => setSync("idle"), 2000);
    } catch {
      setSync("error");
    }
  }, []);

  useEffect(() => {
  setMounted(true);
  load();
  const t = setInterval(load, 30000);
  return () => clearInterval(t);
}, [load]);
if (!mounted) return null;
  const persist = async (evs: any[]) => { setEvents(evs); await save(evs); };

  const saveEvent = async (form: any) => {
    const cleaned = {...form};
    delete cleaned._colorManual;
    const updated = cleaned.id
      ? events.map(e => e.id===cleaned.id ? cleaned : e)
      : [...events, {...cleaned, id:genId(), colorId:cleaned.colorId||colorForTitle(cleaned.title)}];
    await persist(updated);
    setSheet(null);
  };

  const deleteEvent = async (id: string) => {
    await persist(events.filter(e => e.id!==id));
    setSheet(null);
  };

  const addEvents = async (evs: any[]) => {
    await persist([...events, ...evs.map(e => ({
      id:genId(),
      colorId: e.colorId || colorForTitle(e.title),
      ...e
    }))]);
  };

  const handleImg = async (file: File) => {
    setImgLoading(true);
    try {
      const b64 = await toJpegBase64(file);
      const extracted = await aiExtract(null, b64);
      if(extracted.length)
        setSheet({ type:"pending", pending:extracted.map((e: any)=>({...e,colorId:colorForTitle(e.title)})) });
      else
        setSheet({ type:"imgError", msg:"予定が見つかりませんでした。カレンダー・スケジュール表の画像を試してください。" });
    } catch(e: any) {
      setSheet({ type:"imgError", msg:`解析に失敗しました: ${e.message}` });
    }
    setImgLoading(false);
  };

  const handleTextExtract = (evs: any[]) => {
    setSheet({ type:"pending", pending:evs.map(e=>({...e,colorId:colorForTitle(e.title)})) });
  };

  const openTextPanel = () => {
    setSheet({type:"text"});
  };

  const goToToday = () => {
    setYr(now.getFullYear());
    setMo(now.getMonth());
    const d = new Date(now);
    let dow = d.getDay();
    dow = dow===0?6:dow-1;
    d.setDate(d.getDate()-dow);
    d.setHours(0,0,0,0);
    setWeekStartDate(new Date(d));
  };

  const prev = () => {
    if(view==="week") {
      const d = new Date(weekStartDate);
      d.setDate(d.getDate()-7);
      setWeekStartDate(new Date(d));
      setYr(d.getFullYear()); setMo(d.getMonth());
    } else if(mo===0) { setMo(11); setYr(y=>y-1); }
    else setMo(m => m-1);
  };

  const next = () => {
    if(view==="week") {
      const d = new Date(weekStartDate);
      d.setDate(d.getDate()+7);
      setWeekStartDate(new Date(d));
      setYr(d.getFullYear()); setMo(d.getMonth());
    } else if(mo===11) { setMo(0); setYr(y=>y+1); }
    else setMo(m => m+1);
  };

  const switchView = (v: string) => {
    if(v === "week" && view !== "week") {
      const d = new Date(yr, mo, 1);
      let dow = d.getDay(); dow = dow===0?6:dow-1;
      d.setDate(d.getDate()-dow);
      d.setHours(0,0,0,0);
      setWeekStartDate(new Date(d));
    }
    if(v !== "week" && view === "week") {
      setYr(weekStartDate.getFullYear());
      setMo(weekStartDate.getMonth());
    }
    setView(v);
  };

  const isCurrentMonth = yr===now.getFullYear() && mo===now.getMonth();
  const isCurrentWeek = (() => {
    const todayWeek = new Date(now);
    let dow = todayWeek.getDay(); dow = dow===0?6:dow-1;
    todayWeek.setDate(todayWeek.getDate()-dow);
    todayWeek.setHours(0,0,0,0);
    return weekStartDate.getTime() === todayWeek.getTime();
  })();

  const openNew = (date: string, time="") => setSheet({ type:"new", date, time });

  const handleDayClick = (d: number) => {
    const date = `${yr}-${pad(mo+1)}-${pad(d)}`;
    setSheet({ type:"day", date });
  };

  const handleEventClick = (ev: any) => setSheet({ type:"detail", ev });

  const monthKey = `${yr}-${pad(mo+1)}`;
  const monthEvents = events.filter(e => e.date?.startsWith(monthKey));

  const weekEnd = new Date(weekStartDate);
  weekEnd.setDate(weekEnd.getDate()+6);
  const weekLabel = weekStartDate.getMonth() === weekEnd.getMonth()
    ? `${weekStartDate.getMonth()+1}月`
    : `${weekStartDate.getMonth()+1}〜${weekEnd.getMonth()+1}月`;

  const headerLabel = view === "week" ? weekLabel : `${mo+1}月`;

  const showYear = view === "week"
    ? (weekStartDate.getFullYear() !== now.getFullYear())
    : (yr !== now.getFullYear());

  return (
    <div
style={{
maxWidth: "393px",
width: "100%",
margin: "0 auto",
}}
> 
<div style={{
        position:"sticky",top:0,zIndex:10,background:"#fff",
        borderBottom:`1px solid ${BORDER_STRONG}`,
      }}>
        <div style={{
          display:"flex",alignItems:"center",
          justifyContent:"space-between",
          padding:"16px 20px 0",
        }}>
          <div style={{display:"flex",alignItems:"baseline",gap:10}}>
            <button onClick={prev} style={{
              background:"none",border:"none",
              fontSize:24,cursor:"pointer",color:"#6B7280",
              padding:"0",lineHeight:1,width:32,height:32,
              display:"flex",alignItems:"center",justifyContent:"center",
              borderRadius:"50%",
            }}>‹</button>
            <div>
              <span style={{fontSize:28,fontWeight:700,color:"#111827",letterSpacing:"-0.5px"}}>
                {headerLabel}
              </span>
              {showYear && (
                <span style={{fontSize:15,color:"#9CA3AF",marginLeft:6}}>
                  {view === "week" ? weekStartDate.getFullYear() : yr}
                </span>
              )}
            </div>
            <button onClick={next} style={{
              background:"none",border:"none",
              fontSize:24,cursor:"pointer",color:"#6B7280",
              padding:"0",lineHeight:1,width:32,height:32,
              display:"flex",alignItems:"center",justifyContent:"center",
              borderRadius:"50%",
            }}>›</button>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            {view !== "week" && monthEvents.length > 0 && (
              <div style={{
                fontSize:13,color:"#6B7280",
                background:"#F3F4F6",borderRadius:20,
                padding:"4px 12px",fontWeight:600,
              }}>
                {monthEvents.length}件
              </div>
            )}
            <SyncBadge sync={sync} />
          </div>
        </div>

        <div style={{
          display:"flex",gap:8,
          padding:"12px 20px 0",
        }}>
          {[["month","月"],["week","週"],["list","一覧"]].map(([m,l]) => (
            <button key={m} onClick={()=>switchView(m)} style={{
              flex:1,padding:"10px 0",borderRadius:10,border:"none",
              background: view===m ? "#111827" : "#F3F4F6",
              color: view===m ? "#fff" : "#6B7280",
              fontSize:14,cursor:"pointer",
              fontWeight: view===m ? 600 : 500,
              transition:"all 0.15s",
            }}>{l}</button>
          ))}
          {((view !== "week" && !isCurrentMonth) || (view === "week" && !isCurrentWeek)) && (
            <button onClick={goToToday} style={{
              padding:"10px 16px",borderRadius:10,border:"none",
              background:"#EBF4FF",color:"#1E40AF",
              fontSize:14,cursor:"pointer",fontWeight:600,
              whiteSpace:"nowrap",
            }}>今{view==="week"?"週":"月"}</button>
          )}
        </div>

        <div style={{display:"flex",gap:8,padding:"12px 20px 16px"}}>
          <input ref={fileRef} type="file" accept="image/*,image/heic" style={{display:"none"}}
            onChange={e => { if(e.target.files?.[0]) handleImg(e.target.files[0]); e.target.value=""; }} />
          <button onClick={()=>fileRef.current?.click()} disabled={imgLoading} style={{
            flex:1,padding:"10px 0",borderRadius:10,
            border:`1px solid ${BORDER_STRONG}`,background:"#FAFAFA",
            fontSize:14,cursor:"pointer",color:"#374151",fontWeight:600,
          }}>
            {imgLoading ? "⏳ 解析中" : "📷 写真から"}
          </button>
          <button onClick={openTextPanel} style={{
            flex:1,padding:"10px 0",borderRadius:10,
            border:`1px solid ${BORDER_STRONG}`,background:"#FAFAFA",
            fontSize:14,cursor:"pointer",color:"#374151",fontWeight:600,
          }}>✏️ テキストから</button>
          <button
            onClick={()=>openNew(
              view==="week"
                ? `${weekStartDate.getFullYear()}-${pad(weekStartDate.getMonth()+1)}-${pad(weekStartDate.getDate())}`
                : `${yr}-${pad(mo+1)}-${pad(now.getDate())}`
            )}
            style={{
              padding:"10px 24px",borderRadius:10,border:"none",
              background:"#111827",color:"#fff",
              fontSize:22,cursor:"pointer",lineHeight:1,fontWeight:700,
            }}>+</button>
        </div>
      </div>

      <div style={{flex:1}}>
        {view==="month" && (
          <MonthView
            year={yr} month={mo} events={events}
            onDayClick={handleDayClick}
            onEventClick={handleEventClick}
          />
        )}
        {view==="week" && (
          <WeekView
            weekStart={weekStartDate} events={events}
            onEventClick={handleEventClick}
            onSlotClick={(ds: string,time: string) => openNew(ds,time)}
          />
        )}
        {view==="list" && (
          <ListView events={events} onEventClick={handleEventClick} />
        )}
      </div>

      {sheet?.type==="day" && (
        <Sheet title="この日の予定" onClose={()=>setSheet(null)}>
          <DayDetail
            date={sheet.date}
            events={events}
            onEventClick={(ev: any) => setSheet({type:"detail",ev})}
            onAddNew={()=>setSheet({type:"new",date:sheet.date,time:""})}
          />
        </Sheet>
      )}
      {sheet?.type==="detail" && (
        <Sheet title="予定の詳細" onClose={()=>setSheet(null)}>
          <EventDetail
            ev={sheet.ev}
            onEdit={()=>setSheet({type:"edit",ev:sheet.ev})}
            onDelete={()=>deleteEvent(sheet.ev.id)}
            onClose={()=>setSheet(null)}
          />
        </Sheet>
      )}
      {sheet?.type==="new" && (
        <Sheet title="新しい予定" onClose={()=>setSheet(null)} size="large">
          <EventForm
            init={{date:sheet.date,time:sheet.time,endTime:"",isAllDay:false,repeat:"none",notes:"",colorId:"blue"}}
            onSave={saveEvent}
          />
        </Sheet>
      )}
      {sheet?.type==="edit" && (
        <Sheet title="予定を編集" onClose={()=>setSheet(null)} size="large">
          <EventForm
            init={sheet.ev}
            onSave={saveEvent}
            onDelete={()=>deleteEvent(sheet.ev.id)}
          />
        </Sheet>
      )}
      {sheet?.type==="text" && (
        <Sheet title="テキストから読み込む" onClose={()=>setSheet(null)}>
          <TextPanel
            onExtract={handleTextExtract}
          />
        </Sheet>
      )}
      {sheet?.type==="pending" && (
        <Sheet title="予定を確認" onClose={()=>setSheet(null)} size="large">
          <PendingReview
            pending={sheet.pending}
            onConfirm={async (confirmed: any) => { await addEvents(confirmed); setSheet(null); }}
            onClose={()=>setSheet(null)}
          />
        </Sheet>
      )}
      {sheet?.type==="imgError" && (
        <Sheet title="読み込みエラー" onClose={()=>setSheet(null)}>
          <div style={{display:"flex",flexDirection:"column",gap:20,paddingTop:8}}>
            <div style={{
              background:"#FEF2F2",borderRadius:14,padding:"20px",
              border:"1px solid #FCA5A5",
              fontSize:14,color:"#991B1B",lineHeight:1.7,
            }}>
              {sheet.msg}
            </div>
            <div style={{fontSize:14,color:"#6B7280",lineHeight:1.8}}>
              <div style={{fontWeight:600,color:"#374151",marginBottom:8}}>確認事項</div>
              <div>・写真にカレンダーや予定表が含まれていますか？</div>
              <div>・文字がはっきり写っていますか？</div>
              <div>・JPEG / PNG / HEIC 形式の画像ですか？</div>
            </div>
            <button onClick={()=>{setSheet(null);fileRef.current?.click();}} style={{
              padding:"14px 0",borderRadius:12,
              background:"#EBF4FF",color:"#1E40AF",
              border:"1.5px solid #93C5FD",fontSize:15,fontWeight:600,cursor:"pointer",
            }}>別の画像を選ぶ</button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
