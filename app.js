"use strict";

/* ============================================================
   1. CONFIG — constantes globais da aplicação
   ============================================================ */
const CONFIG = {
  PREFIX: 'bank.',
  LOGO_LOGIN_SRC: 'https://i.postimg.cc/rwDmRB7M/logo-.png',
  LOGO_HOME_SRC: 'https://i.postimg.cc/rwDmRB7M/logo-.png',
  FOTO_USUARIO_PADRAO_SRC: 'static/user-photo.png',
  DEMO_CPF: '123.456.789-09',
  DEMO_SENHA: '1204',
  SESSAO_MS: 1000 * 60 * 60 * 8,           // 8 horas (sem "lembrar")
  SESSAO_LEMBRAR_MS: 1000 * 60 * 60 * 24 * 30, // 30 dias (com "lembrar")
  MAX_TENTATIVAS: 3,
  BLOQUEIO_MS: 30 * 1000,
  BIOMETRIA_MS: 800,
  SKELETON_MS: 260
};

const ICONES = {
  pix_in: 'arrow-down', pix_out: 'arrow-up', boleto: 'barcode', compra: 'bag-shopping',
  recarga: 'mobile-screen-button', investimento: 'chart-line', estorno: 'rotate-left', ajuste: 'gear'
};

const ROTULOS_TIPO = {
  pix_in: 'Pix recebido', pix_out: 'Pix enviado', boleto: 'Pagamento de boleto',
  compra: 'Compra no débito', recarga: 'Recarga', investimento: 'Investimento',
  estorno: 'Estorno', ajuste: 'Ajuste de saldo'
};

const TABS = [
  { rota: '#/home',    ico: 'house', nome: 'Início'  },
  { rota: '#/pix',     ico: 'bolt', nome: 'Pix'     },
  { rota: '#/extrato', ico: 'receipt', nome: 'Extrato' },
  { rota: '#/cartao',  ico: 'credit-card', nome: 'Cartão'  },
  { rota: '#/perfil',  ico: 'user', nome: 'Perfil'  }
];

/* ============================================================
   2. ESTADO
   ============================================================ */
const STATE = {
  user: null,
  accounts: null,
  transactions: [],
  contacts: [],
  cards: [],
  bills: [],
  investments: [],
  settings: { tema: 'claro', ocultarSaldo: false, notificacoes: true, moeda: 'BRL' },
  session: { logado: false, expiraEm: 0 },

  loginCpf: '',
  loginSenha: '',
  saldoOculto: false,
  filtro: { periodo: '30', tipo: 'todos', busca: '' },
  timerBloqueio: null,
  timerSkeleton: null,
  ultimaRota: null,
  lembrar: true
};

const app    = () => document.getElementById('app');
const tabbar = () => document.getElementById('tabbar');

/* ============================================================
   3. PERSISTÊNCIA
   ============================================================ */
function salvar(chave, valor) {
  try {
    localStorage.setItem(CONFIG.PREFIX + chave, JSON.stringify(valor));
    return true;
  } catch (e) {
    console.warn('[salvar] falha em', chave, e);
    return false;
  }
}

function carregar(chave, padrao = null) {
  try {
    const raw = localStorage.getItem(CONFIG.PREFIX + chave);
    if (raw === null || raw === undefined) return padrao;
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[carregar] falha em', chave, e);
    return padrao;
  }
}

/* ============================================================
   4. MÁSCARAS E FORMATADORES
   ============================================================ */
const _brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtBRL = v => _brl.format(Number(v) || 0);

const fmtData = iso => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtDataHora = iso => new Date(iso).toLocaleString('pt-BR', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
});

function soDigitos(v) { return String(v ?? '').replace(/\D+/g, ''); }

