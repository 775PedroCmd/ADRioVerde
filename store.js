// =====================================================
// Camada de dados — Supabase (nuvem) + cache em memória
// =====================================================
// Todos os dados das pessoas ficam no Supabase (banco na nuvem).
// Qualquer dispositivo que abrir o painel vê os mesmos dados.
// O cache em memória permite leitura instantânea (síncrona).
// Escritas disparam para o Supabase em segundo plano (async).

// --- Supabase ---
var SUPABASE_URL = 'https://kyxxlkqfzrrcikcajyjt.supabase.co/rest/v1/';
var SUPABASE_KEY = 'sb_publishable_t3pBGGgcuGtAaKkNinOESw_wzC6Ruuq';

// --- inChurch API via proxy (evita CORS no navegador) ---
// IMPORTANTE: o path completo precisa ir até /v1/people, pois o proxy
// (index.ts no Supabase) apenas repassa tudo que vem depois de
// "/inchurch-proxy" direto para a API do inChurch (inradar.com.br).
var INCHURCH_PROXY_URL = 'https://kyxxlkqfzrrcikcajyjt.supabase.co/functions/v1/inchurch-proxy/v1/people';
var INCHURCH_CHURCH_ID = 36014;

// --- Cache em memória ---
var _peopleCache = [];

// --- Constantes da jornada ---
const ENTRY_STAGES = ['visitante', 'convertido', 'reconciliado', 'novo_membro'];
const LINEAR_STAGES = ['gc', 'jornada_membro', 'membro'];
const STAGES = [
  { id:'visitante',      label:'Visitante',           desc:'Veio conhecer a igreja', icon:'ti-door-enter', accent:'blue' },
  { id:'convertido',     label:'Aceitou a Jesus',      desc:'Novo convertido, primeira vez', icon:'ti-sparkles', accent:'blue' },
  { id:'reconciliado',   label:'Reconciliado',         desc:'Voltou a andar com Jesus', icon:'ti-refresh', accent:'blue' },
  { id:'novo_membro',    label:'Novo membro',          desc:'Veio de outra igreja (transferência)', icon:'ti-suitcase', accent:'blue' },
  { id:'gc',             label:'Grupo de crescimento', desc:'Em célula, sendo integrado', icon:'ti-users', accent:'blue' },
  { id:'jornada_membro', label:'Jornada do membro',    desc:'Consolidação e/ou escola de batismo', icon:'ti-compass', accent:'ember' },
  { id:'membro',         label:'Membro',               desc:'Jornada concluída', icon:'ti-award', accent:'green' },
];
const SUB_STAGES = [
  { id:'consolidacao',    label:'Consolidação',      desc:'Acompanhamento e discipulado', icon:'ti-heart-handshake', accent:'ember' },
  { id:'escola_batismo',  label:'Escola de batismo', desc:'Preparação doutrinária', icon:'ti-book', accent:'ember' },
  { id:'capacitacao',     label:'Capacitação',       desc:'Treinamento para servir', icon:'ti-school', accent:'ember' },
  { id:'voluntariado',    label:'Voluntariado',      desc:'Primeiros passos servindo', icon:'ti-hand-stop', accent:'ember' },
];
const SUB_ORDER = ['consolidacao', 'escola_batismo', 'capacitacao', 'voluntariado'];

function nextStageId(stageId){
  if(ENTRY_STAGES.includes(stageId)) return 'gc';
  var i = LINEAR_STAGES.indexOf(stageId);
  if(i === -1 || i === LINEAR_STAGES.length-1) return null;
  return LINEAR_STAGES[i+1];
}
function prevStageId(stageId, person){
  if(stageId === 'gc'){
    var origem = person && person.origem;
    return ENTRY_STAGES.includes(origem) ? origem : null;
  }
  var i = LINEAR_STAGES.indexOf(stageId);
  if(i === 0 || i === -1) return null;
  return LINEAR_STAGES[i-1];
}
function nextSubStageId(subStageId){
  var i = SUB_ORDER.indexOf(subStageId);
  if(i === -1 || i === SUB_ORDER.length-1) return null;
  return SUB_ORDER[i+1];
}
function prevSubStageId(subStageId){
  var i = SUB_ORDER.indexOf(subStageId);
  if(i === 0 || i === -1) return null;
  return SUB_ORDER[i-1];
}

