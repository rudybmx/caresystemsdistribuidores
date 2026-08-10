// Cena 3D da rede de distribuidores — SP e PR em vidro extrudado.
// Carregado sob demanda por import() dinamico quando a secao entra na viewport.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const LARGURA_MUNDO = 100;   // largura do conjunto SP+PR em unidades de cena
const PROFUNDIDADE = 16;

// as unidades chegam do markup (opcoes.cidades) — a lista da secao e a fonte.
// esta tabela e so o fallback de quem chamar iniciar() sem passar nada.
export const CIDADES = [
  { id: 'sede',      nome: 'Sede Care Systems', cidade: 'São João da Boa Vista, SP', lon: -46.7986, lat: -21.9686, uf: 'SP', sede: true, rotulo: 'Sede Care Systems' },
  { id: 'londrina',  nome: 'Londrina',          cidade: 'Londrina, PR',              lon: -51.1628, lat: -23.3103, uf: 'PR', desvio: 5 },
  { id: 'apucarana', nome: 'Apucarana',         cidade: 'Apucarana, PR',             lon: -51.4608, lat: -23.5505, uf: 'PR', desvio: 17 }
];

export async function iniciar(palco, opcoes = {}) {
  const unidades = (opcoes.cidades && opcoes.cidades.length) ? opcoes.cidades : CIDADES;
  const semMovimento = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const malha = await fetch(opcoes.malha || '/public/malha-sp-pr.json').then(r => r.json());

  // ── projecao unica: malha e pinos passam por aqui, ninguem e posicionado a mao ──
  let mnx = 180, mxx = -180, mny = 90, mxy = -90;
  for (const uf in malha) for (const poly of malha[uf]) for (const anel of poly) for (const [x, y] of anel) {
    if (x < mnx) mnx = x; if (x > mxx) mxx = x;
    if (y < mny) mny = y; if (y > mxy) mxy = y;
  }
  const cLon = (mnx + mxx) / 2, cLat = (mny + mxy) / 2;
  const escala = LARGURA_MUNDO / (mxx - mnx);
  // 1 grau de longitude encolhe com cos(lat): sem isso os estados ficam esticados
  const kx = Math.cos(cLat * Math.PI / 180);
  const projetar = (lon, lat) => [(lon - cLon) * escala * kx, (lat - cLat) * escala];
  const ALTURA_MUNDO = (mxy - mny) * escala;

  // ── cena ────────────────────────────────────────────────────────────────
  const cena = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  palco.appendChild(renderer.domElement);

  // dialogo do pino: fora do CSS2D de proposito — precisa de posicionamento
  // livre para virar de lado quando encosta na borda do palco
  const dica = document.createElement('div');
  dica.className = 'mapa-dica';
  palco.appendChild(dica);

  const rotulos = new CSS2DRenderer();
  rotulos.domElement.className = 'mapa-rotulos';
  palco.appendChild(rotulos.domElement);

  const camera = new THREE.PerspectiveCamera(38, 1, 1, 1000);
  const alvoCamera = new THREE.Vector3(0, PROFUNDIDADE / 2, 0);
  // ~35 graus de elevacao, olhando o conjunto de cima e de lado
  const ELEV = 62 * Math.PI / 180;
  let RAIO = 120;
  const posBase = new THREE.Vector3();
  // enquadramento derivado do tamanho do conjunto e do FOV, nao de numero chutado
  const OCUPACAO = 0.80;   // fracao do frame que o conjunto deve preencher
  const caixa = new THREE.Box3(), cantos = [];
  /* Enquadra pelos 8 cantos do bounding box REAL da geometria: projeta, mede a
     ocupacao em NDC e corrige o raio. Duas passadas convergem. */
  function enquadrar() {
    if (!grupo.children.length) return;
    caixa.setFromObject(grupo);
    cantos.length = 0;
    for (const x of [caixa.min.x, caixa.max.x])
      for (const y of [caixa.min.y, caixa.max.y])
        for (const z of [caixa.min.z, caixa.max.z])
          cantos.push(new THREE.Vector3(x, y, z));
    alvoCamera.copy(caixa.getCenter(new THREE.Vector3()));
    for (let passada = 0; passada < 3; passada++) {
      posBase.set(alvoCamera.x, alvoCamera.y + Math.sin(ELEV) * RAIO, alvoCamera.z + Math.cos(ELEV) * RAIO);
      camera.position.copy(posBase);
      camera.lookAt(alvoCamera);
      camera.updateMatrixWorld();
      camera.updateProjectionMatrix();
      let m = 0;
      for (const c of cantos) {
        const p = c.clone().project(camera);
        m = Math.max(m, Math.abs(p.x), Math.abs(p.y));
      }
      if (m > 0.001) RAIO *= m / OCUPACAO;
    }
  }

  // transmission precisa de environment; sem PMREM o vidro fica cinza chapado
  const pmrem = new THREE.PMREMGenerator(renderer);
  cena.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  // painel na cor da secao: da ao transmission o que refratar. Sem ele o buffer
  // de transmissao fica vazio (canvas com alpha) e o vidro renderiza chapado.
  // gradiente, nao cor chapada: um fundo uniforme nao da a refracao o que
  // distorcer, e o vidro continua lendo como superficie fosca
  const texFundo = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 256;
    const x = c.getContext("2d");
    // alfa que morre antes da borda: o painel existe so atras do mapa, para o
    // transmission ter o que refratar, e nao pinta o resto do canvas
    const g = x.createRadialGradient(128, 140, 6, 128, 140, 118);
    g.addColorStop(0, "rgba(56,168,116,.5)");
    g.addColorStop(0.45, "rgba(20,90,64,.36)");
    g.addColorStop(1, "rgba(11,61,46,0)");
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  })();
  const fundo = new THREE.Mesh(
    new THREE.PlaneGeometry(320, 320),
    new THREE.MeshBasicMaterial({ map: texFundo, toneMapped: false, transparent: true, depthWrite: false })
  );
  fundo.position.set(0, 6, -90);
  cena.add(fundo);

  cena.add(new THREE.AmbientLight(0xbfe8d6, 0.55));
  const sol = new THREE.DirectionalLight(0xffffff, 2.1);
  sol.position.set(-60, 90, 50);
  sol.castShadow = true;
  sol.shadow.mapSize.set(1024, 1024);
  const d = 90;
  Object.assign(sol.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 260 });
  sol.shadow.camera.updateProjectionMatrix();
  cena.add(sol);

  // rasante pela direita: e ela que desenha o brilho na aresta superior da extrusao
  const realce = new THREE.DirectionalLight(0xdcffe9, 1.6);
  realce.position.set(90, 30, -40);
  cena.add(realce);

  // ── malha extrudada ─────────────────────────────────────────────────────
  // textura procedural: micro-relevo + grade geografica sutil (item 4).
  // UV do ExtrudeGeometry = unidades do shape, entao repeat da o passo da grade.
  const texRelevo = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d');
    x.fillStyle = '#2e2e2e'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1600; i++) {
      const g = 26 + Math.random() * 52 | 0;
      x.fillStyle = 'rgba(' + g + ',' + g + ',' + g + ',.55)';
      x.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 3, 1 + Math.random() * 3);
    }
    x.strokeStyle = 'rgba(168,168,168,.95)'; x.lineWidth = 1;
    for (let k = 0; k <= 10; k++) {
      const p = k * 25.6 + 0.5;
      x.beginPath(); x.moveTo(p, 0); x.lineTo(p, 256); x.stroke();
      x.beginPath(); x.moveTo(0, p); x.lineTo(256, p); x.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / 28, 1 / 28);   // grade de 10 celulas por tile -> 1 linha a cada 4 unidades
    return t;
  })();

  // roughness base 1: o valor efetivo vem todo do mapa (variacao ~0.1-0.5)
  const TONS = { SP: 0xdcf6e8, PR: 0x9ed8bb };
  const vidroBase = {
    transmission: 0.72, thickness: 10, ior: 1.45,
    roughness: 1, roughnessMap: texRelevo,
      bumpMap: texRelevo, bumpScale: 0.7,
    clearcoat: 1, clearcoatRoughness: 0.06, metalness: 0,
    envMapIntensity: 1.3, attenuationDistance: 34,
    attenuationColor: new THREE.Color(0x53c795)
  };

  // centro de cada estado em coords de shape: afastamento e rotulo de UF saem daqui
  const infoUF = {};
  for (const uf in malha) {
    let ax = 1e9, bx = -1e9, ay = 1e9, by = -1e9;
    for (const poly of malha[uf]) for (const [lo, la] of poly[0]) {
      const [x, y] = projetar(lo, la);
      if (x < ax) ax = x; if (x > bx) bx = x;
      if (y < ay) ay = y; if (y > by) by = y;
    }
    infoUF[uf] = { cx: (ax + bx) / 2, cy: (ay + by) / 2, off: { x: 0, y: 0 } };
  }
  {
    // folga pequena ao longo do eixo entre os centros (item 3)
    const ufs = Object.keys(infoUF);
    if (ufs.length === 2) {
      const a = infoUF[ufs[0]], b = infoUF[ufs[1]];
      const dx = a.cx - b.cx, dy = a.cy - b.cy, h = Math.hypot(dx, dy) || 1, G = 1.6;
      a.off = { x: dx / h * G, y: dy / h * G };
      b.off = { x: -dx / h * G, y: -dy / h * G };
    }
  }

  const grupo = new THREE.Group();
  for (const uf in malha) {
    const gUF = new THREE.Group();
    const mat = new THREE.MeshPhysicalMaterial(Object.assign({ color: TONS[uf] || 0xd8f6e6 }, vidroBase));
    for (const poly of malha[uf]) {
      const forma = new THREE.Shape();
      poly[0].forEach(([lo, la], i) => {
        const [x, y] = projetar(lo, la);
        i ? forma.lineTo(x, y) : forma.moveTo(x, y);
      });
      for (let k = 1; k < poly.length; k++) {          // aneis internos viram furos
        const furo = new THREE.Path();
        poly[k].forEach(([lo, la], i) => {
          const [x, y] = projetar(lo, la);
          i ? furo.lineTo(x, y) : furo.moveTo(x, y);
        });
        forma.holes.push(furo);
      }
      const geo = new THREE.ExtrudeGeometry(forma, {
        depth: PROFUNDIDADE, bevelEnabled: true, bevelThickness: 0.5,
        bevelSize: 0.4, bevelSegments: 2, curveSegments: 1
      });
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      gUF.add(m);
    }
    // afastamento no espaco do shape, antes da rotacao do grupo
    gUF.position.set(infoUF[uf].off.x, infoUF[uf].off.y, 0);
    grupo.add(gUF);
  }
  // deita o plano XY do shape sobre XZ; a latitude (shape-Y) vira -Z
  grupo.rotation.x = -Math.PI / 2;
  cena.add(grupo);

  const TOPO = PROFUNDIDADE;   // apos a rotacao, a face de cima fica em y = profundidade

  // rotulo discreto por estado, distinto dos rotulos de cidade
  const NOMES_UF = { SP: 'São Paulo', PR: 'Paraná' };
  for (const uf in infoUF) {
    const el = document.createElement('div');
    el.className = 'mapa-rotulo-uf';
    el.textContent = NOMES_UF[uf] || uf;
    const ro = new CSS2DObject(el);
    ro.position.set(infoUF[uf].cx + infoUF[uf].off.x, TOPO + 0.6, -(infoUF[uf].cy + infoUF[uf].off.y));
    cena.add(ro);
  }

  // sombra de contato: plano com ShadowMaterial (ContactShadows e do drei, nao do three)
  const chao = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.ShadowMaterial({ opacity: 0.28 })
  );
  chao.rotation.x = -Math.PI / 2;
  chao.position.y = -0.6;
  chao.receiveShadow = true;
  cena.add(chao);

  // ── pinos ───────────────────────────────────────────────────────────────
  const texHalo = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d').createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(124,194,92,.95)');
    g.addColorStop(0.45, 'rgba(124,194,92,.35)');
    g.addColorStop(1, 'rgba(124,194,92,0)');
    const cx = c.getContext('2d'); cx.fillStyle = g; cx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();

  const pinos = [];
  unidades.forEach((c, i) => {
    const [px, py] = projetar(c.lon, c.lat);
    const desloc = infoUF[c.uf] ? infoUF[c.uf].off : { x: 0, y: 0 };
    // dx/dy separam unidades que quase coincidem em tela; o resto vem da projecao
    const pos = new THREE.Vector3(
      px + desloc.x + (c.dx || 0),
      TOPO + 1.6,
      -(py + desloc.y + (c.dy || 0))
    );

    const esfera = new THREE.Mesh(
      new THREE.SphereGeometry(c.sede ? 2.1 : 1.4, 24, 16),
      new THREE.MeshStandardMaterial({
        color: c.sede ? 0xa8d156 : 0x7cc25c,
        emissive: c.sede ? 0xa8d156 : 0x4e9a1e,
        emissiveIntensity: c.sede ? 1.5 : 0.9, roughness: 0.35
      })
    );
    esfera.position.copy(pos);
    cena.add(esfera);

    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texHalo, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    }));
    halo.position.copy(pos);
    const halo0 = c.sede ? 13 : 9;
    halo.scale.setScalar(halo0);
    cena.add(halo);

    const el = document.createElement('div');
    el.className = 'mapa-rotulo' + (c.sede ? ' mapa-rotulo--sede' : '');
    el.textContent = c.rotulo || (c.sede ? c.nome : c.cidade.split(',')[0]);
    el.dataset.unidade = c.id;
    const rot = new CSS2DObject(el);
    // Londrina e Apucarana quase coincidem em tela: escalona a altura para nao colidir
    rot.position.set(pos.x, pos.y + (c.sede ? 6 : c.desvio || 4), pos.z);
    cena.add(rot);

    pinos.push({ dado: c, esfera, halo, halo0, el, atraso: i * 0.5, ativo: false });
  });

  // ── conexoes sede -> distribuidores ─────────────────────────────────────
  const sede = pinos.find(p => p.dado.sede);
  const fluxos = [];
  pinos.filter(p => !p.dado.sede).forEach(p => {
    const a = sede.esfera.position, b = p.esfera.position;
    const meio = a.clone().add(b).multiplyScalar(0.5);
    meio.y += a.distanceTo(b) * 0.42;                    // arco acima do plano
    const curva = new THREE.QuadraticBezierCurve3(a, meio, b);
    const pts = curva.getPoints(60);
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineDashedMaterial({
      color: 0x7cc25c, transparent: true, opacity: 0.55,
      dashSize: 2.4, gapSize: 2.4
    });
    const linha = new THREE.Line(geo, mat);
    linha.computeLineDistances();
    cena.add(linha);
    fluxos.push({ mat, pino: p });
  });

  // ── interacao ───────────────────────────────────────────────────────────
  const raycaster = new THREE.Raycaster();
  const ponteiro = new THREE.Vector2(-2, -2);
  let parallax = { x: 0, y: 0 };

  palco.addEventListener('pointermove', e => {
    const r = palco.getBoundingClientRect();
    ponteiro.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    parallax.x = ponteiro.x; parallax.y = ponteiro.y;
  });
  palco.addEventListener('pointerleave', () => { ponteiro.set(-2, -2); parallax = { x: 0, y: 0 }; });

  const ouvintes = new Set();
  const emitir = id => ouvintes.forEach(f => f(id));
  let destacado = null, travado = false, dicaDe = null;
  function destacar(id, origem) {
    if (destacado === id) return;
    destacado = id;
    // a dica so responde ao hover no mapa: vinda da lista ela repetiria o
    // dropdown que ja esta aberto do outro lado
    dicaDe = origem === 'mapa' ? id : null;
    montarDica(dicaDe);
    pinos.forEach(p => {
      p.ativo = p.dado.id === id;
      p.el.classList.toggle('is-ativo', p.ativo);
    });
    fluxos.forEach(f => { f.mat.opacity = !id || f.pino.dado.id === id ? 0.85 : 0.2; });
    emitir(id);
  }

  function montarDica(id) {
    const p = id && pinos.find(x => x.dado.id === id);
    if (!p) { dica.classList.remove('visivel'); limparEncobertos(); return; }
    const d = p.dado;
    dica.innerHTML =
      '<div class="mapa-dica-nome">' + d.nome + '</div>' +
      '<div class="mapa-dica-cidade">' + d.cidade + '</div>' +
      (d.endereco ? '<div class="mapa-dica-end">' + d.endereco + '</div>' : '') +
      (d.telefone ? '<div class="mapa-dica-tel">' + d.telefone + '</div>' : '');
    dica.classList.add('visivel');
    posicionarDica();
  }

  const vAux = new THREE.Vector3();
  function posicionarDica() {
    if (!dicaDe) return;
    const p = pinos.find(x => x.dado.id === dicaDe);
    if (!p) return;
    const W = palco.clientWidth, H = palco.clientHeight;
    vAux.copy(p.esfera.position).project(camera);
    const px = (vAux.x * 0.5 + 0.5) * W, py = (-vAux.y * 0.5 + 0.5) * H;
    const w = dica.offsetWidth, h = dica.offsetHeight, M = 8, FOLGA = 16;
    // acima do pino por padrao; se nao couber, vira para baixo
    let y = py - h - FOLGA;
    if (y < M) y = py + FOLGA;
    let x = px - w / 2;
    x = Math.max(M, Math.min(W - w - M, x));
    y = Math.max(M, Math.min(H - h - M, y));
    // left/top, nao transform: o transform e do CSS, que anima a entrada
    dica.style.left = Math.round(x) + 'px';
    dica.style.top = Math.round(y) + 'px';
    // nenhum rotulo fica encavalado: o que a dica cobre, some
    const cx = x, cy = y, cw = w, ch = h;
    pinos.forEach(q => {
      const r = q.el.getBoundingClientRect(), base = palco.getBoundingClientRect();
      const rx = r.left - base.left, ry = r.top - base.top;
      const bate = q.dado.id === dicaDe ||
        (rx < cx + cw && cx < rx + r.width && ry < cy + ch && cy < ry + r.height);
      q.el.classList.toggle('encoberto', bate);
    });
  }

  function limparEncobertos() {
    pinos.forEach(q => q.el.classList.remove('encoberto'));
  }

  // tween da camera ao focar um pino
  let foco = null;
  function focar(id) {
    const p = pinos.find(x => x.dado.id === id);
    if (!p) return;
    foco = { de: alvoCamera.clone(), para: p.esfera.position.clone().setY(TOPO), t: 0 };
  }

  // ── loop ────────────────────────────────────────────────────────────────
  const relogio = new THREE.Clock();
  let rodando = false, req = 0;

  function dimensionar() {
    const w = palco.clientWidth, h = palco.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    rotulos.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    enquadrar();
  }

  function quadro() {
    const t = relogio.getElapsedTime();

    // raycast antes de mover a camera: testa contra o quadro que o usuario
    // estava vendo quando apontou. Depois da camera andar, o pino ja saiu
    // debaixo do cursor e os das bordas ficam impossiveis de acertar.
    raycaster.setFromCamera(ponteiro, camera);
    const hit = raycaster.intersectObjects(pinos.map(p => p.esfera))[0];
    if (hit) {
      const p = pinos.find(x => x.esfera === hit.object);
      destacar(p.dado.id, 'mapa');
      palco.style.cursor = 'pointer';
    } else if (!travado) {
      destacar(null, 'mapa');
      palco.style.cursor = '';
    }

    if (!semMovimento) {
      // com um pino sob o mouse a camera congela: o parallax anda junto com o
      // ponteiro e empurrava o pino para fora do cursor, obrigando a persegui-lo
      if (!dicaDe) {
        // parallax suave; sem orbita livre, o mapa nunca sai da composicao
        const ax = parallax.x * 0.18, ay = parallax.y * 0.10;
        camera.position.x += (posBase.x + ax * 40 - camera.position.x) * 0.05;
        camera.position.y += (posBase.y - ay * 22 - camera.position.y) * 0.05;
        // preserva a distancia TOTAL: descontar so o X jogava a camera para tras
        const dx = camera.position.x - alvoCamera.x, dy = camera.position.y - alvoCamera.y;
        const resto = RAIO * RAIO - dx * dx - dy * dy;
        camera.position.z = alvoCamera.z + Math.sqrt(Math.max(1, resto));
      }
      pinos.forEach(p => {
        const f = 1 + Math.sin((t + p.atraso) * Math.PI) * 0.16;
        p.halo.scale.setScalar(p.halo0 * f * (p.ativo ? 1.5 : 1));
        p.halo.material.opacity = (0.55 + Math.sin((t + p.atraso) * Math.PI) * 0.25) * (p.ativo ? 1.4 : 1);
      });
      fluxos.forEach((f, i) => { f.mat.dashOffset = -t * 6 - i; });
    } else {
      pinos.forEach(p => p.halo.scale.setScalar(p.halo0 * (p.ativo ? 1.4 : 1)));
    }

    if (foco) {
      foco.t = Math.min(1, foco.t + 0.02);
      const e = 1 - Math.pow(1 - foco.t, 3);
      alvoCamera.lerpVectors(foco.de, foco.para, e);
      if (foco.t >= 1) foco = null;
    }
    camera.lookAt(alvoCamera);

    // a camera se move com o parallax: a dica reposiciona junto
    if (dicaDe) posicionarDica();

    renderer.render(cena, camera);
    rotulos.render(cena, camera);
    req = requestAnimationFrame(quadro);
  }


  dimensionar();
  addEventListener('resize', dimensionar);

  if (opcoes.debug) Object.assign(globalThis, { __cena: cena, __cam: camera, __grupo: grupo, __THREE: THREE, __pinos: pinos, __renderer: renderer, __rotulos: rotulos, __dica: dica, __posicionarDica: posicionarDica });
  return {
    ligar() { if (!rodando) { rodando = true; req = requestAnimationFrame(quadro); } },
    get rodando() { return rodando; },
    desligar() { rodando = false; cancelAnimationFrame(req); },
    // sincronia com a lista: o card manda acender e o pino avisa de volta
    destacar(id) { travado = !!id; destacar(id, 'lista'); },
    focar,
    aoDestacar(f) { ouvintes.add(f); },
    dimensionar,
    destruir() {
      this.desligar();
      removeEventListener('resize', dimensionar);
      renderer.dispose(); pmrem.dispose();
      palco.innerHTML = '';
    }
  };
}
