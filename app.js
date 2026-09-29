(() => {
  const DB_NAME = 'analizador_copes_v1';
  const STORE = 'state';
  const KEY = 'dataset';
  const EMPTY = { actions: [], proposals: [], registrations: [], attendance: [], imports: [], sources: [] };
  let dataset = structuredClone(EMPTY);
  let charts = {};
  const PALETTE = ['#167566','#2f7fe0','#7b68c7','#d18a3a','#3aa7a0','#7d8c99','#bd6a5a','#5d9b63','#8a6bb8','#c49a3f'];
  let filtered = { registrations: [], attendance: [], proposals: [] };

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const esc = (v='') => String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const normalize = (v='') => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const codeIn = (v='') => (String(v ?? '').match(/C\d{4}(?:[-_]\d+)?/i)?.[0] || '').toUpperCase().replace('_','-');
  const mainCodeIn = (v='') => (String(v ?? '').match(/C\d{4}/i)?.[0] || '').toUpperCase();
  const num = (v) => Number(String(v ?? '').replace(',','.')) || 0;
  const unique = (arr) => [...new Set(arr.filter(v => v !== null && v !== undefined && String(v).trim() !== '').map(v => String(v).trim()))];
  const sortAlpha = (arr) => arr.sort((a,b) => a.localeCompare(b,'es',{numeric:true,sensitivity:'base'}));
  const idOf = (r) => String(r.dni || r.email || r.name || '').trim().toLowerCase();

  function toast(msg){
    const el = $('#toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(()=>el.classList.remove('show'),2600);
  }

  function openDb(){
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB_NAME,1);
      req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE)};
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    });
  }
  async function saveState(){
    const db=await openDb();
    await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(dataset,KEY);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});
    db.close();
  }
  async function loadState(){
    const db=await openDb();
    const value=await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly');const r=tx.objectStore(STORE).get(KEY);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
    db.close(); dataset={...structuredClone(EMPTY), ...(value || {})};
    if(!Array.isArray(dataset.sources)) dataset.sources=[];
  }
  async function clearState(){
    const db=await openDb();
    await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(KEY);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});
    db.close(); dataset=structuredClone(EMPTY); renderAll();
  }

  function spreadsheetIdFromUrl(url=''){
    return String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1] || '';
  }

  function sourceAuthLabel(mode){
    return ({public_link:'Por link',technical_account:'Cuenta técnica',delegated:'Autenticado'})[mode] || mode || '—';
  }

  function sourceStatusLabel(status){
    return ({pending_backend:'Pendiente backend',ok:'Sincronizada',error:'Error'})[status] || status || 'Pendiente backend';
  }

  function mapRow(row){
    const m={}; Object.entries(row||{}).forEach(([k,v])=>m[normalize(k)]=v); return m;
  }
  function pick(m, keys){
    for(const k of keys){const v=m[normalize(k)]; if(v!==null && v!==undefined && String(v).trim()!=='') return v}
    return '';
  }
  function formatDate(v){
    if(!v) return '';
    const d = v instanceof Date ? v : new Date(v);
    if(!Number.isNaN(d.getTime())) return d.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'});
    const s=String(v); const m=s.match(/(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?/);
    if(m) return [m[1].padStart(2,'0'),m[2].padStart(2,'0'),m[3] ? String(m[3]).slice(-4) : ''].filter(Boolean).join('/');
    return s;
  }
  function isoDate(v, year){
    if(!v) return '';
    if(v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0,10);
    const s=String(v); const m=s.match(/(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?/);
    if(!m) return '';
    const y = m[3] ? (m[3].length===2 ? '20'+m[3] : m[3]) : String(year || new Date().getFullYear());
    return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  }
  function cleanSchool(v){
    let s=String(v||'').trim(); if(!s) return '';
    if(s.includes('\n')){ const parts=s.split(/\n+/).map(x=>x.trim()).filter(Boolean); if(parts.length>1) s=parts[parts.length-1] }
    s=s.replace(/^[A-Z]-?\d+[A-Z]?\s*\|\s*/i,'').replace(/\s*-\s*\d{7,9}\s*$/,'').trim();
    return s;
  }
  function parseDependencyFromSchool(v){
    const parts=String(v||'').split(/\n+/).map(x=>x.trim()).filter(Boolean); return parts.length>1 ? parts[0] : '';
  }
  function actionTitle(fileName, code){
    return fileName.replace(/\.xlsx?$|\.csv$/i,'').replace(code,'').replace(/^\s*[-_]+|\s*[-_]+$/g,'').replace(/\s*[_-]\s*(Inscripci[oó]n|Inscripcion).*$/i,'').trim() || code;
  }
  function yearIn(fileName, rows=[]){
    const y=String(fileName).match(/20\d{2}/)?.[0]; if(y) return Number(y);
    for(const r of rows){ for(const v of Object.values(r)){ const m=String(v??'').match(/20\d{2}/); if(m) return Number(m[0]) }}
    return new Date().getFullYear();
  }
  function splitTutors(v){
    return unique(String(v||'').split(/\n|;/).map(x=>x.trim().replace(/^[-•]+/,'').trim()).filter(Boolean).map(x=>x.replace(/\s*-\s*\d{7,8}\s*$/,'')));
  }

  function parseWorkbook(file, wb){
    const code=mainCodeIn(file.name);
    if(!code) throw new Error('No se detectó un código de acción tipo C0000 en el nombre del archivo.');
    const allSheets={};
    wb.SheetNames.forEach(name=>{ allSheets[name]=XLSX.utils.sheet_to_json(wb.Sheets[name],{defval:'',raw:true}) });
    const sheetBy=(term)=>Object.entries(allSheets).find(([n])=>normalize(n).includes(term))?.[1] || [];
    const proposalsRows=sheetBy('propuesta');
    const regRows=sheetBy('inscrip');
    const attRows=Object.entries(allSheets).find(([n])=>normalize(n)==='asistencias')?.[1] || sheetBy('asisten');
    const year=yearIn(file.name,[...proposalsRows.slice(0,4),...regRows.slice(0,4)]);
    const title=actionTitle(file.name,code);

    const proposals=proposalsRows.map(raw=>{
      const m=mapRow(raw);
      const pcode=(codeIn(pick(m,['Codigo','Código'])) || code).toUpperCase();
      const commission=String(pick(m,['Comisión','Comision','Taller','Propuesta'])||pcode).trim();
      const meetingCols=Object.entries(raw).filter(([k,v])=>/^enc\.?\s*\d+/i.test(String(k)) && v).map(([k,v])=>({label:k,text:String(v),date:isoDate(v,year)}));
      const baseDate=isoDate(pick(m,['Fecha']),year);
      if(baseDate && !meetingCols.length) meetingCols.push({label:'Encuentro',text:formatDate(pick(m,['Fecha'])),date:baseDate});
      return {
        actionCode:code, code:pcode, commission,
        area:String(pick(m,['Área','Area'])||'').trim(),
        formation:String(pick(m,['Formación','Formacion'])||'').trim(),
        venue:String(pick(m,['Sede'])||'').trim(),
        shift:String(pick(m,['Turno','Horario'])||'').trim(),
        capacity:num(pick(m,['Cupo'])),
        registeredReported:num(pick(m,['# Inscr.','# Inscr'])),
        tutors:splitTutors(pick(m,['Capacitador','Tutor','Capacitadores'])),
        meetings:meetingCols
      };
    }).filter(r=>r.code);

    const pMap=new Map(proposals.map(p=>[p.code,p]));

    const registrations=regRows.map(raw=>{
      const m=mapRow(raw);
      let pcode=codeIn(pick(m,['Codigo','Código','Taller','Propuesta'])) || code;
      pcode=pcode.toUpperCase();
      const p=pMap.get(pcode);
      const schoolRaw=pick(m,['Establecimiento','Escuela / Establecimiento','Escuela']);
      const school=cleanSchool(schoolRaw);
      return {
        actionCode:code, commissionCode:pcode,
        dni:String(pick(m,['DNI'])||'').replace(/\.0$/,'').trim(),
        cuil:String(pick(m,['Cuil','CUIL'])||'').trim(),
        name:[pick(m,['Nombre','Nombre/s']),pick(m,['Apellido','Apellido/s'])].filter(Boolean).join(' ').trim(),
        email:String(pick(m,['Correo','Email'])||'').trim(),
        school,
        dependency:String(pick(m,['Dep. Fun','Dependencia'])||parseDependencyFromSchool(schoolRaw)||'').trim(),
        region:String(pick(m,['DE','DE/Región','DE o Región'])||'').trim(),
        area:String(pick(m,['Area','Área'])||p?.area||'').trim(),
        formation:String(pick(m,['Formación','Formacion','Tipo de Formación'])||p?.formation||'').trim(),
        venue:String(pick(m,['Sede'])||p?.venue||'').trim(),
        shift:String(pick(m,['Turno'])||p?.shift||'').trim(),
        tutor:(p?.tutors||[]).join(' · '),
        registrationDate:isoDate(pick(m,['Fecha y hora','Fecha']),year),
        source:file.name
      };
    }).filter(r=>idOf(r));

    const attendance=attRows.map(raw=>{
      const m=mapRow(raw);
      let pcode=codeIn(pick(m,['Codigo','Código','Comision','Comisión','Taller','Propuesta'])) || code;
      pcode=pcode.toUpperCase();
      const p=pMap.get(pcode);
      const encounter=String(pick(m,['Encuentro','Encuentro N°','Encuentro N','Enc.'])||'').trim();
      let eventDate='';
      if(p){
        const meet=encounter ? p.meetings.find(x=>normalize(x.label)===normalize(encounter)) : p.meetings[0];
        eventDate=meet?.date || '';
      }
      if(!eventDate) eventDate=isoDate(pick(m,['Fecha de encuentro','Fecha']),year);
      const schoolRaw=pick(m,['Establecimiento','Escuela / Establecimiento','Escuela']);
      return {
        actionCode:code, commissionCode:pcode,
        dni:String(pick(m,['DNI'])||'').replace(/\.0$/,'').trim(),
        name:[pick(m,['Nombre','Nombre/s']),pick(m,['Apellido','Apellido/s'])].filter(Boolean).join(' ').trim(),
        email:String(pick(m,['Correo','Email'])||'').trim(),
        school:cleanSchool(schoolRaw),
        dependency:String(pick(m,['Dep. Fun','Dependencia'])||parseDependencyFromSchool(schoolRaw)||'').trim(),
        region:String(pick(m,['DE/Región','DE','DE o Región'])||'').trim(),
        area:String(pick(m,['Area','Área'])||p?.area||'').trim(),
        formation:String(pick(m,['Formación','Formacion','Tipo de Formación'])||p?.formation||'').trim(),
        venue:String(pick(m,['Sede'])||p?.venue||'').trim(),
        shift:String(pick(m,['Turno'])||p?.shift||'').trim(),
        tutor:(p?.tutors||[]).join(' · '),
        encounter:encounter || (p?.meetings?.[0]?.label || ''),
        eventDate,
        capturedAt:isoDate(pick(m,['Fecha y hora','Fecha']),year),
        source:file.name
      };
    }).filter(r=>idOf(r));

    const mismatches=[];
    for(const [sheetName,rows] of Object.entries(allSheets)){
      for(const row of rows.slice(0,4000)){
        for(const [k,v] of Object.entries(row)){
          if(!normalize(k).includes('codigo')) continue;
          const mc=mainCodeIn(v);
          if(mc && mc!==code) mismatches.push({sheet:sheetName,column:k,found:mc});
        }
      }
    }
    const mismatchSummary=Object.values(mismatches.reduce((a,x)=>{const k=`${x.sheet}|${x.column}|${x.found}`;a[k]=a[k]||{...x,count:0};a[k].count++;return a},{}));

    return {
      action:{code,title,year,source:file.name},
      proposals, registrations, attendance,
      importInfo:{file:file.name,code,title,proposals:proposals.length,registrations:registrations.length,attendance:attendance.length,mismatches:mismatchSummary}
    };
  }

  function dedupe(rows,keyFn){const m=new Map();for(const r of rows){const k=keyFn(r);if(k)m.set(k,r)}return [...m.values()]}
  function mergeParsed(p){
    const code=p.action.code;
    dataset.actions=dataset.actions.filter(x=>x.code!==code).concat(p.action);
    dataset.proposals=dataset.proposals.filter(x=>x.actionCode!==code).concat(p.proposals);
    dataset.registrations=dataset.registrations.filter(x=>x.actionCode!==code).concat(dedupe(p.registrations,r=>[r.actionCode,r.commissionCode,idOf(r)].join('|')));
    dataset.attendance=dataset.attendance.filter(x=>x.actionCode!==code).concat(dedupe(p.attendance,r=>[r.actionCode,r.commissionCode,idOf(r),r.encounter,r.eventDate,r.capturedAt].join('|')));
    dataset.imports=dataset.imports.filter(x=>x.code!==code).concat({...p.importInfo,when:new Date().toISOString()});
  }

  async function handleFiles(files){
    if(!files.length)return;
    $('#importSummary').textContent='Procesando archivos...';
    const results=[];
    for(const file of files){
      try{
        const data=await file.arrayBuffer();
        const wb=XLSX.read(data,{type:'array',cellDates:true});
        const parsed=parseWorkbook(file,wb); mergeParsed(parsed); results.push({ok:true,...parsed.importInfo});
      }catch(e){results.push({ok:false,file:file.name,error:e.message})}
    }
    await saveState();
    renderImportResults(results); renderAll();
    switchView('imports');
    toast(`${results.filter(x=>x.ok).length} archivo(s) procesado(s)`);
  }

  function renderImportResults(results=dataset.imports){
    const host=$('#importResults');
    if(!results.length){host.innerHTML='<div class="empty">Todavía no hay cargas.</div>';$('#importSummary').textContent='Todavía no cargaste archivos.';return}
    $('#importSummary').textContent=`${dataset.actions.length} acción(es) cargada(s) en esta prueba.`;
    host.innerHTML=results.slice().reverse().map(r=>{
      if(r.ok===false) return `<div class="import-card"><strong>${esc(r.file)}</strong><div class="warning">${esc(r.error)}</div></div>`;
      const warns=(r.mismatches||[]).map(w=>`<div class="warning">Código distinto detectado: <strong>${esc(w.found)}</strong> en ${esc(w.sheet)} / ${esc(w.column)} (${w.count} registro(s)). No se usa como código principal.</div>`).join('');
      return `<div class="import-card"><div class="row"><div><span class="import-code">${esc(r.code)}</span> · <strong>${esc(r.title)}</strong></div><span class="badge">Procesado</span></div><div class="import-meta">${r.proposals||0} comisiones · ${r.registrations||0} inscripciones · ${r.attendance||0} asistencias</div>${warns}</div>`;
    }).join('');
  }

  function fillSelect(sel,values,label='Todos'){
    const old=sel.value; sel.innerHTML=`<option value="">${label}</option>`+sortAlpha(unique(values)).map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join(''); if([...sel.options].some(o=>o.value===old))sel.value=old;
  }

  function currentFilters(){
    return {action:$('#filterAction').value,school:$('#filterSchool').value,tutor:$('#filterTutor').value,area:$('#filterArea').value,venue:$('#filterVenue').value,shift:$('#filterShift').value,q:normalize($('#globalSearch').value)};
  }
  function matches(r,f){
    if(f.action && r.actionCode!==f.action)return false;if(f.school && r.school!==f.school)return false;if(f.tutor && !String(r.tutor||'').includes(f.tutor))return false;if(f.area && r.area!==f.area)return false;if(f.venue && r.venue!==f.venue)return false;if(f.shift && r.shift!==f.shift)return false;
    if(f.q){const hay=normalize([r.dni,r.name,r.email,r.school,r.dependency,r.region,r.area,r.commissionCode,r.tutor,r.venue].join(' '));if(!hay.includes(f.q))return false}
    return true;
  }

  function refreshFilterOptions(){
    fillSelect($('#filterAction'),dataset.actions.map(x=>x.code),'Todas');
    const regs=dataset.registrations;
    fillSelect($('#filterSchool'),regs.map(x=>x.school));
    fillSelect($('#filterTutor'),dataset.proposals.flatMap(x=>x.tutors||[]));
    fillSelect($('#filterArea'),regs.map(x=>x.area).concat(dataset.proposals.map(x=>x.area)));
    fillSelect($('#filterVenue'),regs.map(x=>x.venue).concat(dataset.proposals.map(x=>x.venue)));
    fillSelect($('#filterShift'),regs.map(x=>x.shift).concat(dataset.proposals.map(x=>x.shift)));
  }

  function applyFilters(){
    const f=currentFilters();
    filtered.registrations=dataset.registrations.filter(r=>matches(r,f));
    filtered.attendance=dataset.attendance.filter(r=>matches(r,f));
    filtered.proposals=dataset.proposals.filter(p=>{
      if(f.action && p.actionCode!==f.action)return false;if(f.tutor && !(p.tutors||[]).includes(f.tutor))return false;if(f.area && p.area!==f.area)return false;if(f.venue && p.venue!==f.venue)return false;if(f.shift && p.shift!==f.shift)return false;return true;
    });
    renderDashboard(); renderDetail();
  }

  function groupUnique(rows,labelFn,idFn=idOf){
    const m=new Map();for(const r of rows){const k=labelFn(r)||'Sin dato';if(!m.has(k))m.set(k,new Set());const id=idFn(r);if(id)m.get(k).add(id)}return [...m.entries()].map(([label,s])=>({label,value:s.size}));
  }
  function rate(a,b){return b?Math.round(a/b*1000)/10:0}

  function renderDashboard(){
    const regs=filtered.registrations, atts=filtered.attendance;
    const regIds=new Set(regs.map(idOf).filter(Boolean)); const attIds=new Set(atts.map(idOf).filter(Boolean));
    $('#kpiRegistered').textContent=regIds.size.toLocaleString('es-AR');
    $('#kpiAttendees').textContent=attIds.size.toLocaleString('es-AR');
    $('#kpiRate').textContent=rate([...attIds].filter(x=>regIds.has(x)).length,regIds.size).toLocaleString('es-AR')+'%';
    $('#kpiSchools').textContent=unique(regs.map(x=>x.school)).length.toLocaleString('es-AR');
    $('#kpiCommissions').textContent=unique(regs.map(x=>x.commissionCode)).length.toLocaleString('es-AR');
    $('#kpiAttendanceRows').textContent=atts.length.toLocaleString('es-AR');
    const linkedAttIds=new Set([...attIds].filter(x=>regIds.has(x)));
    const schoolsReg=unique(regs.map(x=>x.school));
    const schoolsAtt=new Set(atts.map(x=>x.school).filter(Boolean));
    $('#insightActions').textContent=unique(regs.map(x=>x.actionCode).concat(atts.map(x=>x.actionCode))).length.toLocaleString('es-AR');
    $('#insightNoShow').textContent=[...regIds].filter(x=>!linkedAttIds.has(x)).length.toLocaleString('es-AR');
    $('#insightSchoolsNoShow').textContent=schoolsReg.filter(x=>x&&!schoolsAtt.has(x)).length.toLocaleString('es-AR');
    $('#exportBtn').disabled=!regs.length;

    const action=$('#filterAction').value;
    const act=dataset.actions.find(x=>x.code===action);
    $('#subtitle').textContent=act ? `${act.code} · ${act.title}` : (dataset.actions.length ? `${dataset.actions.length} acciones cargadas · filtros interactivos` : 'Carga una base para empezar a analizar.');

    const byEvent=groupUnique(atts,r=>r.eventDate ? formatDate(r.eventDate) : (r.encounter||'Sin fecha'));
    byEvent.sort((a,b)=>a.label.localeCompare(b.label,'es',{numeric:true}));
    chart('attendanceChart','line',byEvent.map(x=>x.label),[{label:'Asistentes únicos',data:byEvent.map(x=>x.value),tension:.28,fill:false}]);

    const byArea=groupUnique(regs,r=>r.area||'Sin área').sort((a,b)=>b.value-a.value).slice(0,12);
    chart('areaChart','doughnut',byArea.map(x=>x.label),[{label:'Inscriptos',data:byArea.map(x=>x.value)}]);

    const byDep=groupUnique(regs,r=>r.dependency||'Sin dependencia').sort((a,b)=>b.value-a.value).slice(0,10);
    chart('dependencyChart','bar',byDep.map(x=>x.label),[{label:'Inscriptos',data:byDep.map(x=>x.value)}],{indexAxis:'y'});

    const commRegs=groupUnique(regs,r=>r.commissionCode).sort((a,b)=>b.value-a.value).slice(0,24);
    const attByComm=new Map(groupUnique(atts,r=>r.commissionCode).map(x=>[x.label,x.value]));
    chart('commissionChart','bar',commRegs.map(x=>x.label),[
      {label:'Inscriptos',data:commRegs.map(x=>x.value)},
      {label:'Asistentes',data:commRegs.map(x=>attByComm.get(x.label)||0)}
    ]);

    const schoolAtt=groupUnique(atts,r=>r.school||'Sin escuela').sort((a,b)=>b.value-a.value).slice(0,10);
    chart('schoolChart','bar',schoolAtt.map(x=>x.label),[{label:'Asistentes',data:schoolAtt.map(x=>x.value)}],{indexAxis:'y'});

    const venueAtt=groupUnique(atts,r=>r.venue||'Sin sede').sort((a,b)=>b.value-a.value).slice(0,10);
    chart('venueChart','bar',venueAtt.map(x=>x.label),[{label:'Asistentes',data:venueAtt.map(x=>x.value)}],{indexAxis:'y'});

    const tutorAtt=groupUnique(atts,r=>r.tutor||'Sin tutor').sort((a,b)=>b.value-a.value).slice(0,10);
    chart('tutorChart','bar',tutorAtt.map(x=>x.label),[{label:'Asistentes',data:tutorAtt.map(x=>x.value)}],{indexAxis:'y'});

    const shiftAtt=groupUnique(atts,r=>r.shift||'Sin turno').sort((a,b)=>b.value-a.value).slice(0,8);
    chart('shiftChart','doughnut',shiftAtt.map(x=>x.label),[{label:'Asistentes',data:shiftAtt.map(x=>x.value)}]);

    const schools=groupUnique(regs,r=>r.school||'Sin escuela').sort((a,b)=>b.value-a.value);
    const attSchool=new Map(groupUnique(atts,r=>r.school||'Sin escuela').map(x=>[x.label,x.value]));
    $('#schoolTable').innerHTML=schools.slice(0,80).map(s=>{const a=attSchool.get(s.label)||0;return `<tr><td>${esc(s.label)}</td><td>${s.value}</td><td>${a}</td><td>${rate(a,s.value).toLocaleString('es-AR')}%</td></tr>`}).join('') || '<tr><td colspan="4" class="empty">Sin datos.</td></tr>';

    const absent=regs.filter(r=>!attIds.has(idOf(r)));
    $('#absentTable').innerHTML=absent.slice(0,250).map(r=>`<tr><td>${esc(r.name||r.email||r.dni)}</td><td>${esc(r.school||'—')}</td><td>${esc(r.commissionCode||'—')}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">No hay inscriptos ausentes con estos filtros.</td></tr>';
  }

  function chart(id,type,labels,datasets,extra={}){
    if(charts[id])charts[id].destroy();
    const ctx=document.getElementById(id); if(!ctx)return;
    const styled=datasets.map((d,i)=>{
      if(type==='doughnut') return {...d,backgroundColor:labels.map((_,j)=>PALETTE[j%PALETTE.length]),borderWidth:0,hoverOffset:4};
      if(type==='line') return {...d,borderColor:PALETTE[i%PALETTE.length],backgroundColor:'rgba(22,117,102,.08)',pointBackgroundColor:PALETTE[i%PALETTE.length],pointRadius:3,borderWidth:2.2};
      return {...d,backgroundColor:PALETTE[i%PALETTE.length],borderRadius:6,borderSkipped:false,maxBarThickness:38};
    });
    charts[id]=new Chart(ctx,{
      type,
      data:{labels,datasets:styled},
      options:{
        responsive:true,
        maintainAspectRatio:false,
        interaction:{mode:'nearest',intersect:false},
        plugins:{
          legend:{position:'bottom',labels:{boxWidth:8,usePointStyle:true,padding:14,color:'#6d7983',font:{size:10,weight:600}}},
          tooltip:{backgroundColor:'#10262b',titleColor:'#fff',bodyColor:'#dfe9e7',padding:10,cornerRadius:8}
        },
        scales:type==='doughnut'?{}:{
          x:{grid:{display:false},ticks:{maxRotation:45,minRotation:0,color:'#7a8790',font:{size:9}}},
          y:{beginAtZero:true,grid:{color:'#edf1f3'},ticks:{color:'#7a8790',font:{size:9}}}
        },
        ...extra
      }
    });
  }

  function renderDetail(){
    const q=normalize($('#detailSearch').value);
    const attSet=new Set(filtered.attendance.map(idOf).filter(Boolean));
    const actions=new Map(dataset.actions.map(a=>[a.code,a]));
    const rows=filtered.registrations.filter(r=>!q||normalize([r.dni,r.name,r.school,r.commissionCode,r.area].join(' ')).includes(q)).slice(0,1000);
    $('#detailTable').innerHTML=rows.map(r=>`<tr><td>${esc(r.dni||'—')}</td><td>${esc(r.name||r.email||'—')}</td><td><strong>${esc(r.actionCode)}</strong><br><small>${esc(actions.get(r.actionCode)?.title||'')}</small></td><td>${esc(r.school||'—')}</td><td>${esc(r.area||'—')}</td><td>${esc(r.commissionCode||'—')}</td><td>${attSet.has(idOf(r))?'<span class="badge">Sí</span>':'<span class="badge no">No</span>'}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Sin datos para mostrar.</td></tr>';
  }

  function refreshSourceActionOptions(){
    const sel=$('#sourceAction'); if(!sel) return;
    const old=sel.value;
    sel.innerHTML='<option value="">Seleccionar acción...</option>'+sortAlpha(dataset.actions.map(x=>x.code)).map(code=>`<option value="${esc(code)}">${esc(code)} · ${esc(dataset.actions.find(x=>x.code===code)?.title||'')}</option>`).join('');
    if([...sel.options].some(o=>o.value===old)) sel.value=old;
  }

  function renderSources(){
    if(!$('#sourceTable')) return;
    refreshSourceActionOptions();
    const sources=dataset.sources||[];
    $('#sourceCount').textContent=sources.length.toLocaleString('es-AR');
    $('#sourceActiveCount').textContent=sources.filter(x=>x.active!==false).length.toLocaleString('es-AR');
    $('#sourcePendingCount').textContent=sources.filter(x=>x.status==='pending_backend'||!x.status).length.toLocaleString('es-AR');

    $('#sourceTable').innerHTML=sources.slice().sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||'')).map(s=>{
      const sid=s.spreadsheetId||spreadsheetIdFromUrl(s.url);
      const status=s.status||'pending_backend';
      return `<tr>
        <td><strong>${esc(s.actionCode||'—')}</strong></td>
        <td><span class="source-name">${esc(s.name||'Google Sheet')}</span><span class="source-id">${esc(sid||s.url||'')}</span></td>
        <td>${esc(sourceAuthLabel(s.authMode))}</td>
        <td>cada ${Number(s.intervalMinutes)||5} min</td>
        <td><span class="source-status ${status==='ok'?'ok':status==='error'?'error':'pending'}">${esc(sourceStatusLabel(status))}</span></td>
        <td>${s.lastSyncAt?new Date(s.lastSyncAt).toLocaleString('es-AR'):'—'}</td>
        <td><button class="source-action-btn" data-remove-source="${esc(s.id)}">Quitar</button></td>
      </tr>`;
    }).join('') || '<tr><td colspan="7" class="empty">Todavía no registraste fuentes. Podés asociar el link de cada Google Sheet desde el formulario.</td></tr>';

    $('[data-remove-source]').forEach(btn=>btn.addEventListener('click',async()=>{
      const id=btn.dataset.removeSource;
      const src=(dataset.sources||[]).find(x=>x.id===id);
      if(!src) return;
      if(!confirm(`¿Quitar la fuente ${src.actionCode||''} de esta configuración local?`)) return;
      dataset.sources=dataset.sources.filter(x=>x.id!==id);
      await saveState(); renderSources(); toast('Fuente quitada de la prueba local');
    }));
  }

  async function saveSourceFromForm(e){
    e.preventDefault();
    const actionCode=$('#sourceAction').value;
    const url=$('#sourceUrl').value.trim();
    if(!actionCode){toast('Seleccioná una acción');return}
    if(!url){toast('Pegá el link de Google Sheets');return}
    const spreadsheetId=spreadsheetIdFromUrl(url);
    if(!spreadsheetId){toast('El link no parece ser una Google Sheet válida');return}

    const duplicate=(dataset.sources||[]).find(x=>x.actionCode===actionCode && x.spreadsheetId===spreadsheetId);
    if(duplicate){toast('Esa fuente ya está registrada para la acción');return}

    const source={
      id:(globalThis.crypto?.randomUUID?.() || 'src-'+Date.now()),
      actionCode,
      name:$('#sourceName').value.trim() || `${actionCode} · Google Sheets`,
      url,
      spreadsheetId,
      authMode:$('#sourceAuthMode').value,
      intervalMinutes:Number($('#sourceInterval').value)||5,
      active:true,
      status:'pending_backend',
      lastSyncAt:null,
      createdAt:new Date().toISOString()
    };
    dataset.sources=[...(dataset.sources||[]),source];
    await saveState();
    $('#sourceForm').reset();
    refreshSourceActionOptions();
    $('#sourceInterval').value='5';
    renderSources();
    toast('Fuente registrada. Queda lista para conectar al sincronizador.');
  }

  function renderAll(){
    refreshFilterOptions(); renderImportResults(); renderSources(); applyFilters();
  }

  function switchView(name){
    $$('.view').forEach(x=>x.classList.remove('active')); $$('.nav-item').forEach(x=>x.classList.remove('active'));
    $('#view-'+name)?.classList.add('active'); document.querySelector(`.nav-item[data-view="${name}"]`)?.classList.add('active');
  }

  function exportCsv(){
    const rows=filtered.registrations.map(r=>({...r,asistio:filtered.attendance.some(a=>idOf(a)===idOf(r))?'SI':'NO'}));
    if(!rows.length)return;
    const ws=XLSX.utils.json_to_sheet(rows); const csv=XLSX.utils.sheet_to_csv(ws);
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='analizador_copes_filtrado.csv';a.click();URL.revokeObjectURL(url);
  }

  function bind(){
    $$('.nav-item').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
    $('#pickFiles').addEventListener('click',()=>$('#fileInput').click());
    $('#fileInput').addEventListener('change',e=>handleFiles([...e.target.files]));
    const dz=$('#dropzone');
    ['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add('drag')}));
    ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove('drag')}));
    dz.addEventListener('drop',e=>handleFiles([...e.dataTransfer.files]));
    ['filterAction','filterSchool','filterTutor','filterArea','filterVenue','filterShift'].forEach(id=>$('#'+id).addEventListener('change',applyFilters));
    $('#globalSearch').addEventListener('input',applyFilters); $('#detailSearch').addEventListener('input',renderDetail);
    $('#clearFilters').addEventListener('click',()=>{['filterAction','filterSchool','filterTutor','filterArea','filterVenue','filterShift'].forEach(id=>$('#'+id).value='');$('#globalSearch').value='';applyFilters()});
    $('#exportBtn').addEventListener('click',exportCsv);
    $('#resetBtn').addEventListener('click',async()=>{if(confirm('¿Vaciar todos los datos de prueba guardados en este navegador?')){await clearState();toast('Datos de prueba eliminados')}});
    $('#sourceForm')?.addEventListener('submit',saveSourceFromForm);
  }

  async function init(){
    bind(); await loadState(); renderAll();
    if(!dataset.actions.length) switchView('imports');
  }
  init();
})();