function maskCPF(v) {
  const d = soDigitos(v).slice(0, 11);
  if (d.length > 9) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
  if (d.length > 6) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`;
  if (d.length > 3) return `${d.slice(0,3)}.${d.slice(3)}`;
  return d;
}

function maskTelefone(v) {
  const d = soDigitos(v).slice(0, 11);
  if (!d) return '';
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0,2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
}

function maskBoleto(v) {
  const d = soDigitos(v).slice(0, 48);
  return d.replace(/(\d{5})(?=\d)/g, '$1 ').trim();
}

function maskMoeda(v) {
  const d = soDigitos(v).slice(0, 12);
  if (!d) return '';
  const n = Number(d) / 100;
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseMoeda(v) {
  const d = soDigitos(v);
  return d ? Number(d) / 100 : 0;
}

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function uid() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch (e) { /* fallback */ }
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function delta(t) {
  if (!t) return 0;
  if (t.tipo === 'ajuste') return Number(t.valor);
  return (t.tipo === 'pix_in' || t.tipo === 'estorno') ? Number(t.valor) : -Number(t.valor);
}

/* ============================================================
   5. SEED
   ============================================================ */
function seed() {
  if (carregar('seed', null)) return;

  const agora = Date.now();
  const DIA = 86400000;

  const user = {
    nome: 'Estevao Alves Cristina',
    cpf: '123.456.789-09',
    agencia: '0001',
    conta: '145739-8',
    chavePix: '423.724.290-00',
    email: 'estevao.alves@exemplo.com',
    telefone: '(35) 98888-7766',
    avatarIniciais: 'EC'
  };

  const modelo = [
    [59, 'pix_in',       3200.00, 'Pix recebido',        'ACME Tecnologia Ltda',  'Salário'],
    [58, 'compra',         89.90, 'Compra no débito',    'Padaria Pão Quente',    'Alimentação'],
    [56, 'boleto',        312.45, 'Conta de luz',        'Enel Distribuição',     'Contas'],
    [55, 'pix_out',       150.00, 'Pix enviado',         'Carlos Eduardo',        'Transferência'],
    [52, 'compra',        249.90, 'Compra no débito',    'Farmácia Saúde',        'Saúde'],
    [50, 'recarga',        30.00, 'Recarga de celular',  'Vivo',                  'Recarga'],
    [48, 'pix_in',        480.00, 'Pix recebido',        'Mariana Souza',         'Transferência'],
    [45, 'compra',        129.99, 'Compra no débito',    'Streaming Play',        'Assinaturas'],
    [43, 'investimento',  500.00, 'Aplicação em CDB',    'CDB Liquidez Diária',   'Investimento'],
    [40, 'boleto',       1890.00, 'Aluguel',             'Imobiliária Central',   'Moradia'],
    [38, 'compra',         76.50, 'Compra no débito',    'Uber',                  'Transporte'],
    [35, 'pix_out',       220.00, 'Pix enviado',         'Rafael Nunes',          'Transferência'],
    [33, 'compra',         45.80, 'Compra no débito',    'Café do Centro',        'Alimentação'],
    [30, 'estorno',       129.99, 'Estorno de compra',   'Streaming Play',        'Estorno'],
    [28, 'pix_in',        950.00, 'Pix recebido',        'Freela Design',         'Renda extra'],
    [26, 'compra',        340.00, 'Compra no débito',    'Posto Ipiranga',        'Transporte'],
    [24, 'boleto',        145.90, 'Internet fibra',      'Vivo Fibra',            'Contas'],
    [22, 'recarga',        50.00, 'Recarga de celular',  'Claro',                 'Recarga'],
    [20, 'compra',         89.90, 'Compra no débito',    'Streaming Play',        'Assinaturas'],
    [17, 'pix_out',       400.00, 'Pix enviado',         'Juliana Prado',         'Transferência'],
    [15, 'investimento', 1000.00, 'Aplicação em Tesouro','Tesouro Selic 2029',    'Investimento'],
    [12, 'compra',        215.30, 'Compra no débito',    'Supermercado Bom Preço','Alimentação'],
    [10, 'pix_in',        300.00, 'Pix recebido',        'Pedro Henrique',        'Transferência'],
    [ 8, 'compra',         59.90, 'Compra no débito',    'Loja Online ABC',       'Compras'],
    [ 5, 'boleto',        312.45, 'Conta de luz',        'Enel Distribuição',     'Contas'],
    [ 3, 'compra',         27.90, 'Compra no débito',    'iFood',                 'Alimentação'],
    [ 1, 'pix_out',       120.00, 'Pix enviado',         'Bruno Martins',         'Transferência'],
    [ 0, 'compra',         64.70, 'Compra no débito',    'Padaria Pão Quente',    'Alimentação']
  ];

  const txs = modelo.map(([dias, tipo, valor, descricao, contraparte, categoria]) => {
    const quando = new Date(agora - dias * DIA - Math.floor(Math.random() * 8) * 3600000);
    return {
      id: uid(), tipo, valor,
      dataISO: quando.toISOString(),
      descricao, contraparte, categoria,
      saldoApos: 0, status: 'concluido'
    };
  }).sort((a, b) => new Date(a.dataISO) - new Date(b.dataISO));

  const SALDO_FINAL = 3482.17;
  for (let i = txs.length - 1; i >= 0; i--) {
    if (i === txs.length - 1) {
      txs[i].saldoApos = SALDO_FINAL;
    } else {
      txs[i].saldoApos = +(txs[i + 1].saldoApos - delta(txs[i + 1])).toFixed(2);
    }
  }

  const accounts = {
    saldo: SALDO_FINAL,
    limiteCartao: 5000,
    limiteDisponivel: 3210.55,
    faturaAtual: 1789.45,
    chequeEspecial: 500,
    limitePixDiario: 2000,
    pixUsadoHoje: 0,
    pixData: new Date().toISOString().slice(0, 10)
  };

  const contacts = [
    { id: uid(), nome: 'Ana Beatriz Lima', chave: 'ana.lima@exemplo.com',   tipoChave: 'E-mail',   banco: 'Banco Aurora' },
    { id: uid(), nome: 'Carlos Eduardo',   chave: '(11) 97777-1234',        tipoChave: 'Telefone', banco: 'Neo Pagamentos' },
    { id: uid(), nome: 'Juliana Prado',    chave: '987.654.321-00',         tipoChave: 'CPF',      banco: 'Banco Litoral' },
    { id: uid(), nome: 'Rafael Nunes',     chave: 'rafa.nunes@exemplo.com', tipoChave: 'E-mail',   banco: 'Banco Vertex' }
  ];

  const cards = [
    { id: uid(), final: '4821', bandeira: 'Visa',       tipo: 'fisico',  bloqueado: false, limite: 5000 },
    { id: uid(), final: '9012', bandeira: 'Mastercard', tipo: 'virtual', bloqueado: false, limite: 1500 }
  ];

  const bills = [
    { id: uid(), codigo: '34191 79001 01043 51004 79102 01500 089 84410 0000031245',
      valor: 312.45, vencimento: new Date(agora + 10 * DIA).toISOString().slice(0, 10),
      pago: false, beneficiario: 'EDP Energia' },
    { id: uid(), codigo: '00190 54321 09876 54321 09876 54321 098 76540 0000018900',
      valor: 1890.00, vencimento: new Date(agora - 15 * DIA).toISOString().slice(0, 10),
      pago: true, beneficiario: 'Imobiliária Central' }
  ];

  const investments = [
    { id: uid(), nome: 'CDB Liquidez Diária', tipo: 'Renda Fixa',     valorAplicado: 5000, rendimento:  312.48, rentabilidade:  6.25 },
    { id: uid(), nome: 'Tesouro Selic 2029',  tipo: 'Tesouro Direto', valorAplicado: 2000, rendimento:   98.12, rentabilidade:  4.91 },
    { id: uid(), nome: 'Fundo Multimercado',  tipo: 'Fundo',          valorAplicado: 1500, rendimento:  -42.30, rentabilidade: -2.82 }
  ];

  salvar('user', user);
  salvar('accounts', accounts);
  salvar('transactions', txs);
  salvar('contacts', contacts);
  salvar('cards', cards);
  salvar('bills', bills);
  salvar('investments', investments);
  salvar('settings', { tema: 'claro', ocultarSaldo: false, notificacoes: true, moeda: 'BRL' });
  salvar('seed', { versao: 1, criadoEm: new Date().toISOString() });
}

/* ============================================================
   6. INICIALIZAÇÃO
   ============================================================ */
function inicializar() {
  seed();

  STATE.user         = carregar('user', null);
  STATE.accounts     = carregar('accounts', {});
  STATE.transactions = carregar('transactions', []);
  STATE.contacts     = carregar('contacts', []);
  STATE.cards        = carregar('cards', []);
  STATE.bills        = carregar('bills', []);
  STATE.investments  = carregar('investments', []);
  STATE.settings     = carregar('settings', { tema: 'claro', ocultarSaldo: false, notificacoes: true, moeda: 'BRL' });
  STATE.session      = carregar('session', { logado: false, expiraEm: 0 });
  STATE.lembrar      = carregar('remember', true);

  if (STATE.session?.logado && STATE.session.expiraEm < Date.now()) {
    STATE.session = { logado: false, expiraEm: 0 };
    salvar('session', STATE.session);
  }

  const hoje = new Date().toISOString().slice(0, 10);
  if (STATE.accounts.pixData !== hoje) {
    STATE.accounts.pixData = hoje;
    STATE.accounts.pixUsadoHoje = 0;
    salvar('accounts', STATE.accounts);
  }

  STATE.saldoOculto = !!STATE.settings.ocultarSaldo;
  aplicarTema();
}

function aplicarTema() {
  document.documentElement.setAttribute('data-tema', STATE.settings?.tema === 'escuro' ? 'escuro' : 'claro');
}

/* ============================================================
   7. ROTEADOR
   ============================================================ */
function parseRota() {
  const bruto = (location.hash || '').replace(/^#\/?/, '');
  const [nome, param] = bruto.split('/');
  return { nome: nome || 'login', param: param || null };
}

function navegar(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

const TELAS = {
  login: telaLogin,
  home: telaHome,
  pix: telaPix,
  extrato: telaExtrato,
  transacao: telaTransacao,
  cartao: telaCartao,
  boletos: telaBoletos,
  investimentos: telaInvestimentos,
  perfil: telaPerfil
};

const TELAS_COM_SKELETON = new Set(['home', 'extrato', 'cartao', 'boletos', 'investimentos', 'pix']);

function render() {
  const rota = parseRota();
  const logado = !!STATE.session?.logado;

  if (!logado && rota.nome !== 'login') { navegar('#/login'); return; }
  if (logado && rota.nome === 'login')  { navegar('#/home');  return; }

  const chaveRota = rota.nome + '|' + (rota.param || '');
  const mudouDeTela = STATE.ultimaRota !== chaveRota;
  STATE.ultimaRota = chaveRota;

  const fn = TELAS[rota.nome] || telaHome;

  const pintar = () => {
    app().innerHTML = `<div class="tela">${fn(rota.param)}</div>`;
    atualizarTabbar(rota.nome, logado);
    aposRender(rota.nome, rota.param);
  };

  if (mudouDeTela && TELAS_COM_SKELETON.has(rota.nome)) {
    app().innerHTML = esqueleto();
    atualizarTabbar(rota.nome, logado);
    clearTimeout(STATE.timerSkeleton);
    STATE.timerSkeleton = setTimeout(pintar, CONFIG.SKELETON_MS);
  } else {
    clearTimeout(STATE.timerSkeleton);
    pintar();
  }
}

function esqueleto() {
  return `<div class="tela" style="padding-top:16px">
    <div class="skel" style="width:45%;height:22px"></div>
    <div class="skel" style="height:120px;border-radius:24px"></div>
    <div class="skel" style="height:16px;width:60%"></div>
    <div class="skel"></div>
    <div class="skel" style="width:80%"></div>
    <div class="skel"></div>
  </div>`;
}

function aposRender(nome) {
  if (nome === 'home') animarSaldo();
  if (nome === 'login') iniciarTimerBloqueio();
}

function atualizarTabbar(nomeRota, logado) {
  const nav = tabbar();
  if (!logado) { nav.hidden = true; nav.innerHTML = ''; return; }
  nav.hidden = false;
  const ativos = { home: 'home', pix: 'pix', extrato: 'extrato', transacao: 'extrato', cartao: 'cartao', perfil: 'perfil' };
  const ativo = ativos[nomeRota] || '';
  nav.innerHTML = TABS.map(t => {
    const rotaLimpa = t.rota.replace('#/', '');
    const isAtivo = ativo === rotaLimpa;
    return `<button data-action="ir" data-rota="${t.rota}"
            class="${isAtivo ? 'ativo' : ''}"
            aria-label="${t.nome}" ${isAtivo ? 'aria-current="page"' : ''}>
      <span class="ico" aria-hidden="true">${icone(t.ico)}</span>
      <span>${t.nome}</span>
    </button>`;
  }).join('');
}

/* ============================================================
   8. COMPONENTES REUTILIZÁVEIS
   ============================================================ */
function topbar(titulo, opts = {}) {
  return `<header class="topbar">
    ${opts.voltar
      ? `<button class="icone-btn" data-action="voltar" data-voltar="${opts.voltar}" aria-label="Voltar">${icone('arrow-left')}</button>`
      : `<span class="lado"></span>`}
    <h2>${esc(titulo)}</h2>
    <span class="lado">${opts.dir || ''}</span>
  </header>`;
}

function icone(nome, classes = '') {
  return `<i class="fa-solid fa-${nome}${classes ? ` ${classes}` : ''}" aria-hidden="true"></i>`;
}

function vazio(titulo, texto, iconeNome = 'folder-open') {
  return `<div class="vazio">
    <span class="vazio-icone" aria-hidden="true">${icone(iconeNome)}</span>
    <strong>${esc(titulo)}</strong>
    <p>${esc(texto)}</p>
  </div>`;
}

function linhaTransacao(t) {
  const d = delta(t);
  const sinal = d >= 0 ? '+' : '−';
  return `<button class="tx" data-action="abrirTransacao" data-id="${t.id}"
            aria-label="${esc(t.descricao)} — ${fmtBRL(Math.abs(d))}">
    <span class="tx-icone" aria-hidden="true">${icone(ICONES[t.tipo] || 'circle-question')}</span>
    <span class="tx-info">
      <strong>${esc(t.descricao)}</strong>
      <small>${esc(t.contraparte)}</small>
    </span>
    <span class="tx-valor ${d >= 0 ? 'pos' : 'neg'}">${sinal} ${fmtBRL(Math.abs(d))}</span>
  </button>`;
}

function rotuloData(chaveISO) {
  const d = new Date(chaveISO + 'T12:00:00');
  const hoje = new Date(); hoje.setHours(12, 0, 0, 0);
  const ontem = new Date(hoje); ontem.setDate(ontem.getDate() - 1);
  if (d.toDateString() === hoje.toDateString()) return 'Hoje';
  if (d.toDateString() === ontem.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function abrirModal(html) {
  document.getElementById('modal-root').innerHTML =
    `<div class="modal-back" data-action="fecharModalFundo">
       <div class="modal" role="dialog" aria-modal="true">${html}</div>
     </div>`;
  const foco = document.querySelector('.modal input, .modal button, .modal select');
  if (foco) setTimeout(() => foco.focus(), 60);
}

function fecharModal() {
  document.getElementById('modal-root').innerHTML = '';
}

function marcaLogo(classe, src) {
  return `<span class="${classe} brand-logo">
    <span class="brand-logo-fallback" aria-hidden="true"></span>
    <img class="brand-logo-image" src="${esc(src)}" alt="AtrivoBank">
  </span>`;
}

function avatarUsuario(iniciais, estilo = '') {
  return `<span class="avatar user-avatar" style="${estilo}" aria-hidden="true">
    <span class="user-avatar-fallback">${esc(iniciais || 'NB')}</span>
    <img class="user-photo-image" src="${esc(CONFIG.FOTO_USUARIO_PADRAO_SRC)}" alt="">
  </span>`;
}

function toast(msg, tipo = 'info') {
  const root = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + tipo;
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s ease, transform .3s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateY(-12px)';
    setTimeout(() => el.remove(), 320);
  }, 3000);
}

function setErro(form, msg) {
  const el = form?.querySelector('.erro-inline');
  if (!el) return;
  el.textContent = msg || '';
  el.style.display = msg ? 'block' : 'none';
}

async function copiar(texto, msgSucesso = 'Copiado para a área de transferência') {
  try {
    await navigator.clipboard.writeText(texto);
    toast(msgSucesso, 'ok');
  } catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = texto;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      let copiado;
      try {
        ta.select();
        copiado = document.execCommand('copy');
      } finally {
        ta.remove();
      }
      if (!copiado) throw new Error('O navegador recusou a cópia.');
      toast(msgSucesso, 'ok');
    } catch (err) {
      toast('Não foi possível copiar neste navegador', 'erro');
    }
  }
}

async function compartilhar(texto) {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: 'Comprovante Pix', text: texto });
      toast('Comprovante compartilhado!', 'ok');
    } catch (err) {
      if (err.name !== 'AbortError') toast('Não foi possível compartilhar o comprovante.', 'erro');
    }
    return;
  }

  await copiar(texto, 'Comprovante copiado! Você pode compartilhá-lo pelo app desejado.');
}

function textoComprovante(t) {
  return [
    '─────────────────────────',
    '  ATRIVO BANK — COMPROVANTE',
    '─────────────────────────',
    `Tipo: ${ROTULOS_TIPO[t.tipo] || t.tipo}`,
    `Valor: ${fmtBRL(t.valor)}`,
    `Descrição: ${t.descricao}`,
    `Destinatário: ${t.contraparte}`,
    ...(t.chavePix ? [`Chave Pix: ${t.chavePix}`] : []),
    `Data: ${fmtDataHora(t.dataISO)}`,
    `Saldo após: ${fmtBRL(t.saldoApos)}`,
    `ID: ${t.id}`,
    'Status: Concluído',
    '─────────────────────────',
    'Documento sem valor fiscal'
  ].join('\n');
}

/* ============================================================
   9. TELAS
   ============================================================ */

/* ---------- 9.1 LOGIN ---------- */
function telaLogin() {
  const guard = carregar('loginGuard', { tentativas: 0, bloqueadoAte: 0 });
  const bloqueado = guard.bloqueadoAte > Date.now();

  return `
  <div class="login">
    <div class="login-hero">
      ${marcaLogo('logo-mark', CONFIG.LOGO_LOGIN_SRC)}
      <h1>Bem-vindo de volta</h1>
      <p>Acesse sua conta para continuar</p>
    </div>

    <div class="login-body">
      <form data-form="login" novalidate>
        <label class="campo">
          <span>CPF</span>
          <input id="in-cpf" type="text" inputmode="numeric" data-mask="cpf"
                 placeholder="000.000.000-00" aria-label="CPF"
                 value="${esc(STATE.loginCpf)}" autocomplete="off">
        </label>

        <div class="campo">
          <span>Senha de 4 dígitos</span>
          <div class="senha-dots" id="senha-dots" aria-label="Senha: ${STATE.loginSenha.length} de 4 dígitos">
            ${dotsSenha(STATE.loginSenha.length)}
          </div>
        </div>

        <div class="erro-inline" id="login-erro" role="alert" style="${bloqueado ? 'display:block' : ''}">
          ${bloqueado ? 'Acesso bloqueado temporariamente.' : ''}
        </div>

        <div class="teclado" role="group" aria-label="Teclado numérico">
          ${[1,2,3,4,5,6,7,8,9].map(n =>
            `<button type="button" data-action="digito" data-n="${n}" aria-label="${n}" ${bloqueado ? 'disabled' : ''}>${n}</button>`).join('')}
          <button type="button" data-action="limparSenha" aria-label="Limpar senha" ${bloqueado ? 'disabled' : ''}>✕</button>
          <button type="button" data-action="digito" data-n="0" aria-label="0" ${bloqueado ? 'disabled' : ''}>0</button>
          <button type="button" data-action="apagarDigito" aria-label="Apagar último dígito" ${bloqueado ? 'disabled' : ''}>${icone('delete-left')}</button>
        </div>

        <div class="login-links">
          <label class="check">
            <input type="checkbox" id="lembrar" ${STATE.lembrar ? 'checked' : ''}>
            Lembrar de mim
          </label>
          <button type="button" class="link" data-action="esqueciSenha">Esqueci a senha</button>
        </div>

        <button type="submit" class="btn primario" ${bloqueado ? 'disabled' : ''}>Entrar</button>
        <div style="height:10px"></div>
        <button type="button" class="btn secundario" data-action="biometria" ${bloqueado ? 'disabled' : ''}>
          ${icone('fingerprint')} Entrar com biometria
        </button>
      </form>

      <!-- <div class="demo-box">
        <strong>Conta de demonstração</strong><br>
        CPF: <b>123.456.789-09</b> &nbsp;·&nbsp; Senha: <b>1234</b><br>
        Qualquer CPF válido com a senha <b>1234</b> entra em modo demonstração.
      </div>
    </div>
  </div>`;
}

function dotsSenha(n) {
  return [0,1,2,3].map(i => `<span class="dot ${i < n ? 'on' : ''}"></span>`).join('');
}

function atualizarDotsSenha() {
  const el = document.getElementById('senha-dots');
  if (el) {
    el.innerHTML = dotsSenha(STATE.loginSenha.length);
    el.setAttribute('aria-label', `Senha: ${STATE.loginSenha.length} de 4 dígitos`);
  }
}

function iniciarTimerBloqueio() {
  clearInterval(STATE.timerBloqueio);
  const guard = carregar('loginGuard', { tentativas: 0, bloqueadoAte: 0 });
  if (guard.bloqueadoAte <= Date.now()) return;

  STATE.timerBloqueio = setInterval(() => {
    const restante = Math.ceil((guard.bloqueadoAte - Date.now()) / 1000);
    const erro = document.getElementById('login-erro');
    if (restante <= 0) {
      clearInterval(STATE.timerBloqueio);
      const g = carregar('loginGuard', { tentativas: 0, bloqueadoAte: 0 });
      g.tentativas = 0; g.bloqueadoAte = 0;
      salvar('loginGuard', g);
      render();
      toast('Você já pode tentar novamente', 'info');
    } else if (erro) {
      erro.style.display = 'block';
      erro.textContent = `Muitas tentativas. Tente novamente em ${restante}s.`;
    }
  }, 1000);
}

function tentarLogin() {
  const guard = carregar('loginGuard', { tentativas: 0, bloqueadoAte: 0 });
  const erroEl = document.getElementById('login-erro');
  const mostrarErro = m => {
    if (erroEl) { erroEl.style.display = 'block'; erroEl.textContent = m; }
  };

  if (guard.bloqueadoAte > Date.now()) {
    mostrarErro('Acesso bloqueado temporariamente. Aguarde.');
    return;
  }
  if (soDigitos(STATE.loginCpf).length !== 11) {
    mostrarErro('Informe um CPF válido com 11 dígitos.');
    return;
  }
  if (STATE.loginSenha.length !== 4) {
    mostrarErro('Digite os 4 dígitos da senha.');
    return;
  }

  if (STATE.loginSenha !== CONFIG.DEMO_SENHA) {
    guard.tentativas = (guard.tentativas || 0) + 1;
    if (guard.tentativas >= CONFIG.MAX_TENTATIVAS) {
      guard.bloqueadoAte = Date.now() + CONFIG.BLOQUEIO_MS;
      guard.tentativas = 0;
      salvar('loginGuard', guard);
      STATE.loginSenha = '';
      render();
      toast('Acesso bloqueado por 30 segundos', 'erro');
      return;
    }
    salvar('loginGuard', guard);
    STATE.loginSenha = '';
    atualizarDotsSenha();
    mostrarErro(`Senha incorreta. Tentativa ${guard.tentativas} de ${CONFIG.MAX_TENTATIVAS}.`);
    return;
  }

  guard.tentativas = 0;
  guard.bloqueadoAte = 0;
  salvar('loginGuard', guard);
  efetuarLogin();
}

function efetuarLogin() {
  const dur = STATE.lembrar ? CONFIG.SESSAO_LEMBRAR_MS : CONFIG.SESSAO_MS;
  STATE.session = {
    logado: true,
    expiraEm: Date.now() + dur,
    cpf: STATE.loginCpf
  };
  salvar('session', STATE.session);
  STATE.loginSenha = '';
  STATE.saldoOculto = !!STATE.settings.ocultarSaldo;
  navegar('#/home');
  setTimeout(() => toast(`Bem-vinda de volta, ${STATE.user.nome.split(' ')[0]}!`, 'ok'), 300);
}

/* ---------- 9.2 HOME ---------- */
function telaHome() {
  const u = STATE.user;
  const oculto = STATE.saldoOculto;

  const ultimas = [...STATE.transactions]
    .sort((x, y) => new Date(y.dataISO) - new Date(x.dataISO))
    .slice(0, 5);

  const primeiroNome = (u?.nome || 'Cliente').split(' ')[0];

  const atalhos = [
    { ico: 'bolt', nome: 'Pix',       rota: '#/pix' },
    { ico: 'file-invoice-dollar', nome: 'Pagar',     rota: '#/boletos' },
    { ico: 'arrow-right-arrow-left', nome: 'Transferir',rota: '#/pix', acao: 'abrirPixEnviar' },
    { ico: 'mobile-screen-button', nome: 'Recarga',   rota: '#/pix', acao: 'recargaRapida' },
    { ico: 'chart-line', nome: 'Investir',  rota: '#/investimentos' },
    { ico: 'receipt', nome: 'Extrato',   rota: '#/extrato' }
  ];

  return `
  <div class="home-head">
    ${avatarUsuario(u?.avatarIniciais)}
    <div class="quem">
      <small>Olá,</small>
      <strong>${esc(primeiroNome)}</strong>
    </div>
    <button class="icone-btn" data-action="toggleSaldo" aria-label="${oculto ? 'Mostrar' : 'Ocultar'} saldo">
      ${icone(oculto ? 'eye' : 'eye-slash')}
    </button>
    <button class="icone-btn" data-action="ir" data-rota="#/perfil" aria-label="Abrir perfil">${icone('gear')}</button>
  </div>

  <div class="saldo-card">
    <div class="saldo-card-layout">
      <div class="saldo-card-conteudo">
        <div class="saldo-top">
          <span>Saldo disponível</span>
        </div>
        <div class="saldo-valor" id="saldo-valor">${oculto ? 'R$ ••••••' : 'R$ 0,00'}</div>
        <div class="saldo-sub">Ag ${esc(u?.agencia || '0001')} · Conta ${esc(u?.conta || '00000-0')}</div>
      </div>
      <!-- ${marcaLogo('saldo-logo', CONFIG.LOGO_HOME_SRC)} -->
    </div>
  </div>

  <div class="atalhos">
    ${atalhos.map(x => `
      <button class="atalho" data-action="atalho" data-rota="${x.rota}" ${x.acao ? `data-extra="${x.acao}"` : ''}>
        <span class="ico" aria-hidden="true">${icone(x.ico)}</span>
        <span>${x.nome}</span>
      </button>`).join('')}
  </div>

  <div class="sec-head">
    <h3>Últimos lançamentos</h3>
    <button data-action="ir" data-rota="#/extrato">Ver todos</button>
  </div>
  <div class="lista">
    ${ultimas.length
      ? ultimas.map(linhaTransacao).join('')
      : vazio('Nada por aqui ainda', 'Seus lançamentos aparecerão nesta lista.', 'credit-card')}
  </div>
  `;
}

function animarSaldo() {
  const el = document.getElementById('saldo-valor');
  if (!el) return;
  const alvo = STATE.accounts.saldo;

  if (STATE.saldoOculto) { el.textContent = 'R$ ••••••'; return; }

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = fmtBRL(alvo);
    return;
  }

  const inicio = performance.now();
  const dur = 800;
  const passo = t => {
    const p = Math.min(1, (t - inicio) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = fmtBRL(alvo * eased);
    if (p < 1) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}

/* ---------- 9.3 ÁREA PIX ---------- */
function telaPix() {
  const a = STATE.accounts;
  const restante = Math.max(0, a.limitePixDiario - a.pixUsadoHoje);
  const pct = Math.min(100, (a.pixUsadoHoje / Math.max(1, a.limitePixDiario)) * 100);

  return `
  ${topbar('Área Pix', { voltar: '#/home' })}
  <div class="pad">
    <div class="pix-grid">
      <button class="pix-acao" data-action="abrirPixEnviar">
        <span class="ico" aria-hidden="true">${icone('arrow-up')}</span>
        <strong>Enviar Pix</strong>
        <small>Para uma chave ou contato</small>
      </button>
      <button class="pix-acao" data-action="abrirPixReceber">
        <span class="ico" aria-hidden="true">${icone('arrow-down')}</span>
        <strong>Receber Pix</strong>
        <small>QR Code e Copia e Cola</small>
      </button>
      <button class="pix-acao" data-action="abrirMinhasChaves">
        <span class="ico" aria-hidden="true">${icone('key')}</span>
        <strong>Minhas chaves</strong>
        <small>Gerencie suas chaves</small>
      </button>
      <button class="pix-acao" data-action="abrirLimitesPix">
        <span class="ico" aria-hidden="true">${icone('chart-column')}</span>
        <strong>Limites</strong>
        <small>Diário e usado hoje</small>
      </button>
    </div>

    <div class="sec-head" style="padding:0;margin-bottom:8px">
      <h3>Contatos favoritos</h3>
    </div>
  </div>

  <div class="contatos-scroll">
    ${STATE.contacts.map(c => `
      <button class="contato" data-action="pixParaContato" data-id="${c.id}"
              aria-label="Enviar Pix para ${esc(c.nome)}">
        <span class="bolinha" aria-hidden="true">${esc(iniciais(c.nome))}</span>
        <span>${esc(c.nome.split(' ')[0])}</span>
      </button>`).join('')}
  </div>

  <div class="pad">
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <strong style="font-size:14px">Limite Pix diário</strong>
        <span class="suave" style="font-size:12px">${fmtBRL(restante)} restantes</span>
      </div>
      <div class="progresso"><i style="width:${pct}%"></i></div>
      <div style="display:flex;justify-content:space-between;font-size:12px" class="suave">
        <span>Usado hoje: ${fmtBRL(a.pixUsadoHoje)}</span>
        <span>Total: ${fmtBRL(a.limitePixDiario)}</span>
      </div>
    </div>
  </div>
  `;
}

function iniciais(nome) {
  const p = String(nome || '').trim().split(/\s+/);
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?';
}

function qrFake() {
  const size = 21;
  const finder = [[0,0],[0,size-7],[size-7,0]];

  const isFinder = (r, c) => {
    for (const [fr, fc] of finder) {
      if (r >= fr && r < fr + 7 && c >= fc && c < fc + 7) {
        const lr = r - fr, lc = c - fc;
        if (lr === 0 || lr === 6 || lc === 0 || lc === 6) return 'on';
        if (lr >= 2 && lr <= 4 && lc >= 2 && lc <= 4) return 'on';
        return 'off';
      }
    }
    return null;
  };

  let cells = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const f = isFinder(r, c);
      let on;
      if (f === 'on') on = true;
      else if (f === 'off') on = false;
      else on = Math.random() > 0.5;
      cells += `<i class="${on ? 'on' : ''}"></i>`;
    }
  }
  return `<div class="qr" role="img" aria-label="QR Code Pix simulado">${cells}</div>`;
}

function pixCopiaECola() {
  const rand = uid().replace(/-/g, '').toUpperCase().slice(0, 32);
  return `00020126580014BR.GOV.BCB.PIX0136${rand}5204000053039865802BR5913ATRIVO BANK6009SAO PAULO62070503***6304${rand.slice(0, 4)}`;
}

/* ---------- 9.4 EXTRATO ---------- */
function telaExtrato() {
  const f = STATE.filtro;
  return `
  ${topbar('Extrato', { voltar: '#/home' })}
  <div class="pad">
    <div class="filtros">
      <select data-filtro="periodo" aria-label="Período">
        ${[['7','Últimos 7 dias'],['30','Últimos 30 dias'],['60','Últimos 60 dias'],['90','Últimos 90 dias'],['todos','Todo o período']]
          .map(([v, t]) => `<option value="${v}" ${f.periodo === v ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <select data-filtro="tipo" aria-label="Tipo de lançamento">
        ${[['todos','Todos os tipos'],['entradas','Somente entradas'],['saidas','Somente saídas'],
           ['pix_in','Pix recebido'],['pix_out','Pix enviado'],['compra','Compras'],
           ['boleto','Boletos'],['recarga','Recargas'],['investimento','Investimentos'],['estorno','Estornos']]
          .map(([v, t]) => `<option value="${v}" ${f.tipo === v ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
    </div>
    <input type="search" data-filtro="busca" placeholder="Buscar por descrição ou contraparte"
           aria-label="Buscar lançamentos" value="${esc(f.busca)}" style="margin-bottom:8px">
    <div id="lista-extrato">${listaExtrato()}</div>
  </div>`;
}

function listaExtrato() {
  const { periodo, tipo, busca } = STATE.filtro;
  const agora = Date.now();
  let txs = [...STATE.transactions];

  if (periodo !== 'todos') {
    const dias = Number(periodo);
    txs = txs.filter(t => (agora - new Date(t.dataISO).getTime()) <= dias * 86400000);
  }
  if (tipo === 'entradas') txs = txs.filter(t => delta(t) > 0);
  else if (tipo === 'saidas') txs = txs.filter(t => delta(t) < 0);
  else if (tipo !== 'todos') txs = txs.filter(t => t.tipo === tipo);

  if (busca.trim()) {
    const q = busca.toLowerCase();
    txs = txs.filter(t =>
      `${t.descricao} ${t.contraparte} ${t.categoria}`.toLowerCase().includes(q));
  }

  txs.sort((a, b) => new Date(b.dataISO) - new Date(a.dataISO));

  if (!txs.length) {
    return vazio('Nenhum lançamento encontrado', 'Ajuste os filtros ou faça uma nova transação.', 'magnifying-glass');
  }

  const grupos = {};
  txs.forEach(t => {
    const k = t.dataISO.slice(0, 10);
    (grupos[k] = grupos[k] || []).push(t);
  });

  return Object.entries(grupos).map(([k, lista]) => `
    <div class="grupo">
      <div class="grupo-data">${rotuloData(k)}</div>
      ${lista.map(linhaTransacao).join('')}
    </div>`).join('');
}

/* ---------- 9.5 DETALHE DA TRANSAÇÃO ---------- */
function telaTransacao(id) {
  const t = STATE.transactions.find(x => x.id === id);
  if (!t) {
    return `${topbar('Comprovante', { voltar: '#/extrato' })}
      <div class="pad">${vazio('Lançamento não encontrado', 'Volte ao extrato e tente novamente.', 'circle-question')}</div>`;
  }

  const d = delta(t);

  return `
  ${topbar('Comprovante', { voltar: '#/extrato' })}
  <div class="pad">
    <div class="comprovante">
      <div class="topo">
        <div style="font-size:13px;opacity:.85">${esc(ROTULOS_TIPO[t.tipo] || t.descricao)}</div>
        <div class="valor">${d >= 0 ? '+' : '−'} ${fmtBRL(Math.abs(d))}</div>
        <div style="margin-top:8px"><span class="badge" style="background:rgba(197,160,90,.25);color:#F5E6C8">${icone('circle-check')} Concluído</span></div>
      </div>
      <div class="corpo">
        <div class="linha-dado"><span>Descrição</span><strong>${esc(t.descricao)}</strong></div>
        <div class="linha-dado"><span>Contraparte</span><strong>${esc(t.contraparte)}</strong></div>
        <div class="linha-dado"><span>Categoria</span><strong>${esc(t.categoria || '—')}</strong></div>
        <div class="linha-dado"><span>Data</span><strong>${fmtDataHora(t.dataISO)}</strong></div>
        <div class="linha-dado"><span>Saldo após</span><strong>${fmtBRL(t.saldoApos)}</strong></div>
        <div class="linha-dado"><span>ID da transação</span><strong style="font-size:11px">${esc(t.id)}</strong></div>
        <div class="linha-dado"><span>Status</span><strong>${esc(t.status || 'concluido')}</strong></div>
      </div>
    </div>

    <div style="height:16px"></div>
    <button class="btn primario" data-action="compartilharComprovante" data-id="${t.id}">
      ${icone('share-nodes')} Compartilhar comprovante
    </button>
    <div style="height:10px"></div>
    <button class="btn secundario" data-action="voltar" data-voltar="#/extrato">Voltar ao extrato</button>
  </div>`;
}

function mostrarPixEnviado(t) {
  if (!t) {
    toast('O Pix foi enviado, mas não foi possível abrir o comprovante.', 'erro');
    return;
  }

  abrirModal(`
    <div class="pix-sucesso">
      <span class="pix-sucesso-icone" aria-hidden="true">${icone('check')}</span>
      <h3>Pix enviado com sucesso!</h3>
      <p class="sub">Confira os dados da transferência abaixo.</p>
    </div>
    <div class="comprovante">
      <div class="topo">
        <div style="font-size:13px;opacity:.85">Pix enviado</div>
        <div class="valor">${fmtBRL(t.valor)}</div>
        <div style="margin-top:8px"><span class="badge">${icone('circle-check')} Concluído</span></div>
      </div>
      <div class="corpo">
        <div class="linha-dado"><span>Destinatário</span><strong>${esc(t.contraparte)}</strong></div>
        <div class="linha-dado"><span>Chave Pix</span><strong>${esc(t.chavePix || '—')}</strong></div>
        <div class="linha-dado"><span>Descrição</span><strong>${esc(t.descricao || '—')}</strong></div>
        <div class="linha-dado"><span>Data</span><strong>${fmtDataHora(t.dataISO)}</strong></div>
        <div class="linha-dado"><span>Saldo após</span><strong>${fmtBRL(t.saldoApos)}</strong></div>
        <div class="linha-dado"><span>ID da transação</span><strong style="font-size:11px">${esc(t.id)}</strong></div>
      </div>
    </div>
    <div style="height:16px"></div>
    <button class="btn primario" data-action="compartilharComprovante" data-id="${esc(t.id)}">
      ${icone('share-nodes')} Compartilhar comprovante
    </button>
    <div style="height:10px"></div>
    <button class="btn secundario" data-action="fecharModal">Concluir</button>
  `);
}

/* ---------- 9.6 CARTÃO DE CRÉDITO ---------- */
function telaCartao() {
  const a = STATE.accounts;
  const usadoPct = Math.min(100, (a.faturaAtual / Math.max(1, a.limiteCartao)) * 100);
  const compras = comprasFatura();

  return `
  ${topbar('Cartão de crédito', { voltar: '#/home' })}
  <div class="pad">

    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
        <span class="suave" style="font-size:13px">Fatura atual</span>
        <span class="badge aberto">Aberta</span>
      </div>
      <div style="font-size:28px;font-weight:800;letter-spacing:-.5px">${fmtBRL(a.faturaAtual)}</div>
      <div class="progresso"><i style="width:${usadoPct}%"></i></div>
      <div style="display:flex;justify-content:space-between;font-size:12px" class="suave">
        <span>Limite disponível: <strong style="color:var(--entrada)">${fmtBRL(a.limiteDisponivel)}</strong></span>
        <span>Total: ${fmtBRL(a.limiteCartao)}</span>
      </div>
    </div>

    ${STATE.cards.map(c => `
      <div class="cartao-visual ${c.bloqueado ? 'bloq' : ''}" style="margin-bottom:14px">
        <div class="topo">
          <span>${c.tipo === 'virtual' ? 'Cartão virtual' : 'Cartão físico'}</span>
          <span>${esc(c.bandeira)}</span>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div class="cartao-chip" aria-hidden="true"></div>
          <span style="font-size:11px;opacity:.75">ATRIVO</span>
        </div>
        <div class="numero">•••• •••• •••• ${esc(c.final)}</div>
        <div class="base">
          <span>${c.bloqueado ? `${icone('lock')} Bloqueado` : `${icone('circle-check')} Ativo`}</span>
          <button class="btn mini secundario" data-action="toggleCartao" data-id="${c.id}"
                  style="background:rgba(255,255,255,.18);color:#fff;border:0">
            ${c.bloqueado ? 'Desbloquear' : 'Bloquear'}
          </button>
        </div>
      </div>`).join('')}

    <button class="btn secundario" data-action="abrirNovoCartao">${icone('plus')} Criar cartão virtual</button>

    <div class="sec-head" style="padding:0;margin:22px 0 6px">
      <h3>Compras da fatura</h3>
    </div>
    <div class="lista" style="padding:0">
      ${compras.length
        ? compras.map(linhaTransacao).join('')
        : vazio('Nenhuma compra na fatura', 'Suas compras no cartão aparecerão aqui.', 'bag-shopping')}
    </div>
  </div>`;
}

function comprasFatura() {
  const limite = Date.now() - 30 * 86400000;
  return STATE.transactions
    .filter(t => t.tipo === 'compra' && new Date(t.dataISO).getTime() >= limite)
    .sort((a, b) => new Date(b.dataISO) - new Date(a.dataISO));
}

/* ---------- 9.7 BOLETOS ---------- */
function telaBoletos() {
  const abertos = STATE.bills.filter(b => !b.pago);
  const pagos = STATE.bills.filter(b => b.pago);

  return `
  ${topbar('Boletos', { voltar: '#/home' })}
  <div class="pad">
    <div class="pix-grid">
      <button class="pix-acao" data-action="abrirPagarBoleto">
        <span class="ico" aria-hidden="true">${icone('camera')}</span>
        <strong>Pagar boleto</strong>
        <small>Digite a linha digitável</small>
      </button>
      <button class="pix-acao" data-action="abrirGerarBoleto">
        <span class="ico" aria-hidden="true">${icone('plus')}</span>
        <strong>Gerar boleto</strong>
        <small>Criar cobrança</small>
      </button>
    </div>

    <div class="sec-head" style="padding:0;margin-bottom:6px">
      <h3>Em aberto</h3>
    </div>
    ${abertos.length ? abertos.map(b => `
      <div class="card" style="margin-bottom:10px;padding:14px">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <strong style="font-size:14px">${esc(b.beneficiario)}</strong>
          <strong style="font-size:15px">${fmtBRL(b.valor)}</strong>
        </div>
        <div class="suave" style="font-size:12px;margin-top:4px">
          Vence em ${fmtData(b.vencimento + 'T12:00:00')}
        </div>
        <div class="copia-cola" style="margin-top:10px">${esc(b.codigo)}</div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="btn mini secundario" data-action="copiarCodigo" data-id="${b.id}">Copiar código</button>
          <button class="btn mini primario" data-action="pagarBoletoItem" data-id="${b.id}">Pagar</button>
        </div>
      </div>`).join('') : vazio('Nenhum boleto em aberto', 'Você está em dia!', 'circle-check')}

    <div class="sec-head" style="padding:0;margin:20px 0 6px">
      <h3>Pagos</h3>
    </div>
    ${pagos.length ? pagos.map(b => `
      <div class="card" style="margin-bottom:10px;padding:14px;opacity:.85">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <strong style="font-size:14px">${esc(b.beneficiario)}</strong>
          <strong style="font-size:15px">${fmtBRL(b.valor)}</strong>
        </div>
        <div class="suave" style="font-size:12px;margin-top:4px">
          Venceu em ${fmtData(b.vencimento + 'T12:00:00')} · <span class="badge">Pago</span>
        </div>
      </div>`).join('') : vazio('Nenhum boleto pago', 'Seus pagamentos aparecerão aqui.', 'receipt')}
  </div>`;
}

/* ---------- 9.8 INVESTIMENTOS ---------- */
function telaInvestimentos() {
  const totalAplicado = STATE.investments.reduce((s, i) => s + Number(i.valorAplicado), 0);
  const totalRendimento = STATE.investments.reduce((s, i) => s + Number(i.rendimento), 0);
  const total = totalAplicado + totalRendimento;
  const rentMedia = totalAplicado > 0 ? (totalRendimento / totalAplicado) * 100 : 0;

  return `
  ${topbar('Investimentos', { voltar: '#/home' })}
  <div class="pad">
    <div class="saldo-card" style="margin:0 0 18px">
      <div class="saldo-top"><span>Patrimônio investido</span></div>
      <div class="saldo-valor">${fmtBRL(total)}</div>
      <div class="saldo-sub">
        Aplicado ${fmtBRL(totalAplicado)} · Rendimento
        <strong style="color:${totalRendimento >= 0 ? '#B6FFCB' : '#FFC7CC'}">
          ${totalRendimento >= 0 ? '+' : '−'} ${fmtBRL(Math.abs(totalRendimento))}
        </strong>
      </div>
    </div>

    <div class="card" style="margin-bottom:18px">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <strong style="font-size:14px">Rentabilidade média</strong>
        <strong class="${rentMedia >= 0 ? 'pos' : 'neg'}" style="font-size:16px">
          ${rentMedia >= 0 ? '+' : ''}${rentMedia.toFixed(2)}%
        </strong>
      </div>
    </div>

    <button class="btn primario" data-action="abrirInvestir">${icone('circle-plus')} Aplicar novo valor</button>

    <div class="sec-head" style="padding:0;margin:22px 0 6px">
      <h3>Minha carteira</h3>
    </div>
    <div class="card">
      ${STATE.investments.map(i => `
        <div class="inv-item">
          <div class="inv-icone" aria-hidden="true">${icone(i.rendimento >= 0 ? 'arrow-trend-up' : 'arrow-trend-down')}</div>
          <div class="inv-info">
            <strong>${esc(i.nome)}</strong>
            <small>${esc(i.tipo)} · aplicado ${fmtBRL(i.valorAplicado)}</small>
          </div>
          <div class="inv-num">
            <strong>${fmtBRL(i.valorAplicado + i.rendimento)}</strong>
            <small class="${i.rendimento >= 0 ? 'pos' : 'neg'}">
              ${i.rendimento >= 0 ? '+' : '−'}${fmtBRL(Math.abs(i.rendimento))}
              (${i.rentabilidade >= 0 ? '+' : ''}${Number(i.rentabilidade).toFixed(2)}%)
            </small>
          </div>
        </div>`).join('')}
    </div>
  </div>`;
}

/* ---------- 9.9 PERFIL / CONFIGURAÇÕES ---------- */
function telaPerfil() {
  const u = STATE.user;
  const a = STATE.accounts;
  const s = STATE.settings;

  return `
  ${topbar('Perfil e ajustes', { voltar: '#/home' })}
  <div class="pad">

    <div class="card" style="display:flex;align-items:center;gap:14px;margin-bottom:6px">
      ${avatarUsuario(u.avatarIniciais, 'width:56px;height:56px;border-radius:20px;font-size:18px')}
      <div style="min-width:0">
        <strong style="display:block;font-size:16px">${esc(u.nome)}</strong>
        <small class="suave">CPF ${esc(u.cpf)}</small><br>
        <small class="suave">Ag ${esc(u.agencia)} · Conta ${esc(u.conta)}</small>
      </div>
    </div>

    <div class="secao-titulo">Dados pessoais</div>
    <div class="card">
      <form data-form="perfil" novalidate>
        <div class="erro-inline"></div>
        <label class="campo">
          <span>Nome completo</span>
          <input type="text" name="nome" value="${esc(u.nome)}" aria-label="Nome completo" required>
        </label>
        <label class="campo">
          <span>E-mail</span>
          <input type="email" name="email" value="${esc(u.email)}" aria-label="E-mail" required>
        </label>
        <label class="campo">
          <span>Telefone</span>
          <input type="text" name="telefone" data-mask="telefone" inputmode="numeric"
                 value="${esc(u.telefone)}" aria-label="Telefone">
        </label>
        <label class="campo">
          <span>Chave Pix principal</span>
          <input type="text" name="chavePix" value="${esc(u.chavePix)}" aria-label="Chave Pix principal">
        </label>
        <button type="submit" class="btn primario">Salvar dados</button>
      </form>
    </div>

    <div class="secao-titulo">Saldo da conta</div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px">
        <span class="suave" style="font-size:13px">Saldo atual</span>
        <strong style="font-size:16px">${fmtBRL(a.saldo)}</strong>
      </div>
      <form data-form="saldo" novalidate>
        <div class="erro-inline"></div>
        <label class="campo">
          <span>Definir novo saldo (R$)</span>
          <input type="text" name="saldo" inputmode="numeric" data-mask="moeda"
                 placeholder="0,00" aria-label="Novo saldo" required>
        </label>
        <button type="submit" class="btn primario">Salvar saldo</button>
        <p class="suave" style="font-size:11.5px;margin-top:8px;line-height:1.5">
          Digite os centavos. Ex.: <strong>500000</strong> = R$ 5.000,00. O ajuste gera um lançamento “ajuste” no extrato.
        </p>
      </form>
    </div>

    <div class="secao-titulo">Limite Pix</div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px">
        <span class="suave" style="font-size:13px">Limite diário atual</span>
        <strong style="font-size:16px">${fmtBRL(a.limitePixDiario)}</strong>
      </div>
      <form data-form="limitePix" novalidate>
        <div class="erro-inline"></div>
        <label class="campo">
          <span>Novo limite diário (R$)</span>
          <input type="text" name="limite" inputmode="numeric" data-mask="moeda"
                 placeholder="0,00" aria-label="Novo limite diário de Pix" required>
        </label>
        <button type="submit" class="btn secundario">Atualizar limite</button>
      </form>
    </div>

    <div class="secao-titulo">Preferências</div>
    <div class="card">
      <div class="linha-config">
        <div class="txt"><strong>Tema escuro</strong><small>Aparência escura no app</small></div>
        <label class="switch">
          <input type="checkbox" data-pref="tema" ${s.tema === 'escuro' ? 'checked' : ''} aria-label="Tema escuro">
          <span></span>
        </label>
      </div>
      <div class="linha-config">
        <div class="txt"><strong>Ocultar saldo por padrão</strong><small>Esconde o saldo ao abrir o app</small></div>
        <label class="switch">
          <input type="checkbox" data-pref="ocultarSaldo" ${s.ocultarSaldo ? 'checked' : ''} aria-label="Ocultar saldo">
          <span></span>
        </label>
      </div>
      <div class="linha-config">
        <div class="txt"><strong>Notificações</strong><small>Avisos simulados de movimentações</small></div>
        <label class="switch">
          <input type="checkbox" data-pref="notificacoes" ${s.notificacoes ? 'checked' : ''} aria-label="Notificações">
          <span></span>
        </label>
      </div>
    </div>

    <div class="secao-titulo">Backup</div>
    <div class="card">
      <div class="linha-config">
        <div class="txt"><strong>Exportar dados</strong><small>Baixar um JSON com tudo</small></div>
        <button class="btn mini secundario" data-action="exportarBackup">Exportar</button>
      </div>
      <div class="linha-config">
        <div class="txt"><strong>Importar dados</strong><small>Restaurar a partir de um JSON</small></div>
        <button class="btn mini secundario" data-action="importarBackup">Importar</button>
      </div>
      <input type="file" id="arquivo-backup" accept="application/json,.json" hidden aria-label="Arquivo de backup">
    </div>

    <div class="secao-titulo">Conta</div>
    <div class="card">
      <div style="display:flex;flex-direction:column;gap:10px">
        <button class="btn perigo" data-action="resetar">${icone('trash')} Resetar todos os dados</button>
        <button class="btn secundario" data-action="sair">Sair da conta</button>
      </div>
    </div>

    <p class="suave" style="text-align:center;font-size:11.5px;margin:24px 0 0;line-height:1.6">
      AtrivoBank · Aplicativo bancário<br>
      Nenhum dado real é utilizado. Versão 1.0.0
    </p>
  </div>`;
}

/* ============================================================
   10. AÇÕES
   ============================================================ */
const ACOES = {

  ir(el) { if (el.dataset.rota) navegar(el.dataset.rota); },

  atalho(el) {
    const extra = el.dataset.extra;
    if (extra && ACOES[extra]) {
      navegar(el.dataset.rota);
      setTimeout(() => ACOES[extra](el), 320);
      return;
    }
    navegar(el.dataset.rota);
  },

  voltar(el) { navegar(el.dataset.voltar || '#/home'); },

  /* --- Login --- */
  digito(el) {
    const guard = carregar('loginGuard', { tentativas: 0, bloqueadoAte: 0 });
    if (guard.bloqueadoAte > Date.now()) return;
    if (STATE.loginSenha.length >= 4) return;
    STATE.loginSenha += el.dataset.n;
    atualizarDotsSenha();
    if (STATE.loginSenha.length === 4) setTimeout(tentarLogin, 140);
  },

  apagarDigito() {
    STATE.loginSenha = STATE.loginSenha.slice(0, -1);
    atualizarDotsSenha();
  },

  limparSenha() {
    STATE.loginSenha = '';
    atualizarDotsSenha();
  },

  biometria(el) {
    const guard = carregar('loginGuard', { tentativas: 0, bloqueadoAte: 0 });
    if (guard.bloqueadoAte > Date.now()) { toast('Acesso bloqueado temporariamente', 'erro'); return; }
    if (!STATE.loginCpf) STATE.loginCpf = CONFIG.DEMO_CPF;

    el.disabled = true;
    const original = el.innerHTML;
    el.innerHTML = `${icone('fingerprint')} Verificando biometria...`;

    setTimeout(() => {
      el.disabled = false;
      el.innerHTML = original;
      efetuarLogin();
    }, CONFIG.BIOMETRIA_MS);
  },

  esqueciSenha() {
    abrirModal(`
      <h3>Recuperar senha</h3>
      <p class="sub">Enviaremos um código de verificação para o e-mail cadastrado.</p>
      <form data-form="esqueci" novalidate>
        <div class="erro-inline"></div>
        <label class="campo">
          <span>E-mail cadastrado</span>
          <input type="email" name="email" placeholder="seu@email.com" aria-label="E-mail cadastrado" required>
        </label>
        <div class="acoes">
          <button type="button" class="btn secundario" data-action="fecharModal">Cancelar</button>
          <button type="submit" class="btn primario">Enviar código</button>
        </div>
      </form>
    `);
  },

  /* --- Modais --- */
  fecharModal() { fecharModal(); },
  fecharModalFundo(el, ev) { if (ev.target === el) fecharModal(); },

  /* --- Home --- */
  toggleSaldo() {
    STATE.saldoOculto = !STATE.saldoOculto;
    const el = document.getElementById('saldo-valor');
    if (el) el.textContent = STATE.saldoOculto ? 'R$ ••••••' : fmtBRL(STATE.accounts.saldo);
    const btn = document.querySelector('[data-action="toggleSaldo"]');
    if (btn) {
      btn.innerHTML = icone(STATE.saldoOculto ? 'eye' : 'eye-slash');
      btn.setAttribute('aria-label', (STATE.saldoOculto ? 'Mostrar' : 'Ocultar') + ' saldo');
    }
  },

  abrirTransacao(el) { navegar('#/transacao/' + el.dataset.id); },

  /* --- Pix --- */
  abrirPixEnviar() {
    abrirModal(`
      <h3>Enviar Pix</h3>
      <p class="sub">Escolha um contato ou informe uma chave Pix.</p>
      <div class="contatos-scroll" style="padding:0 0 12px">
        ${STATE.contacts.map(c => `
          <button type="button" class="contato" data-action="selecionarContato" data-id="${c.id}" data-modal="1">
            <span class="bolinha" aria-hidden="true">${esc(iniciais(c.nome))}</span>
            <span>${esc(c.nome.split(' ')[0])}</span>
          </button>`).join('')}
      </div>
      <form data-form="pix" novalidate>
        <div class="erro-inline"></div>
        <label class="campo">
          <span>Chave Pix</span>
          <input type="text" name="chave" id="pix-chave" placeholder="CPF, e-mail, telefone ou chave aleatória"
                 aria-label="Chave Pix" required>
        </label>
        <label class="campo">
          <span>Valor (R$)</span>
          <input type="text" name="valor" inputmode="numeric" data-mask="moeda" placeholder="0,00"
                 aria-label="Valor do Pix" required>
        </label>
        <label class="campo">
          <span>Descrição (opcional)</span>
          <input type="text" name="descricao" placeholder="Ex.: Almoço de sábado" aria-label="Descrição">
        </label>
        <div class="acoes">
          <button type="button" class="btn secundario" data-action="fecharModal">Cancelar</button>
          <button type="submit" class="btn primario">Confirmar Pix</button>
        </div>
      </form>
    `);
  },

  selecionarContato(el) {
    const c = STATE.contacts.find(x => x.id === el.dataset.id);
    if (!c) return;
    const campo = document.getElementById('pix-chave');
    if (campo) {
      campo.value = c.chave;
      campo.dataset.nome = c.nome;
      campo.focus();
    }
  },

  pixParaContato(el) {
    ACOES.abrirPixEnviar();
    setTimeout(() => {
      const c = STATE.contacts.find(x => x.id === el.dataset.id);
      const campo = document.getElementById('pix-chave');
      if (c && campo) { campo.value = c.chave; campo.dataset.nome = c.nome; }
    }, 80);
  },

  recargaRapida() {
    abrirModal(`
      <h3>Recarga de celular</h3>
      <p class="sub">Escolha um valor e recarregue na hora.</p>
      <form data-form="recarga" novalidate>
        <div class="erro-inline"></div>
        <label class="campo">
          <span>Operadora</span>
          <select name="operadora" aria-label="Operadora">
            <option>Vivo</option><option>Claro</option><option>Tim</option><option>Oi</option>
          </select>
        </label>
        <label class="campo">
          <span>Valor (R$)</span>
          <input type="text" name="valor" inputmode="numeric" data-mask="moeda" placeholder="0,00"
                 aria-label="Valor da recarga" required>
        </label>
        <div class="acoes">
          <button type="button" class="btn secundario" data-action="fecharModal">Cancelar</button>
          <button type="submit" class="btn primario">Recarregar</button>
        </div>
      </form>
    `);
  },

  abrirPixReceber() {
    const copiaCola = pixCopiaECola();
    abrirModal(`
      <h3>Receber Pix</h3>
      <p class="sub">Mostre o QR Code ou envie o código Copia e Cola.</p>
      ${qrFake()}
      <div style="height:16px"></div>
      <div class="copia-cola">${esc(copiaCola)}</div>
      <div style="height:14px"></div>
      <button class="btn primario" data-action="copiarPix" data-texto="${esc(copiaCola)}">
        ${icone('copy')} Copiar código Pix
      </button>
      <div style="height:10px"></div>
      <button class="btn secundario" data-action="fecharModal">Fechar</button>
    `);
  },

  copiarPix(el) { copiar(el.dataset.texto || '', 'Código Pix copiado!'); },

  abrirMinhasChaves() {
    const u = STATE.user;
    abrirModal(`
      <h3>Minhas chaves</h3>
      <p class="sub">Chaves vinculadas à sua conta.</p>
      <div class="card" style="margin-bottom:10px">
        <small class="suave">CPF</small>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:4px">
          <strong style="font-size:14px">${esc(u.cpf)}</strong>
          <button class="btn mini secundario" data-action="copiarPix" data-texto="${esc(soDigitos(u.cpf))}">Copiar</button>
        </div>
      </div>
      <div class="card" style="margin-bottom:10px">
        <small class="suave">E-mail</small>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:4px">
          <strong style="font-size:14px;word-break:break-all">${esc(u.email)}</strong>
          <button class="btn mini secundario" data-action="copiarPix" data-texto="${esc(u.email)}">Copiar</button>
        </div>
      </div>
      <div class="card" style="margin-bottom:16px">
        <small class="suave">Telefone</small>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:4px">
          <strong style="font-size:14px">${esc(u.telefone)}</strong>
          <button class="btn mini secundario" data-action="copiarPix" data-texto="${esc(soDigitos(u.telefone))}">Copiar</button>
        </div>
      </div>
      <button class="btn secundario" data-action="fecharModal">Fechar</button>
    `);
  },

  abrirLimitesPix() {
    const a = STATE.accounts;
    const restante = Math.max(0, a.limitePixDiario - a.pixUsadoHoje);
    const pct = Math.min(100, (a.pixUsadoHoje / Math.max(1, a.limitePixDiario)) * 100);
    abrirModal(`
      <h3>Limites Pix</h3>
      <p class="sub">Controle do seu limite de transferências.</p>
      <div class="card" style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px">
          <span class="suave">Usado hoje</span>
          <strong>${fmtBRL(a.pixUsadoHoje)}</strong>
        </div>
        <div class="progresso"><i style="width:${pct}%"></i></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:8px">
          <span class="suave">Limite diário</span>
          <strong>${fmtBRL(a.limitePixDiario)}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:4px">
          <span class="suave">Disponível hoje</span>
          <strong style="color:var(--entrada)">${fmtBRL(restante)}</strong>
        </div>
      </div>
      <p class="suave" style="font-size:12px;line-height:1.6;margin-bottom:16px">
        O limite é redefinido automaticamente todos os dias à meia-noite.
      </p>
      <button class="btn secundario" data-action="fecharModal">Fechar</button>
    `);
  },

  compartilharComprovante(el) {
    const t = STATE.transactions.find(x => x.id === el.dataset.id);
    if (!t) return;
    compartilhar(textoComprovante(t));
  },

  /* --- Cartão --- */
  toggleCartao(el) {
    const c = STATE.cards.find(x => x.id === el.dataset.id);
    if (!c) return;
    c.bloqueado = !c.bloqueado;
    salvar('cards', STATE.cards);
    toast(c.bloqueado ? 'Cartão bloqueado' : 'Cartão desbloqueado', c.bloqueado ? 'info' : 'ok');
    render();
  },

  abrirNovoCartao() {
    abrirModal(`
      <h3>Criar cartão virtual</h3>
      <p class="sub">Ideal para compras online com mais segurança.</p>
      <form data-form="cartao" novalidate>
        <div class="erro-inline"></div>
        <label class="campo">
          <span>Apelido do cartão</span>
          <input type="text" name="apelido" placeholder="Ex.: Assinaturas" aria-label="Apelido do cartão" required>
        </label>
        <label class="campo">
          <span>Limite (R$)</span>
          <input type="text" name="limite" inputmode="numeric" data-mask="moeda" placeholder="0,00"
                 aria-label="Limite do cartão virtual" required>
        </label>
        <div class="acoes">
          <button type="button" class="btn secundario" data-action="fecharModal">Cancelar</button>
          <button type="submit" class="btn primario">Criar cartão</button>
        </div>
      </form>
    `);
  },

  /* --- Boletos --- */
  abrirGerarBoleto() {
    abrirModal(`
      <h3>Gerar boleto</h3>
      <p class="sub">Crie uma cobrança com vencimento definido.</p>
      <form data-form="gerarBoleto" novalidate>
        <div class="erro-inline"></div>
        <label class="campo">
          <span>Beneficiário</span>
          <input type="text" name="beneficiario" placeholder="Nome de quem recebe" aria-label="Beneficiário" required>
        </label>
        <label class="campo">
          <span>Valor (R$)</span>
          <input type="text" name="valor" inputmode="numeric" data-mask="moeda" placeholder="0,00"
                 aria-label="Valor do boleto" required>
        </label>
        <label class="campo">
          <span>Vencimento</span>
          <input type="date" name="vencimento" aria-label="Data de vencimento" required>
        </label>
        <div class="acoes">
          <button type="button" class="btn secundario" data-action="fecharModal">Cancelar</button>
          <button type="submit" class="btn primario">Gerar boleto</button>
        </div>
      </form>
    `);
  },

  abrirPagarBoleto() {
    abrirModal(`
      <h3>Pagar boleto</h3>
      <p class="sub">Digite ou cole a linha digitável.</p>
      <form data-form="pagarBoleto" novalidate>
        <div class="erro-inline"></div>
        <label class="campo">
          <span>Código de barras</span>
          <input type="text" name="codigo" inputmode="numeric" data-mask="boleto"
                 placeholder="00000 00000 00000 00000 00000 00000 0 00000000000000"
                 aria-label="Código de barras" required>
        </label>
        <label class="campo">
          <span>Valor (R$)</span>
          <input type="text" name="valor" inputmode="numeric" data-mask="moeda" placeholder="0,00"
                 aria-label="Valor do boleto" required>
        </label>
        <div class="acoes">
          <button type="button" class="btn secundario" data-action="fecharModal">Cancelar</button>
          <button type="submit" class="btn primario">Pagar boleto</button>
        </div>
      </form>
    `);
  },

  pagarBoletoItem(el) {
    const b = STATE.bills.find(x => x.id === el.dataset.id);
    if (!b) return;
    abrirModal(`
      <h3>Pagar boleto</h3>
      <p class="sub">${esc(b.beneficiario)} — vencimento ${fmtData(b.vencimento + 'T12:00:00')}</p>
      <div class="card" style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <span class="suave">Valor</span>
          <strong style="font-size:20px">${fmtBRL(b.valor)}</strong>
        </div>
      </div>
      <div class="acoes">
        <button type="button" class="btn secundario" data-action="fecharModal">Cancelar</button>
        <button type="button" class="btn primario" data-action="confirmarPagarItem" data-id="${b.id}">Confirmar pagamento</button>
      </div>
    `);
  },

  confirmarPagarItem(el) {
    const b = STATE.bills.find(x => x.id === el.dataset.id);
    if (!b) return;
    const r = pagarBoleto(b.codigo, b.valor, b.beneficiario);
    if (!r.ok) { toast(r.msg, 'erro'); return; }
    fecharModal();
    toast('Boleto pago com sucesso!', 'ok');
    render();
  },

  copiarCodigo(el) {
    const b = STATE.bills.find(x => x.id === el.dataset.id);
    if (!b) return;
    copiar(soDigitos(b.codigo), 'Código copiado!');
  },

  /* --- Investimentos --- */
  abrirInvestir() {
    abrirModal(`
      <h3>Aplicar em investimento</h3>
      <p class="sub">O valor será debitado do seu saldo disponível.</p>
      <form data-form="investir" novalidate>
        <div class="erro-inline"></div>
        <label class="campo">
          <span>Produto</span>
          <input type="text" name="nome" placeholder="Ex.: CDB Liquidez Diária" aria-label="Produto" required>
        </label>
        <label class="campo">
          <span>Tipo</span>
          <select name="tipo" aria-label="Tipo do investimento">
            <option>Renda Fixa</option>
            <option>Tesouro Direto</option>
            <option>Fundo</option>
            <option>Ações</option>
          </select>
        </label>
        <label class="campo">
          <span>Valor (R$)</span>
          <input type="text" name="valor" inputmode="numeric" data-mask="moeda" placeholder="0,00"
                 aria-label="Valor a aplicar" required>
        </label>
        <div class="acoes">
          <button type="button" class="btn secundario" data-action="fecharModal">Cancelar</button>
          <button type="submit" class="btn primario">Aplicar</button>
        </div>
      </form>
    `);
  },

  /* --- Backup / Conta --- */
  exportarBackup() {
    try {
      const dados = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(CONFIG.PREFIX)) dados[k] = JSON.parse(localStorage.getItem(k));
      }
      const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `atrivo-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      toast('Backup exportado!', 'ok');
    } catch (e) {
      toast('Não foi possível exportar o backup', 'erro');
    }
  },

  importarBackup() {
    const input = document.getElementById('arquivo-backup');
    if (!input) return;
    input.value = '';
    input.click();
  },

  resetar() {
    abrirModal(`
      <h3>Resetar todos os dados</h3>
      <p class="sub">Isso apagará usuário, saldo, transações, cartões, boletos e investimentos.
      A ação não pode ser desfeita.</p>
      <div class="acoes">
        <button class="btn secundario" data-action="fecharModal">Cancelar</button>
        <button class="btn perigo" data-action="confirmarReset">Sim, resetar</button>
      </div>
    `);
  },

  confirmarReset() {
    try {
      const chaves = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(CONFIG.PREFIX)) chaves.push(k);
      }
      chaves.forEach(k => localStorage.removeItem(k));
    } catch (e) { /* noop */ }
    fecharModal();
    toast('Dados resetados. Recarregando...', 'info');
    setTimeout(() => location.reload(), 700);
  },

  sair() {
    STATE.session = { logado: false, expiraEm: 0 };
    salvar('session', STATE.session);
    fecharModal();
    STATE.loginCpf = '';
    STATE.loginSenha = '';
    STATE.saldoOculto = false;
    navegar('#/login');
    toast('Você saiu da conta', 'info');
  }
};