// --- Helper: chamada Supabase REST ---
async function supabaseRequest(method, table, body, query){
  var url = SUPABASE_URL + '/' + table;
  if(query) url += '?' + query;
  var headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json'
  };
  if(method !== 'GET') headers['Prefer'] = 'return=minimal';
  try{
    var opts = { method:method, headers:headers };
    if(body) opts.body = JSON.stringify(body);
    var res = await fetch(url, opts);
    if(!res.ok){
      var errText = await res.text();
      console.error('Supabase erro:', method, res.status, errText);
      return null;
    }
    if(method === 'GET') return await res.json();
    return true;
  }catch(err){
    console.error('Supabase falha:', method, err);
    return null;
  }
}

// --- Mapeamento JS (camelCase) ↔ DB (snake_case) ---
function toDb(p){
  return {
    id: p.id,
    nome: p.nome || '',
    telefone: p.telefone || '',
    email: p.email || '',
    bairro: p.bairro || '',
    idade: p.idade || '',
    estado_civil: p.estadoCivil || '',
    nome_conjuge: p.nomeConjuge || '',
    igreja_anterior: p.igrejaAnterior || '',
    tem_carta: p.temCarta || '',
    funcao_ministerial: p.funcaoMinisterial || '',
    quis_gc: p.quisGC || '',
    pedido_oracao: p.pedidoOracao || '',
    congregacao: p.congregacao || '',
    quem_coleta: p.quemColeta || '',
    departamento: p.departamento || '',
    agente_integrante: p.agenteIntegrante || '',
    sub_stage: p.subStage || '',
    notas: p.notas || '',
    foto: p.foto || null,
    stage: p.stage || 'visitante',
    origem: p.origem || '',
    inchurch_id: p.inchurchId || null,
    pending_sync: p.pendingSync || false,
    pending_sync_membro: p.pendingSyncMembro || false,
    sync_error: p.syncError || '',
    created_at: p.createdAt || new Date().toISOString(),
    history: JSON.stringify(p.history || []),
    sub_history: JSON.stringify(p.subHistory || [])
  };
}

function fromDb(row){
  return {
    id: row.id,
    nome: row.nome || '',
    telefone: row.telefone || '',
    email: row.email || '',
    bairro: row.bairro || '',
    idade: String(row.idade || ''),
    estadoCivil: row.estado_civil || '',
    nomeConjuge: row.nome_conjuge || '',
    igrejaAnterior: row.igreja_anterior || '',
    temCarta: row.tem_carta || '',
    funcaoMinisterial: row.funcao_ministerial || '',
    quisGC: row.quis_gc || '',
    pedidoOracao: row.pedido_oracao || '',
    congregacao: row.congregacao || '',
    quemColeta: row.quem_coleta || '',
    departamento: row.departamento || '',
    agenteIntegrante: row.agente_integrante || '',
    subStage: row.sub_stage || '',
    notas: row.notas || '',
    foto: row.foto || null,
    stage: row.stage || 'visitante',
    origem: row.origem || '',
    inchurchId: row.inchurch_id || null,
    pendingSync: row.pending_sync || false,
    pendingSyncMembro: row.pending_sync_membro || false,
    syncError: row.sync_error || '',
    createdAt: row.created_at || new Date().toISOString(),
    history: typeof row.history === 'string' ? JSON.parse(row.history || '[]') : (row.history || []),
    subHistory: typeof row.sub_history === 'string' ? JSON.parse(row.sub_history || '[]') : (row.sub_history || [])
  };
}

