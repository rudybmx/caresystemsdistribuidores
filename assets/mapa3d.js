// Cena 3D da rede de distribuidores — SP e PR em vidro extrudado.
// Carregado sob demanda por import() dinamico quando a secao entra na viewport.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const LARGURA_MUNDO = 100;   // largura do conjunto SP+PR em unidades de cena
const PROFUNDIDADE = 8;

export const CIDADES = [
  { id: 'sjbv',       nome: 'Sede Care Systems', cidade: 'São João da Boa Vista, SP', lon: -46.7986, lat: -21.9686, sede: true },
  { id: 'londrina',   nome: 'Londrina',          cidade: 'Londrina, PR',              lon: -51.1628, lat: -23.3103 },
  { id: 'apucarana',  nome: 'Apucarana',         cidade: 'Apucarana, PR',             lon: -51.4608, lat: -23.5505, desvio: 11 },
  { id: 'guarapuava', nome: 'Guarapuava',        cidade: 'Guarapuava, PR',            lon: -51.4562, lat: -25.3935 }
];

export async function iniciar(palco, opcoes = {}) {
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
  renderer.toneMappingExposure = 1.1;
  palco.appendChild(renderer.domElement);

  const rotulos = new CSS2DRenderer();
  rotulos.domElement.className = 'mapa-rotulos';
  palco.appendChild(rotulos.domElement);

  const camera = new THREE.PerspectiveCamera(38, 1, 1, 1000);
  const alvoCamera = new THREE.Vector3(0, PROFUNDIDADE / 2, 0);
  // ~35 graus de elevacao, olhando o conjunto de cima e de lado
  const ELEV = 35 * Math.PI / 180;
  let RAIO = 120;
  const posBase = new THREE.Vector3();
  // enquadramento derivado do tamanho do conjunto e do FOV, nao de numero chutado
  function enquadrar(aspecto) {
    const fov = camera.fov * Math.PI / 180;
    const apAlt = ALTURA_MUNDO * Math.sin(ELEV) + PROFUNDIDADE * Math.cos(ELEV);
    const porAltura = (apAlt / 2) / Math.tan(fov / 2);
    const porLargura = (LARGURA_MUNDO / 2) / (Math.tan(fov / 2) * aspecto);
    RAIO = Math.max(porAltura, porLargura) * 1.12;   // 1.12 = respiro nas bordas
    posBase.set(0, Math.sin(ELEV) * RAIO, Math.cos(ELEV) * RAIO);
    camera.position.copy(posBase);
    camera.lookAt(alvoCamera);
  }

  // transmission precisa de environment; sem PMREM o vidro fica cinza chapado
  const pmrem = new THREE.PMREMGenerator(renderer);
  cena.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  cena.add(new THREE.AmbientLight(0xbfe8d6, 0.55));
  const sol = new THREE.DirectionalLight(0xffffff, 2.1);
  sol.position.set(-60, 90, 50);
  sol.castShadow = true;
  sol.shadow.mapSize.set(1024, 1024);
  const d = 90;
  Object.assign(sol.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 260 });
  sol.shadow.camera.updateProjectionMatrix();
  cena.add(sol);

  // ── malha extrudada ─────────────────────────────────────────────────────
  const vidro = new THREE.MeshPhysicalMaterial({
    color: 0xc8f0dc, transmission: 0.9, roughness: 0.15, thickness: 6,
    ior: 1.4, clearcoat: 1, clearcoatRoughness: 0.1, metalness: 0
  });

  const grupo = new THREE.Group();
  for (const uf in malha) for (const poly of malha[uf]) {
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
    const m = new THREE.Mesh(geo, vidro);
    m.castShadow = true;
    grupo.add(m);
  }
  // deita o plano XY do shape sobre XZ; a latitude (shape-Y) vira -Z
  grupo.rotation.x = -Math.PI / 2;
  cena.add(grupo);

  const TOPO = PROFUNDIDADE;   // apos a rotacao, a face de cima fica em y = profundidade

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
  CIDADES.forEach((c, i) => {
    const [px, py] = projetar(c.lon, c.lat);
    const pos = new THREE.Vector3(px, TOPO + 1.6, -py);   // shape-Y -> -Z

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
    el.textContent = c.sede ? c.nome : c.cidade.split(',')[0];
    el.dataset.cidade = c.id;
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
  let destacado = null, travado = false;
  function destacar(id) {
    if (destacado === id) return;
    destacado = id;
    pinos.forEach(p => {
      p.ativo = p.dado.id === id;
      p.el.classList.toggle('is-ativo', p.ativo);
    });
    fluxos.forEach(f => { f.mat.opacity = !id || f.pino.dado.id === id ? 0.85 : 0.2; });
    emitir(id);
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
    enquadrar(camera.aspect);
  }

  function quadro() {
    const t = relogio.getElapsedTime();

    if (!semMovimento) {
      // parallax suave; sem orbita livre, o mapa nunca sai da composicao
      const ax = parallax.x * 0.18, ay = parallax.y * 0.10;
      camera.position.x += (posBase.x + ax * 40 - camera.position.x) * 0.05;
      camera.position.y += (posBase.y - ay * 22 - camera.position.y) * 0.05;
      // preserva a distancia TOTAL: descontar so o X jogava a camera para tras
      const resto = RAIO * RAIO - camera.position.x ** 2 - camera.position.y ** 2;
      camera.position.z = Math.sqrt(Math.max(1, resto));
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

    raycaster.setFromCamera(ponteiro, camera);
    const hit = raycaster.intersectObjects(pinos.map(p => p.esfera))[0];
    if (hit) {
      const p = pinos.find(x => x.esfera === hit.object);
      destacar(p.dado.id);
      palco.style.cursor = 'pointer';
    } else if (!travado) {
      destacar(null);
      palco.style.cursor = '';
    }

    renderer.render(cena, camera);
    rotulos.render(cena, camera);
    req = requestAnimationFrame(quadro);
  }


  dimensionar();
  addEventListener('resize', dimensionar);

  return {
    ligar() { if (!rodando) { rodando = true; req = requestAnimationFrame(quadro); } },
    get rodando() { return rodando; },
    desligar() { rodando = false; cancelAnimationFrame(req); },
    // sincronia com a lista: o card manda acender e o pino avisa de volta
    destacar(id) { travado = !!id; destacar(id); },
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