/* ============================================================
   11. FORMULÁRIOS
   ============================================================ */
const FORMS = {

  login() { tentarLogin(); },

  esqueci(form) {
    const email = form.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErro(form, 'Informe um e-mail válido.');
      return;
    }
    fecharModal();
    toast('Se existir uma conta com este e-mail, enviaremos um código.', 'ok');
  },

  pix(form) {
    const chave = form.chave.value.trim();
    const valor = parseMoeda(form.valor.value);
    const descricao = form.descricao.value.trim();

    if (chave.length < 3) { setErro(form, 'Informe uma chave Pix válida.'); return; }
    if (valor <= 0) { setErro(form, 'Informe um valor maior que zero.'); return; }

    const nome = form.chave.dataset.nome || chave;
    const r = enviarPix({ chave, nome, valor, descricao });
    if (!r.ok) { setErro(form, r.msg); return; }

    fecharModal();
    render();
    mostrarPixEnviado(r.transacao);
  },

  recarga(form) {
    const valor = parseMoeda(form.valor.value);
    const operadora = form.operadora.value;
    if (valor <= 0) { setErro(form, 'Informe um valor maior que zero.'); return; }

    const r = debitar(valor);
    if (!r.ok) { setErro(form, r.msg); return; }

    registrarTransacao({
      tipo: 'recarga', valor,
      descricao: 'Recarga de celular',
      contraparte: operadora,
      categoria: 'Recarga'
    });
    salvar('transactions', STATE.transactions);
    salvar('accounts', STATE.accounts);

    fecharModal();
    toast('Recarga realizada com sucesso!', 'ok');
    render();
  },

  cartao(form) {
    const apelido = form.apelido.value.trim();
    const limite = parseMoeda(form.limite.value);
    if (apelido.length < 2) { setErro(form, 'Informe um apelido para o cartão.'); return; }
    if (limite <= 0) { setErro(form, 'Informe um limite maior que zero.'); return; }

    STATE.cards.push({
      id: uid(),
      final: String(Math.floor(1000 + Math.random() * 9000)),
      bandeira: 'Mastercard',
      tipo: 'virtual',
      bloqueado: false,
      limite
    });
    salvar('cards', STATE.cards);
    fecharModal();
    toast(`Cartão virtual “${apelido}” criado!`, 'ok');
    render();
  },

  gerarBoleto(form) {
    const beneficiario = form.beneficiario.value.trim();
    const valor = parseMoeda(form.valor.value);
    const vencimento = form.vencimento.value;

    if (beneficiario.length < 2) { setErro(form, 'Informe o beneficiário.'); return; }
    if (valor <= 0) { setErro(form, 'Informe um valor maior que zero.'); return; }
    if (!vencimento) { setErro(form, 'Informe a data de vencimento.'); return; }

    const codigo = Array.from({ length: 48 }, () => Math.floor(Math.random() * 10)).join('');
    STATE.bills.push({
      id: uid(), codigo: maskBoleto(codigo), valor, vencimento,
      pago: false, beneficiario
    });
    salvar('bills', STATE.bills);
    fecharModal();
    toast('Boleto gerado com sucesso!', 'ok');
    render();
  },

  pagarBoleto(form) {
    const codigo = form.codigo.value;
    const valor = parseMoeda(form.valor.value);

    if (soDigitos(codigo).length < 20) { setErro(form, 'Código de barras inválido.'); return; }
    if (valor <= 0) { setErro(form, 'Informe um valor maior que zero.'); return; }

    const conta = STATE.bills.find(b => soDigitos(b.codigo) === soDigitos(codigo) && !b.pago);
    const beneficiario = conta ? conta.beneficiario : 'Boleto avulso';

    const r = pagarBoleto(codigo, valor, beneficiario);
    if (!r.ok) { setErro(form, r.msg); return; }

    fecharModal();
    toast('Boleto pago com sucesso!', 'ok');
    render();
  },

  investir(form) {
    const nome = form.nome.value.trim();
    const tipo = form.tipo.value;
    const valor = parseMoeda(form.valor.value);

    if (nome.length < 2) { setErro(form, 'Informe o nome do produto.'); return; }
    if (valor <= 0) { setErro(form, 'Informe um valor maior que zero.'); return; }

    const r = debitar(valor);
    if (!r.ok) { setErro(form, r.msg); return; }

    STATE.investments.push({
      id: uid(), nome, tipo,
      valorAplicado: valor, rendimento: 0, rentabilidade: 0
    });
    registrarTransacao({
      tipo: 'investimento', valor,
      descricao: 'Aplicação em ' + nome,
      contraparte: nome,
      categoria: 'Investimento'
    });
    salvar('investments', STATE.investments);
    salvar('transactions', STATE.transactions);
    salvar('accounts', STATE.accounts);

    fecharModal();
    toast('Aplicação realizada!', 'ok');
    render();
  },

  perfil(form) {
    const nome = form.nome.value.trim();
    const email = form.email.value.trim();
    const telefone = form.telefone.value.trim();
    const chavePix = form.chavePix.value.trim();

    if (nome.length < 3) { setErro(form, 'Informe seu nome completo.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setErro(form, 'Informe um e-mail válido.'); return; }
    if (telefone && soDigitos(telefone).length < 10) { setErro(form, 'Informe um telefone válido com DDD.'); return; }
    if (chavePix.length < 3) { setErro(form, 'Informe uma chave Pix válida.'); return; }

    STATE.user.nome = nome;
    STATE.user.email = email;
    STATE.user.telefone = telefone;
    STATE.user.chavePix = chavePix;
    STATE.user.avatarIniciais = iniciais(nome);
    salvar('user', STATE.user);

    setErro(form, '');
    toast('Dados atualizados com sucesso!', 'ok');
    render();
  },

  saldo(form) {
    if (form.saldo.value.trim() === '') { setErro(form, 'Informe um valor.'); return; }
    const novo = parseMoeda(form.saldo.value);
    if (novo < 0) { setErro(form, 'O saldo não pode ser negativo.'); return; }

    const deltaValor = +(novo - STATE.accounts.saldo).toFixed(2);
    if (deltaValor === 0) { setErro(form, 'O valor informado é igual ao saldo atual.'); return; }

    STATE.accounts.saldo = novo;
    salvar('accounts', STATE.accounts);

    registrarTransacao({
      tipo: 'ajuste', valor: deltaValor,
      descricao: deltaValor > 0 ? 'Ajuste de saldo (crédito)' : 'Ajuste de saldo (débito)',
      contraparte: 'Ajuste manual',
      categoria: 'Ajuste'
    });
    salvar('transactions', STATE.transactions);

    setErro(form, '');
    toast(`Saldo atualizado para ${fmtBRL(novo)}`, 'ok');
    render();
  },

  limitePix(form) {
    const limite = parseMoeda(form.limite.value);
    if (limite <= 0) { setErro(form, 'Informe um limite maior que zero.'); return; }
    if (limite > 50000) { setErro(form, 'O limite máximo permitido é R$ 50.000,00.'); return; }

    STATE.accounts.limitePixDiario = limite;
    salvar('accounts', STATE.accounts);
    setErro(form, '');
    toast(`Limite Pix diário definido em ${fmtBRL(limite)}`, 'ok');
    render();
  }
};

/* ============================================================
   12. REGRAS DE NEGÓCIO
   ============================================================ */

function registrarTransacao({ tipo, valor, descricao, contraparte, categoria, chavePix }) {
  const t = {
    id: uid(), tipo, valor,
    dataISO: new Date().toISOString(),
    descricao, contraparte,
    ...(chavePix ? { chavePix } : {}),
    categoria: categoria || 'Outros',
    saldoApos: +Number(STATE.accounts.saldo).toFixed(2),
    status: 'concluido'
  };
  STATE.transactions.push(t);
  return t;
}

function debitar(valor) {
  const a = STATE.accounts;
  if (valor <= 0) return { ok: false, msg: 'Informe um valor maior que zero.' };
  const disponivel = a.saldo + a.chequeEspecial;
  if (valor > disponivel) {
    return { ok: false, msg: `Saldo insuficiente. Disponível: ${fmtBRL(Math.max(0, disponivel))}.` };
  }
  a.saldo = +(a.saldo - valor).toFixed(2);
  return { ok: true };
}

function enviarPix({ chave, nome, valor, descricao }) {
  const a = STATE.accounts;

  if (valor <= 0) return { ok: false, msg: 'Informe um valor maior que zero.' };

  const disponivel = a.saldo + a.chequeEspecial;
  if (valor > disponivel) {
    return { ok: false, msg: `Saldo insuficiente. Disponível: ${fmtBRL(Math.max(0, disponivel))}.` };
  }

  const restante = +(a.limitePixDiario - a.pixUsadoHoje).toFixed(2);
  if (valor > restante) {
    return {
      ok: false,
      msg: restante <= 0
        ? `Limite Pix diário esgotado. Restam ${fmtBRL(0)} hoje.`
        : `Limite Pix diário excedido. Restam ${fmtBRL(restante)} hoje.`
    };
  }

  a.saldo = +(a.saldo - valor).toFixed(2);
  a.pixUsadoHoje = +(a.pixUsadoHoje + valor).toFixed(2);
  salvar('accounts', a);

  const transacao = registrarTransacao({
    tipo: 'pix_out', valor,
    descricao: descricao || 'Pix enviado',
    contraparte: nome || chave,
    categoria: 'Transferência',
    chavePix: chave
  });
  salvar('transactions', STATE.transactions);

  return { ok: true, transacao };
}

function pagarBoleto(codigo, valor, beneficiario) {
  const r = debitar(valor);
  if (!r.ok) return r;

  const conta = STATE.bills.find(b => soDigitos(b.codigo) === soDigitos(codigo) && !b.pago);
  if (conta) {
    conta.pago = true;
  } else {
    // Registra boleto avulso como pago para constar no histórico
    STATE.bills.push({
      id: uid(),
      codigo: maskBoleto(codigo),
      valor,
      vencimento: new Date().toISOString().slice(0, 10),
      pago: true,
      beneficiario: beneficiario || 'Boleto avulso'
    });
  }
  salvar('bills', STATE.bills);
  salvar('accounts', STATE.accounts);

  registrarTransacao({
    tipo: 'boleto', valor,
    descricao: 'Pagamento de boleto',
    contraparte: beneficiario || 'Boleto',
    categoria: 'Contas'
  });
  salvar('transactions', STATE.transactions);

  return { ok: true };
}

/* ============================================================
   13. DELEGAÇÃO DE EVENTOS
   ============================================================ */

// Cliques
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-action]');
  if (!el || (el.dataset.action === 'fecharModalFundo' && ev.target !== el)) return;
  const acao = el.dataset.action;
  const fn = ACOES[acao];
  if (typeof fn === 'function') {
    ev.preventDefault();
    fn(el, ev);
  }
});