// --- Store ---
const Store = {
  _keyResp: 'jornada_responsaveis',
  _keyDeptos: 'jornada_departamentos',

  async load(){
    var rows = await supabaseRequest('GET', 'pessoas', null, 'select=*');
    if(rows && Array.isArray(rows)){
      _peopleCache = rows.map(fromDb);
    }
    return _peopleCache;
  },

  getPeople(){
    return _peopleCache;
  },

  addPerson(data){
    var stage = data.stage || 'visitante';
    var p = {
      id: 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
      nome: data.nome || '',
      telefone: data.telefone || '',
      email: data.email || '',
      bairro: data.bairro || '',
      idade: data.idade || '',
      estadoCivil: data.estadoCivil || '',
      nomeConjuge: data.nomeConjuge || '',
      igrejaAnterior: data.igrejaAnterior || '',
      temCarta: data.temCarta || '',
      funcaoMinisterial: data.funcaoMinisterial || '',
      quisGC: data.quisGC || '',
      pedidoOracao: data.pedidoOracao || '',
      congregacao: data.congregacao || '',
      quemColeta: data.quemColeta || '',
      departamento: data.departamento || '',
      agenteIntegrante: data.agenteIntegrante || '',
      subStage: data.subStage || '',
      notas: data.notas || '',
      foto: data.foto || null,
      stage: stage,
      origem: stage,
      inchurchId: null,
      pendingSync: false,
      pendingSyncMembro: false,
      syncError: '',
      createdAt: new Date().toISOString(),
      history: [{ stage: stage, date: new Date().toISOString() }],
      subHistory: [],
    };
    _peopleCache.push(p);
    supabaseRequest('POST', 'pessoas', toDb(p));
    if(stage !== 'visitante'){ this.syncPreCadastro(p); }
    return p;
  },

  updatePerson(id, data){
    var p = _peopleCache.find(function(x){ return x.id === id; });
    if(!p) return null;
    Object.assign(p, data);
    supabaseRequest('PATCH', 'pessoas', toDb(p), 'id=eq.' + id);
    return p;
  },

  movePerson(id, newStageId){
    var p = _peopleCache.find(function(x){ return x.id === id; });
    if(!p) return null;
    p.stage = newStageId;
    p.history = p.history || [];
    p.history.push({ stage: newStageId, date: new Date().toISOString() });
    supabaseRequest('PATCH', 'pessoas', toDb(p), 'id=eq.' + id);
    if(newStageId === 'membro'){ this.syncMembroFinal(p); }
    return p;
  },

  moveSubStage(id, newSubStageId){
    var p = _peopleCache.find(function(x){ return x.id === id; });
    if(!p) return null;
    p.subStage = newSubStageId;
    p.subHistory = p.subHistory || [];
    p.subHistory.push({ subStage: newSubStageId, date: new Date().toISOString() });
    supabaseRequest('PATCH', 'pessoas', toDb(p), 'id=eq.' + id);
    return p;
  },

  deletePerson(id){
    _peopleCache = _peopleCache.filter(function(p){ return p.id !== id; });
    supabaseRequest('DELETE', 'pessoas', null, 'id=eq.' + id);
  },

  peopleInStage(stageId, congregacao){
    return _peopleCache.filter(function(p){
      return p.stage === stageId && (!congregacao || congregacao === 'todas' || p.congregacao === congregacao);
    });
  },

  peopleInSubStage(subStageId){
    return _peopleCache.filter(function(p){
      return p.stage === 'jornada_membro' && p.subStage === subStageId;
    });
  },

  congregacoes(){
    return Array.from(new Set(_peopleCache.map(function(p){ return p.congregacao; }).filter(Boolean))).sort();
  },

  getResponsaveis(){
    return JSON.parse(localStorage.getItem(this._keyResp) || '{}');
  },
  setResponsavel(stageId, nome){
    var r = this.getResponsaveis();
    r[stageId] = nome;
    localStorage.setItem(this._keyResp, JSON.stringify(r));
  },
  getDepartamentos(){
    var saved = JSON.parse(localStorage.getItem(this._keyDeptos) || 'null');
    return saved || ['UCADERV', 'MAAD', 'UMADERV', 'USADERV', 'HCP'];
  },
  setDepartamentos(list){
    localStorage.setItem(this._keyDeptos, JSON.stringify(list));
  },

  async syncPreCadastro(person){
    console.log('[inChurch] Iniciando pré-cadastro para:', person.nome);
    try{
      // Mapeamentos conforme os enums oficiais da API (docs.inchurch.com.br/api/people):
      // status aceita apenas: pending | approved | refused
      // church_profile aceita apenas: visitor | frequent | member
      var churchProfileMap = {
        'visitante': 'visitor',
        'convertido': 'frequent',
        'reconciliado': 'frequent',
        'novo_membro': 'member'
      };
      var statusMap = {
        'visitante': 'pending',
        'convertido': 'pending',
        'reconciliado': 'approved',
        'novo_membro': 'approved'
      };

      var body = {
        full_name: person.nome,
        email: person.email,
        mobile_phone: person.telefone,
        church_id: INCHURCH_CHURCH_ID,
        status: statusMap[person.stage] || 'pending',
        church_profile: churchProfileMap[person.stage] || 'visitor',
        accepted_jesus: person.stage !== 'visitante',
        first_visit_date: new Date().toISOString().split('T')[0]
      };
      if(person.estadoCivil){ body.marital_status = person.estadoCivil; }

      console.log('[inChurch] URL:', INCHURCH_PROXY_URL);
      console.log('[inChurch] Body:', JSON.stringify(body));
      var res = await fetch(INCHURCH_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      console.log('[inChurch] Status:', res.status);
      if(!res.ok){
        var errText = await res.text();
        console.error('[inChurch] Erro:', res.status, errText);
        this.updatePerson(person.id, { pendingSync: true, syncError: errText });
        return;
      }
      var json = await res.json();
      console.log('[inChurch] Sucesso! ID:', json.id);
      this.updatePerson(person.id, { pendingSync: false, inchurchId: json.id || null, syncError: '' });
    }catch(err){
      console.error('[inChurch] Falha ao chamar proxy:', err);
      this.updatePerson(person.id, { pendingSync: true, syncError: String(err) });
    }
  },

  async syncMembroFinal(person){
    try{
      if(!person.inchurchId){
        this.updatePerson(person.id, { pendingSyncMembro: true, syncError: 'Sem inchurchId' });
        return;
      }
      console.log('[inChurch] Marcando como membro:', person.nome, '(ID:', person.inchurchId, ')');
      // status só aceita pending | approved | refused — "active" não existe no schema oficial.
      // O campo "is_member" também não existe na API; quem marca a pessoa como membro
      // de fato é a combinação church_profile: "member" + status: "approved".
      var res = await fetch(INCHURCH_PROXY_URL + '/' + person.inchurchId + '/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: person.nome,
          status: 'approved',
          church_profile: 'member',
          accepted_jesus: true,
          is_active: true,
          church_id: INCHURCH_CHURCH_ID
        })
      });
      console.log('[inChurch] Status (membro):', res.status);
      if(!res.ok){
        var errText = await res.text();
        console.error('inChurch API erro (membro):', res.status, errText);
        this.updatePerson(person.id, { pendingSyncMembro: true, syncError: errText });
        return;
      }
      this.updatePerson(person.id, { pendingSyncMembro: false, syncError: '' });
    }catch(err){
      console.error('inChurch API falha (membro):', err);
      this.updatePerson(person.id, { pendingSyncMembro: true, syncError: String(err) });
    }
  },
};

// --- Helpers de UI ---
function initials(name){
  return (name||'?').trim().split(/\s+/).slice(0,2).map(function(w){ return w[0]; }).join('').toUpperCase();
}
function avatarHtml(p, size){
  if(p.foto){ return '<img class="avatar" src="'+p.foto+'" style="width:'+size+'px;height:'+size+'px">'; }
  return '<div class="avatar" style="width:'+size+'px;height:'+size+'px;font-size:'+Math.round(size*0.36)+'px">'+initials(p.nome)+'</div>';
}
function daysSince(dateStr){
  var d = Math.floor((Date.now() - new Date(dateStr).getTime())/86400000);
  if(d === 0 || d === -1) return 'hoje';
  if(d === 1) return 'há 1 dia';
  return 'há '+d+' dias';
}
function lastHistoryDate(p){
  if(p.history && p.history.length) return p.history[p.history.length-1].date;
  return p.createdAt;
}