document.addEventListener('error', ev => {
  if (ev.target instanceof HTMLImageElement &&
      (ev.target.classList.contains('brand-logo-image') || ev.target.classList.contains('user-photo-image'))) {
    ev.target.hidden = true;
  }
}, true);
document.addEventListener('load', ev => {
  if (ev.target instanceof HTMLImageElement &&
      (ev.target.classList.contains('brand-logo-image') || ev.target.classList.contains('user-photo-image'))) {
    const fallbackSelector = ev.target.classList.contains('user-photo-image')
      ? '.user-avatar-fallback'
      : '.brand-logo-fallback';
    const fallback = ev.target.parentElement.querySelector(fallbackSelector);
    if (fallback) fallback.hidden = true;
  }
}, true);

// Máscaras
document.addEventListener('input', ev => {
  const el = ev.target;
  if (!(el instanceof HTMLInputElement)) return;
  switch (el.dataset.mask) {
    case 'cpf':
      el.value = maskCPF(el.value);
      STATE.loginCpf = el.value;
      break;
    case 'telefone':
      el.value = maskTelefone(el.value);
      break;
    case 'boleto':
      el.value = maskBoleto(el.value);
      break;
    case 'moeda':
      el.value = maskMoeda(el.value);
      break;
  }
});

// Filtros do extrato
function aplicarFiltro(el) {
  const campo = el.dataset.filtro;
  if (!campo) return;
  STATE.filtro[campo] = el.value;
  const lista = document.getElementById('lista-extrato');
  if (lista) lista.innerHTML = listaExtrato();
}
document.addEventListener('input', ev => {
  const el = ev.target.closest('[data-filtro]');
  if (el) aplicarFiltro(el);
});
document.addEventListener('change', ev => {
  const el = ev.target.closest('[data-filtro]');
  if (el) aplicarFiltro(el);
});

// Preferências
document.addEventListener('change', ev => {
  const el = ev.target.closest('[data-pref]');
  if (!el) return;
  const pref = el.dataset.pref;
  if (pref === 'tema') {
    STATE.settings.tema = el.checked ? 'escuro' : 'claro';
    aplicarTema();
  } else {
    STATE.settings[pref] = el.checked;
    if (pref === 'ocultarSaldo') STATE.saldoOculto = el.checked;
  }
  salvar('settings', STATE.settings);
  toast('Preferência atualizada', 'ok');
});

// "Lembrar de mim"
document.addEventListener('change', ev => {
  if (ev.target.id === 'lembrar') {
    STATE.lembrar = ev.target.checked;
    salvar('remember', STATE.lembrar);
  }
});

// Formulários
document.addEventListener('submit', ev => {
  const form = ev.target.closest('form[data-form]');
  if (!form) return;
  ev.preventDefault();
  const fn = FORMS[form.dataset.form];
  if (typeof fn === 'function') fn(form);
});

// Importação de backup
document.addEventListener('change', ev => {
  const input = ev.target;
  if (input.id !== 'arquivo-backup' || !input.files?.length) return;
  const arquivo = input.files[0];
  const leitor = new FileReader();
  leitor.onload = () => {
    try {
      const dados = JSON.parse(leitor.result);
      const chaves = Object.keys(dados).filter(k => k.startsWith(CONFIG.PREFIX));
      if (!chaves.length) {
        toast('Arquivo inválido: nenhuma chave "bank." encontrada', 'erro');
        return;
      }
      chaves.forEach(k => localStorage.setItem(k, JSON.stringify(dados[k])));
      toast('Backup importado! Recarregando...', 'ok');
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      toast('Não foi possível ler o arquivo JSON', 'erro');
    }
  };
  leitor.onerror = () => toast('Erro ao ler o arquivo', 'erro');
  leitor.readAsText(arquivo);
});

// Teclado físico
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape') {
    const modal = document.querySelector('.modal-back');
    if (modal) { fecharModal(); return; }
  }

  if (parseRota().nome !== 'login') return;
  if (STATE.session?.logado) return;
  if (ev.target.matches('input, textarea, select')) {
    if (ev.key === 'Enter' && ev.target.id === 'in-cpf') {
      ev.target.blur();
    }
    return;
  }

  if (/^[0-9]$/.test(ev.key)) {
    if (STATE.loginSenha.length < 4) {
      STATE.loginSenha += ev.key;
      atualizarDotsSenha();
      if (STATE.loginSenha.length === 4) setTimeout(tentarLogin, 140);
    }
  } else if (ev.key === 'Backspace') {
    ev.preventDefault();
    STATE.loginSenha = STATE.loginSenha.slice(0, -1);
    atualizarDotsSenha();
  }
});

// Roteador
window.addEventListener('hashchange', render);

if ("serviceWorker" in navigator && ["http:", "https:"].includes(location.protocol)) {
  navigator.serviceWorker.register("./sw.js")
    .catch(error => console.error("Falha ao registrar o service worker:", error));
}

/* ============================================================
   14. BOOTSTRAP
   ============================================================ */
(function iniciarApp() {
  inicializar();
  if (STATE.session?.logado && (!location.hash || location.hash === '#/login')) {
    location.hash = '#/home';
  }
  render();
})();
